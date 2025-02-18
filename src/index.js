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
				const event = new Event("newWalletAvailable");
				document.dispatchEvent(event);

				if (this.activeWallet === newWallet.name) {
					this.connectWallet(newWallet.name, true);
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
				localStorage.removeItem("activeWallet");
				throw new Error(`Wallet not connected: ${walletName}`);
			}
			wallet.on("disconnect", () => {
				wallet.removeListener("disconnect");
				console.log("Disconnected", wallet.name);
				this.activeWallet = null;
				localStorage.removeItem("activeWallet");
			});
			this.activeWallet = walletName;
			const event = new Event("onWalletConnected");
			document.dispatchEvent(event);
			if (!skipStorage) {
				localStorage.setItem("activeWallet", walletName);
			}
			return wallet;
		} catch (error) {
			localStorage.removeItem("activeWallet");

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
			if (
				this.wallets.get(this.activeWallet) &&
				this.wallets.get(this.activeWallet).connected
			)
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
		wallet = this.wallets.get(this.activeWallet),
		recipient = this.wallets.get(this.activeWallet).publicKey,
		amount
	) {
		const devnet = "https://api.devnet.solana.com";
		const connection = new Connection(devnet, "confirmed");

		if (!wallet || !wallet.publicKey) {
			console.error("No wallet connected");
			this.activeWallet = null;
			return { success: false, error: "No wallet connected" };
		}

		try {
			// Obtener el latest blockhash
			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash();

			// Crear la transacción
			const transaction = new Transaction().add(
				SystemProgram.transfer({
					fromPubkey: wallet.publicKey,
					toPubkey: new PublicKey(recipient),
					lamports: amount * 10 ** 9, // Convertir SOL a lamports
				})
			);

			// Asignar recentBlockhash y feePayer
			transaction.recentBlockhash = blockhash;
			transaction.feePayer = wallet.publicKey;

			// Firmar la transacción
			const signedTransaction = await wallet.signTransaction(transaction);

			// Enviar la transacción
			const signature = await connection.sendRawTransaction(
				signedTransaction.serialize(),
				{ skipPreflight: false, preflightCommitment: "confirmed" }
			);

			console.log("Transaction sent:", signature);

			// Confirmar la transacción
			const confirmation = await connection.confirmTransaction(
				{ signature, blockhash, lastValidBlockHeight },
				"confirmed"
			);

			if (confirmation.value.err) {
				console.error("Transaction failed:", confirmation.value.err);
				return { success: false, signature, error: confirmation.value.err };
			}

			console.log("Transaction confirmed:", signature);
			return { success: true, signature };
		} catch (error) {
			console.error("Error sending transaction:", error);

			// Si el error tiene logs, los capturamos
			const logs = error.logs ? error.logs : undefined;
			return { success: false, error, logs };
		}
	}

	onNewWalletAvailable(callback) {
		document.addEventListener("newWalletAvailable", () => {
			const wallets = this.getWallets();
			return callback(wallets);
		});
	}

	onWalletConnected(callback) {
		document.addEventListener("onWalletConnected", () => {
			const activeWallet = this.getConnectedWallet();
			return callback(activeWallet);
		});
	}
}

export default SolanaWalletService;
