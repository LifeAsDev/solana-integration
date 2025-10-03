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
function addPoints(userData, points, currentSeason) {
	if (!userData.masterScore) {
		userData.masterScore = {};
	}
	const seasonKey = `season${currentSeason}`;

	userData.masterScore.global = (userData.masterScore.global || 0) + points;

	userData.masterScore[seasonKey] =
		(userData.masterScore[seasonKey] || 0) + points;

	return userData;
}

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
	const { address, referKey } = body;
	const nonce =
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15);
	console.log(address, referKey);
	const usersRef = db.ref(`users/${address}`);
	if (token) {
		try {
			const decoded = jwt.verify(token, secretKey);
			if (decoded.publicKey !== address) {
			} else {
				const snapshot = await usersRef.get();
				if (snapshot.exists()) {
					const userToken = jwt.sign({ publicKey: address }, secretKey, {
						expiresIn: "600h",
					});
					const userData = snapshot.val();

					return res.json({
						success: true,
						token: userToken,
						account: { address },
						userData,
					});
				}
			}
		} catch (err) {
			console.error("Token invalid:", err);
		}
	}
	usersRef.once("value").then((snapshot) => {
		if (!snapshot.exists()) {
			usersRef
				.set({ ...userModel, nonce, referKey: referKey || null })
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
const powerUps = {
	doubleJump: 30,
	doublePoints: 20,
	doubleSpeed: 10,
	moreEnemy: 50,
	moreStar: 30,
	burn: 10,
};
app.post("/api/buy-powerup", async (req, res) => {
	const { powerUpId } = req.body;
	const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
	if (!token) return res.status(401).json({ error: "No token provided" });

	const payload = jwt.verify(token, process.env.JWT_SECRET);
	const addressFromToken = payload.publicKey;

	if (!powerUps.hasOwnProperty(powerUpId)) {
		return res.status(400).json({ error: "Invalid power-up" });
	}

	const cost = powerUps[powerUpId];
	const userRef = db.ref(`users/${addressFromToken}`);
	console.log(addressFromToken, powerUpId, cost);
	const seasonKeyRef = db.ref("season");
	const currentSeason = (await seasonKeyRef.get()).val();

	userRef
		.transaction((userData) => {
			console.log("Transaction started", userData);
			if (userData === null) {
				return null;
			}

			let currentTokens = userData.roasterToken || 0;
			if (currentTokens < cost) {
				console.log("Insufficient funds", currentTokens, cost);
				return;
			}
			userData.roasterToken = currentTokens - cost;

			if (powerUpId === "burn") {
				userData = addPoints(userData, 1000, currentSeason);
			} else {
				userData[powerUpId] = (userData[powerUpId] || 0) + 1;
			}

			return userData;
		})
		.then((result) => {
			if (result.committed) {
				res.status(200).json({
					success: true,
					message: "Purchase successful",
					newRoasterTokens: result.snapshot.val().roasterToken,
					powerUp: { [powerUpId]: result.snapshot.val()[powerUpId] },
				});
			} else {
				res.status(400).json({
					success: false,
					message:
						"Purchase failed. Insufficient funds or user does not exist.",
				});
			}
		})
		.catch((error) => {
			res.status(500).json({
				success: false,
				message: "Server error during purchase.",
				error: error.message,
			});
		});
});

app.get("/api/leaderboard/season", async (req, res) => {
	try {
		const token = req.headers.authorization?.split(" ")[1];
		if (!token) return res.status(401).json({ error: "No token provided" });

		const payload = jwt.verify(token, process.env.JWT_SECRET);
		const addressFromToken = payload.publicKey;

		const currentSeason = (await db.ref("season").get()).val();

		const usersSnap = await db.ref("users").get();
		const users = usersSnap.val() || {};

		let leaderboard = Object.entries(users).map(([userId, userData]) => {
			const score = userData?.masterScore?.[`season${currentSeason}`] || 0;
			return {
				id: userId.slice(0, 4),
				score,
				isYou: userId === addressFromToken,
			};
		});

		leaderboard.sort((a, b) => b.score - a.score);
		leaderboard = leaderboard.slice(0, 10);

		res.json({ success: true, leaderboard });
	} catch (err) {
		console.error("Leaderboard season error:", err);
		res.status(500).json({ success: false, message: "Server error" });
	}
});
function updateLevelProgress(userData, levelId, score, stars, currentSeason) {
	levelId = `level${levelId}`; // level1, level2, level3

	if (!userData.levels) userData.levels = {};
	if (!userData.masterScore) userData.masterScore = {};

	if (!userData.levels[levelId]) {
		userData.levels[levelId] = { highScore: 0, stars: 0 };
	}

	if (score > (userData.levels[levelId].highScore || 0)) {
		userData.levels[levelId].highScore = score;
	}

	if (stars > (userData.levels[levelId].stars || 0)) {
		userData.levels[levelId].stars = stars;
	}

	for (const key of Object.keys(powerUps)) {
		if (key != "burn" && userData[key] > 0) {
			userData[key] -= 1;
		}
	}

	userData.masterScore.global = (userData.masterScore.global || 0) + score;
	const seasonKey = `season${currentSeason}`;
	userData.masterScore[seasonKey] =
		(userData.masterScore[seasonKey] || 0) + score;

	return userData;
}

app.get("/api/leaderboard/global", async (req, res) => {
	try {
		console.log(req.headers);

		const token = req.headers.authorization?.split(" ")[1];
		if (!token) return res.status(401).json({ error: "No token provided" });
		const payload = jwt.verify(token, process.env.JWT_SECRET);
		const addressFromToken = payload.publicKey;

		const usersSnap = await db.ref("users").get();
		const users = usersSnap.val() || {};

		let leaderboard = Object.entries(users).map(([userId, userData]) => {
			const score = userData?.masterScore?.global || 0;
			return {
				id: userId.slice(0, 4),
				score,
				isYou: userId === addressFromToken,
			};
		});

		leaderboard.sort((a, b) => b.score - a.score);
		leaderboard = leaderboard.slice(0, 10);

		res.json({ success: true, leaderboard });
	} catch (err) {
		console.error("Leaderboard global error:", err);
		res.status(500).json({ success: false, message: "Server error" });
	}
});
const minIntervalBetweenSubmits = 15 * 1000;

app.post("/api/update-level", async (req, res) => {
	const { levelId, score, stars } = req.body;
	const token = req.headers.authorization?.split(" ")[1];
	if (!token) return res.status(401).json({ error: "No token provided" });

	const payload = jwt.verify(token, process.env.JWT_SECRET);
	const addressFromToken = payload.publicKey;
	console.log("/api/update-level", addressFromToken, levelId, score, stars);

	const currentSeason = (await db.ref("season").get()).val();
	const userRef = db.ref(`users/${addressFromToken}`);

	userRef
		.transaction((userData) => {
			if (!userData) return null;
			const levelNum = Number(levelId);
			userData.levelNotUnlocked = false;

			if (levelNum !== 0) {
				const previousLevelId = `level${levelNum - 1}`;
				if (
					!userData.levels ||
					!userData.levels[previousLevelId] ||
					(userData.levels[previousLevelId].highScore || 0) === 0
				) {
					console.log(`Level ${levelNum} is not unlocked for this user.`);
					userData.levelNotUnlocked = true;
					return userData;
				}
			}
			const now = Date.now();

			if (
				userData.lastSubmitAt &&
				now - userData.lastSubmitAt < minIntervalBetweenSubmits
			) {
				console.log("Rate limit exceeded");
				userData.rateLimitExceeded = true;
				return userData;
			}
			userData.rateLimitExceeded = false;

			const lvl = parseInt(levelId, 10);
			const maxScore = (lvl + 1) * 9000 + 3000;
			if (score > maxScore) {
				console.log("Score too high", score, maxScore);
				userData.scoreTooHigh = true;
				return userData;
			}

			userData = updateLevelProgress(
				userData,
				levelId,
				score,
				stars,
				currentSeason
			);
			userData.lastSubmitAt = now;
			userData.scoreTooHigh = false;
			console.log(userData.rateLimitExceeded);

			return userData;
		})
		.then((result) => {
			const userData = result.snapshot.val();

			if (userData.levelNotUnlocked) {
				return res.status(403).json({
					success: false,
					message: `Level ${levelId} is not unlocked.`,
				});
			}

			if (userData.rateLimitExceeded) {
				console.log(userData.rateLimitExceeded, " rate limit");
				return res.status(429).json({
					success: false,
					message: "Too many submissions. Try later.",
				});
			}

			if (userData.scoreTooHigh) {
				return res.status(400).json({
					success: false,
					message: "Score exceeds maximum for this level.",
				});
			}

			if (!result.committed) {
				return res
					.status(400)
					.json({ success: false, message: "Update failed" });
			}

			res.json({
				success: true,
				level: userData.levels[levelId],
				masterScore: userData.masterScore,
			});
		})
		.catch((error) => {
			if (error.message === "Too many submissions. Try later.") {
				return res.status(429).json({ success: false, message: error.message });
			}
			res.status(500).json({ success: false, error: error.message });
		});
});

const availableTasks = {
	followX: 2000,
	telegramJoin: 2000,
};

app.post("/api/claim-task", async (req, res) => {
	try {
		const { taskId } = req.body;
		const token = req.headers.authorization?.split(" ")[1];
		if (!token) return res.status(401).json({ error: "No token provided" });

		const payload = jwt.verify(token, process.env.JWT_SECRET);
		const addressFromToken = payload.publicKey;

		if (!availableTasks.hasOwnProperty(taskId)) {
			return res.status(400).json({ success: false, error: "Invalid taskId" });
		}

		const userRef = db.ref(`users/${addressFromToken}`);
		const seasonKeyRef = db.ref("season");
		const currentSeason = (await seasonKeyRef.get()).val();

		userRef
			.transaction((userData) => {
				if (!userData) return null;

				if (userData.tasks && userData.tasks[taskId]) {
					return userData;
				}

				if (!userData.tasks) {
					userData.tasks = {};
				}

				userData.tasks[taskId] = true;

				userData = addPoints(userData, availableTasks[taskId], currentSeason);

				return userData;
			})
			.then((result) => {
				if (!result.committed) {
					return res.status(400).json({
						success: false,
						message: "Task already claimed or user not found",
					});
				}

				const userData = result.snapshot.val();

				res.json({
					success: true,
					message: `Task ${taskId} claimed successfully`,
					pointsAwarded: availableTasks[taskId],
					masterScore: userData.masterScore,
					tasks: userData.tasks,
				});
			})
			.catch((err) => {
				console.error("Error claiming task:", err);
				res.status(500).json({ success: false, error: err.message });
			});
	} catch (error) {
		console.error("Error /api/claim-task:", error);
		res.status(500).json({ success: false, error: error.message });
	}
});

app.get("/", (req, res) => {
	res.send("Hello copper");
});
const PORT = 3000;
app.listen(PORT, "127.0.0.1", () => {
	console.log(`Listening http://127.0.0.1:${PORT}`);
});
