import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch";
import {
	Connection,
	PublicKey,
	Transaction,
	SystemProgram,
	TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import admin from "firebase-admin";
import userModel from "./models/userModel.js";
import serviceAccount from "./firebaseKey/serviceAccountKey.json" with { type: "json" };
import nacl from "tweetnacl";
import jwt from "jsonwebtoken";

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	databaseURL: "https://roasted-dfe8e-default-rtdb.firebaseio.com",
});
const db = admin.database();

dotenv.config();
dotenv.config({ path: ".env.local", override: true });
const secretKey = process.env.JWT_SECRET;
const connectionURL =
	process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const app = express();
app.use(cors());
app.use(bodyParser.json());

const connection = new Connection(connectionURL);

const MEMO_PROGRAM_ID = new PublicKey(
	"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

const yourWalletAddress = new PublicKey(process.env.DESTINATION_ADDRESS);

const packagesUSD = [
	{ priceUSD: 1, tokens: 100 },
	{ priceUSD: 2, tokens: 250 },
	{ priceUSD: 4, tokens: 600 },
	{ priceUSD: 10, tokens: 1400 },
	{ priceUSD: 20, tokens: 3200 },
	{ priceUSD: 50, tokens: 8000 },
];
const PRICE_MARGIN = 0.03;

async function convertUSDToLamports(usdAmount) {
	try {
		const response = await fetch(
			"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
		);
		const data = await response.json();
		console.log(data);

		const exchangeRate = data.solana.usd;
		if (!exchangeRate) throw new Error("Error Converting USD to SOL");
		const solAmount = usdAmount / exchangeRate;
		return Math.round(solAmount * 1e9); // lamports
	} catch (error) {
		console.error("Error", error);
		return null;
	}
}

function extractMemoAndLamports(tx) {
	let memoData = null;
	let lamportsPaid = 0;

	for (const ix of tx.instructions) {
		if (ix.programId.equals(MEMO_PROGRAM_ID)) {
			memoData = Buffer.from(ix.data).toString("utf8");
		}

		if (ix.programId.equals(SystemProgram.programId)) {
			const data = Buffer.from(ix.data);
			const instructionType = data.readUInt32LE(0);
			if (instructionType === 2) {
				lamportsPaid = Number(data.readBigUInt64LE(4));
			}
		}
	}

	return { memoData, lamportsPaid };
}

app.post("/create-transaction", async (req, res) => {
	try {
		console.log(req.body);
		const { packageId, payerAddress } = req.body;
		const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
		if (!token) return res.status(401).json({ error: "No token provided" });

		const payload = jwt.verify(token, process.env.JWT_SECRET);
		const addressFromToken = payload.publicKey;

		const userRef = db.ref(`users/${addressFromToken}`);

		const snapshot = await userRef.get();

		if (!snapshot.exists()) {
			return res.status(400).json({ error: "User doesn't exist" });
		}

		const pkg = packagesUSD[packageId];

		if (!pkg) return res.status(400).json({ error: "Pack invalid" });
		const lamports = await convertUSDToLamports(pkg.priceUSD);
		if (!lamports)
			return res.status(500).json({ error: "Error getting price" });

		const payerPubkey = new PublicKey(payerAddress);

		const tx = new Transaction();

		tx.add(
			SystemProgram.transfer({
				fromPubkey: payerPubkey,
				toPubkey: yourWalletAddress,
				lamports,
			})
		);

		const memoIx = new TransactionInstruction({
			keys: [],
			programId: MEMO_PROGRAM_ID,
			data: Buffer.from(packageId.toString(), "utf8"),
		});

		tx.add(memoIx);

		const { blockhash } = await connection.getLatestBlockhash();
		tx.recentBlockhash = blockhash;
		tx.feePayer = payerPubkey;

		const serializedTx = tx.serialize({
			requireAllSignatures: false,
			verifySignatures: false,
		});

		res.json({
			transaction: serializedTx.toString("base64"),
			lamports,
			success: true,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Error creating transaction" });
	}
});

app.post("/send-transaction", async (req, res) => {
	try {
		const { signedTransaction } = req.body;

		const token = req.headers.authorization?.split(" ")[1];
		if (!token) return res.status(401).json({ error: "No token provided" });

		const payload = jwt.verify(token, process.env.JWT_SECRET);
		console.log(payload);
		const addressFromToken = payload.publicKey;

		const rawTx = Buffer.from(signedTransaction, "base64");
		const tx = Transaction.from(rawTx);

		const { memoData, lamportsPaid } = extractMemoAndLamports(tx);
		let packageId = parseInt(memoData, 10);

		if (!packagesUSD[packageId]) {
			return res.status(400).json({ error: "Pack invalid memo" });
		}

		const expectedLamports = await convertUSDToLamports(
			packagesUSD[packageId].priceUSD
		);
		if (!expectedLamports)
			return res.status(500).json({ error: "Error getting price" });

		const minLamports = Math.floor(expectedLamports * (1 - PRICE_MARGIN));
		console.log({ memoData, lamportsPaid, minLamports });

		if (lamportsPaid < minLamports) {
			return res.status(400).json({ error: "Invalid lamporstPaid" });
		}

		const txid = await connection.sendRawTransaction(rawTx);

		const userRef = db.ref(`users/${addressFromToken}`);
		const tokensToAdd = packagesUSD[packageId].tokens || 0;

		userRef
			.transaction((userData) => {
				if (!userData) {
					return null;
				}

				let initialTokens = userData.roasterToken;

				if (
					typeof initialTokens !== "number" ||
					!Number.isFinite(initialTokens)
				) {
					initialTokens = 0;
				}

				const updatedTokens = initialTokens + tokensToAdd;

				userData.roasterToken = updatedTokens;

				return userData;
			})
			.then((result) => {
				if (result.committed) {
				} else {
					return res.status(400).json({ error: 400 });
				}
			})
			.catch((error) => {
				return res.status(500).json({ error: 500 });
			});

		res.json({
			success: true,
			txid,
			packageId,
			roasterToken: tokensToAdd,
		});
	} catch (error) {
		console.error(error);
		res
			.status(500)
			.json({ error: error.message || "Error sending transaction" });
	}
});

app.post("/auth/nonce", async (req, res) => {
	const body = req.body;
	const token = req.headers.authorization?.split(" ")[1];
	const { address } = body;
	const nonce =
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15);
	const usersRef = db.ref(`users/${address}`);
	if (token) {
		try {
			const decoded = jwt.verify(token, secretKey);
			const userToken = jwt.sign({ publicKey: address }, secretKey, {
				expiresIn: "600h",
			});
			const snapshot = await usersRef.get();

			const userData = snapshot.val();
			console.log(userData);
			return res.json({
				success: true,
				token: userToken,
				account: { address },
				userData,
			});
		} catch (err) {
			console.error("Token invalid:", err);
		}
	}
	usersRef.once("value").then((snapshot) => {
		if (!snapshot.exists()) {
			usersRef
				.set({ ...userModel, nonce })
				.then(() => res.status(201).json({ success: true, nonce }))
				.catch((err) => res.status(500).json({ error: err.message }));
		} else {
			const userData = snapshot.val();
			usersRef
				.update({ nonce })
				.then(() => res.status(200).json({ success: true, nonce, userData }))
				.catch((err) => res.status(500).json({ error: err.message }));
		}
	});
});

app.post("/auth/login", async (req, res) => {
	try {
		const { publicKey, signature, nonce } = req.body;

		const pk = new PublicKey(publicKey);
		const signatureBytes = Uint8Array.from(signature.data);
		const usersRef = db.ref(`users/${publicKey}`);

		const snapshot = await usersRef.child("nonce").once("value");
		const storedNonce = snapshot.val();
		const messageBytes = new TextEncoder().encode(storedNonce);
		if (!storedNonce) {
			return res.status(400).json({ error: "Nonce not found" });
		}
		const isVerified = nacl.sign.detached.verify(
			messageBytes,
			signatureBytes,
			pk.toBytes()
		);

		if (!isVerified) {
			return res.status(401).json({ error: "Sign invalid" });
		}

		const userToken = jwt.sign({ publicKey: publicKey }, secretKey, {
			expiresIn: "600h",
		});

		usersRef
			.once("value")
			.then((snapshot) => {
				if (!snapshot.exists()) {
					return res.status(404).json({ error: "User not found" });
				}

				const userData = snapshot.val();

				usersRef
					.update({ jwt: userToken })
					.then(() => {
						res.status(200).json({
							success: true,
							token: userToken,
							account: { address: publicKey },
							userData,
						});
					})
					.catch((error) => {
						console.error(error);
						res.status(500).json({ error: "Can't save jwt" });
					});
			})
			.catch((error) => {
				console.error(error);
				res.status(500).json({ error: "Database read error" });
			});
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ error });
	}
});

app.get("/", (req, res) => {
	res.send("Hello copper");
});

const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Backend  http://localhost:${PORT}`);
});
