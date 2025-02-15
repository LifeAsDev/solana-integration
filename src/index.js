import { getWallets } from "@wallet-standard/core";
import { isWalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import {
	Connection,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";

window.Buffer = require("buffer").Buffer;

class SolanaWalletService {
	constructor() {
		this.wallets = new Map();
		this.activeWallet = localStorage.getItem("activeWallet");
		this.initializeWallets();
	}

	initializeWallets() {
		const addWallet = (newWallet) => {
			if (
				isWalletAdapterCompatibleStandardWallet(newWallet) &&
				!this.wallets.has(newWallet.name)
			) {
				console.log("Adding wallet", newWallet.name);
				const walletAdapter = new StandardWalletAdapter({ wallet: newWallet });
				this.wallets.set(newWallet.name, walletAdapter);
				if (this.activeWallet === newWallet.name) {
					this.connectWallet(this.activeWallet);
				}
			}
		};

		const availableWallets = getWallets();
		availableWallets.get().forEach(addWallet);

		this.walletsSubscription = availableWallets.on("register", addWallet); // Store for cleanup
	}

	async connectWallet(walletName, skipStorage = false) {
		try {
			const wallet = this.wallets.get(walletName);

			if (!wallet) {
				throw new Error(`Wallet not found: ${walletName}`);
			}
			await wallet.connect();

			if (!wallet.connected || !wallet.publicKey) {
				throw new Error(`Wallet not connected: ${walletName}`);
			}
			wallet.on("disconnect", () => {
				wallet.removeListener("disconnect");
				console.log("Disconnected", wallet.name);
				this.activeWallet = null;
			});

			this.activeWallet = walletName;
			if (!skipStorage) {
				localStorage.setItem("activeWallet", walletName);
			}
			return wallet;
		} catch (error) {
			console.error("Error connecting wallet:", error);
			throw error;
		}
	}

	async disconnectWallet() {
		try {
			if (this.activeWallet) {
				const wallet = this.wallets.get(this.activeWallet);
				if (wallet) {
					await wallet.disconnect();
					this.activeWallet = null;
					console.log("Disconnected", wallet.name);
				}
			}
		} catch (error) {
			console.error("Error disconnecting wallet:", error);
			throw error;
		}
	}

	getConnectedWallet() {
		if (this.activeWallet) {
			return this.wallets.get(this.activeWallet) || null;
		}
		return null;
	}
	getWallets() {
		if (this.wallets.size > 0) {
			return Array.from(this.wallets.keys());
		}
		return [];
	}
	async sendTransaction(
		wallet = this.wallets(this.activeWallet),
		recipient = this.wallets(this.activeWallet),
		amount
	) {
		const devnet = "https://api.devnet.solana.com";

		const mainnet =
			"https://solana-mainnet.g.alchemy.com/v2/su4NQiUu5uSE_3oMj-_riW_gHXqQPECJ";

		if (!wallet || !wallet.publicKey) {
			console.error("No wallet connected");
			return;
		}

		const connection = new Connection(devnet, "confirmed");

		const transaction = new Transaction().add(
			SystemProgram.transfer({
				fromPubkey: wallet.publicKey,
				toPubkey: new PublicKey(recipient),
				lamports: amount * 10 ** 9, // Convertir SOL a lamports
			})
		);

		try {
			const { blockhash } = await connection.getLatestBlockhash();

			// 2. Asignar el recentBlockhash a la transacción
			transaction.recentBlockhash = blockhash;
			transaction.feePayer = wallet.publicKey; // Establecer el fee payer (¡Importante!)

			// 3. Firmar la transacción
			const signedTransaction = await wallet.signTransaction(transaction);

			// 4. Serializar la transacción firmada
			const serializedTransaction = signedTransaction.serialize();

			// 5. Enviar la transacción
			const { signature } = await connection.sendRawTransaction(
				serializedTransaction
			);

			console.log("Transaction sent:", signature);
		} catch (error) {
			console.error("Error sending transaction:", error);
		}
	}
}

export default SolanaWalletService;
