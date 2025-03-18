import { getWallets } from "@wallet-standard/core";
import { isWalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import {
	Connection,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";

window.Buffer = require("buffer").Buffer;

class SolanaWalletService {
	constructor(net, isMobile) {
		this.wallets = new Map();
		this.net = net || "https://api.devnet.solana.com";
		this.activeWallet = localStorage.getItem("activeWallet");
		this.isMobile = isMobile;
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
				document.dispatchEvent(new Event("newWalletAvailable"));

				if (this.activeWallet === newWallet.name) {
					this.connectWallet(newWallet.name, true);
				}
			}
		};

		if (this.isMobile) {
			console.log("Inicializando WalletConnect...");
			const walletConnect = new WalletConnectWalletAdapter({
				network: "mainnet-beta",
				options: {
					relayUrl: "wss://relay.walletconnect.com",
					metadata: { name: "Mi App" },
				},
			});
			this.wallets.set("WalletConnect", walletConnect);
		} else {
			console.log("Inicializando Wallet Adapter estándar...");
			const availableWallets = getWallets();
			availableWallets.get().forEach(addWallet);
			this.walletsSubscription = availableWallets.on("register", addWallet);
		}
	}

	async connectWallet(walletName, skipStorage = false) {
		try {
			const wallet = this.wallets.get(walletName);
			if (!wallet) throw new Error(`Wallet not found: ${walletName}`);

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
				document.dispatchEvent(new Event("onWalletDisconnected"));
			});

			this.activeWallet = walletName;
			document.dispatchEvent(new Event("onWalletConnected"));

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
		return this.activeWallet && this.wallets.get(this.activeWallet)?.connected
			? this.wallets.get(this.activeWallet)
			: null;
	}

	getWallets() {
		return this.wallets.size > 0
			? Array.from(this.wallets.values()).map((wallet) => ({
					name: wallet.name,
					iconUrl: wallet.icon,
			  }))
			: [];
	}

	async sendTransaction(walletName, recipient, amount) {
		const connection = new Connection(this.net, "confirmed");
		const wallet = this.wallets.get(walletName);

		if (!wallet || !wallet.publicKey) {
			console.error("No wallet connected");
			return { success: false, error: "No wallet connected" };
		}

		try {
			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash();

			const transaction = new Transaction().add(
				SystemProgram.transfer({
					fromPubkey: wallet.publicKey,
					toPubkey: new PublicKey(recipient),
					lamports: Math.round(amount * 10 ** 9),
				})
			);

			transaction.recentBlockhash = blockhash;
			transaction.feePayer = wallet.publicKey;

			const signedTransaction = await wallet.signTransaction(transaction);
			const signature = await connection.sendRawTransaction(
				signedTransaction.serialize(),
				{ skipPreflight: false, preflightCommitment: "confirmed" }
			);

			console.log("Transaction sent:", signature);

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
			return { success: false, error, logs: error.logs || undefined };
		}
	}

	onNewWalletAvailable(callback) {
		document.addEventListener("newWalletAvailable", () =>
			callback(this.getWallets())
		);
	}

	onWalletConnected(callback) {
		document.addEventListener("onWalletConnected", () =>
			callback(this.getConnectedWallet())
		);
	}

	onWalletDisconnected(callback) {
		document.addEventListener("onWalletDisconnected", () => callback(null));
	}
}

export default SolanaWalletService;
