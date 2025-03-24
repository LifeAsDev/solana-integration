import { getWallets } from "@wallet-standard/core";
import { isWalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import {
	Connection,
	PublicKey,
	SystemProgram,
	Transaction,
	VersionedTransaction,
	TransactionMessage,
} from "@solana/web3.js";
import {
	transact,
	Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";

window.Buffer = require("buffer").Buffer;

class SolanaWalletService {
	constructor(net, name, url, icon) {
		this.wallets = new Map();
		this.net = net || "https://api.devnet.solana.com";
		this.activeWallet = localStorage.getItem("activeWallet");
		this.initializeWallets();
		this.isMobile = false;
		this.APP_IDENTITY = {
			name: name || "Roast Rush",
			uri: url || "https://ff93-179-42-145-50.ngrok-free.app/",
			icon: icon || "public/icon-16.ico",
		};
		this.auth_token = undefined;
		this.cluster = net ? "solana:mainnet" : "solana:devnet";
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

	setMobile(isMobile) {
		this.isMobile = isMobile;
	}

	async transact() {
		const authorizationResult = await transact(async (wallet) => {
			const authorizationResult = await wallet.authorize({
				cluster: "solana:devnet",
				identity: this.APP_IDENTITY,
			});

			const auth_token = authorizationResult.auth_token;
			this.auth_token = auth_token;

			/* After approval, signing requests are available in the session. */
			return authorizationResult;
		});

		console.log("Connected to: " + authorizationResult.accounts[0].address);
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
				const event = new Event("onWalletDisconnected");
				document.dispatchEvent(event);
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
			return Array.from(this.wallets.values()).map((wallet) => {
				console.log({ wallet });

				return {
					name: wallet.name,
					iconUrl: wallet.icon,
				};
			});
		}
		return [];
	}

	async sendTransaction(
		wallet = this.wallets.get(this.activeWallet),
		recipient,
		amount
	) {
		const connection = new Connection(this.net, "confirmed");

		if ((!wallet || !wallet.publicKey) && !this.isMobile) {
			console.error("No wallet connected");
			this.activeWallet = null;
			return { success: false, error: "No wallet connected" };
		}

		if (!this.isMobile) {
			if (!recipient) recipient = this.wallets.get(this.activeWallet).publicKey;
			try {
				// Obtener el latest blockhash
				const { blockhash, lastValidBlockHeight } =
					await connection.getLatestBlockhash();

				// Crear la transacción
				const transaction = new Transaction().add(
					SystemProgram.transfer({
						fromPubkey: wallet.publicKey,
						toPubkey: new PublicKey(recipient),
						lamports: Math.round(amount * 10 ** 9), // Convertir SOL a lamports
					})
				);

				// Asignar recentBlockhash y feePayer
				transaction.recentBlockhash = blockhash;
				transaction.feePayer = wallet.publicKey;

				// Firmar la transacción

				const signatures = await wallet.signAndSendTransactions({
					transactions: [transaction],
					minContextSlot, // Add this
				});

				const signedTransaction = await wallet.signTransaction(transaction);

				// Enviar la transacción
				const signature = await connection.sendRawTransaction(
					signedTransaction.serialize(),
					{ skipPreflight: false, preflightCommitment: "confirmed" }
				);

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
		} else {
			try {
				const { blockhash, lastValidBlockHeight } =
					await connection.getLatestBlockhash();
				console.log(this.cluster);
				const txSignature = await transact(async (wallet) => {
					// Authorize the wallet session
					const authorizationResult = await wallet.authorize({
						chain: this.cluster,
						identity: this.APP_IDENTITY,
						auth_token: this.auth_token,
					});

					const rawAddress = authorizationResult.accounts[0].address;
					const authorizedPubkey = new PublicKey(
						Buffer.from(rawAddress, "base64")
					);

					const recipientPubkey = new PublicKey(recipient);

					// Crear instrucciones de la transacción
					const instructions = [
						SystemProgram.transfer({
							fromPubkey: authorizedPubkey,
							toPubkey: recipientPubkey,
							lamports: Math.round(amount * 10 ** 9),
						}),
					];

					// Construir el mensaje de la transacción
					const messageV0 = new TransactionMessage({
						payerKey: authorizedPubkey,
						recentBlockhash: blockhash,
						instructions,
					}).compileToV0Message();

					// Crear una transacción versionada
					const transferTx = new VersionedTransaction(messageV0);

					const signedTxs = await wallet.signTransactions({
						transactions: [transferTx],
					});

					return signedTxs;
				});

				const txid = await connection.sendTransaction(txSignature[0]);
				console.log("Transaction ID:", txid);

				const confirmationResult = await connection.confirmTransaction(
					{
						signature: txid,
						blockhash,
						lastValidBlockHeight,
					},
					"confirmed"
				); // 'confirmed', 'finalized' o 'processed'

				if (confirmationResult.value.err) {
					return { success: false, txid, error: confirmation.value.err };
				} else {
					console.log("Transaction successfully submitted!");
					return { success: true, txid };
				}
			} catch (error) {
				console.error("Error sending transaction:", error);

				// Si el error tiene logs, los capturamos
				const logs = error.logs ? error.logs : undefined;
				return { success: false, error, logs };
			}
		}
	}
	async sendMessage() {
		const message = "Hello world!";
		const messageBuffer = new Uint8Array(
			message.split("").map((c) => c.charCodeAt(0))
		);

		const signedMessages = await transact(async (wallet) => {
			// Authorize the wallet session.
			const authorizationResult = await wallet.authorize({
				cluster: "solana:devnet",
				identity: this.APP_IDENTITY,
				auth_token: this.auth_token,
			});

			// Request to sign the payload with the authorized account.
			const signedMessages = wallet.signMessages({
				addresses: [authorizationResult.accounts[0].address],
				payloads: [messageBuffer],
			});

			return signedMessages;
		});
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
	onWalletDisconnected(callback) {
		document.addEventListener("onWalletConnected", () => {
			const activeWallet = this.getConnectedWallet();
			return callback(activeWallet);
		});
	}
}

export default SolanaWalletService;
