import { createAppKit } from "@reown/appkit";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { solana, solanaDevnet } from "@reown/appkit/networks";
import {
	PublicKey,
	LAMPORTS_PER_SOL,
	Transaction,
	SystemProgram,
	Connection,
} from "@solana/web3.js";

const solanaWeb3JsAdapter = new SolanaAdapter();

const projectId = "61f529aa30c77838f2502740d05202ad";

const metadata = {
	name: "Roast Rush",
	description: "Roast Rush game",
	url: "https://roastrush.ai/", // origin must match your domain & subdomain
	icons: ["icons/icon-16.png"],
};

// 3. Create modal
const modal = createAppKit({
	adapters: [solanaWeb3JsAdapter],
	networks: [solana, solanaDevnet],
	metadata: metadata,
	projectId,
	features: {
		analytics: true, // Optional - defaults to your Cloud configuration
	},
});

let solanaProvider = {};
let solanaConnection = {};

modal.subscribeProviders((state) => {
	solanaProvider = state["solana"];
	const url = solanaProvider.getActiveChain().rpcUrls.default.http[0];
	solanaConnection = new Connection(url);
});

/* modal.subscribeProviders((state) => {
	console.log({ state });
	solanaProvider = state["solana"];
	const url = solanaProvider.getActiveChain().rpcUrls.default.http[0];
	solanaConnection = new Connection("https://api.devnet.solana.com");
	console.log("Switched to Devnet:", url); // Confirmar el cambio
}); */

class SolanaWalletService {
	constructor(net, name, url, icon) {
		this.wallets = new Map();
		this.activeWallet = this.getConnectedWallet();
		// this.initializeWallets();

		this.isMobile = false;

		this.APP_IDENTITY = {
			name: name || "Roast Rush",
			uri: url || "https://ff93-179-42-145-50.ngrok-free.app/",
			icon: icon || "public/icon-16.ico",
		};
		this.auth_token = undefined;
	}

	initializeWallets() {
		// const account = modal.getAccount()

		// modal.open()
		console.log("Initializing wallet");
	}

	setMobile(isMobile) {
		this.isMobile = isMobile;
	}

	async transact() {
		console.log("Transact called");
	}

	async connectWallet() {
		return new Promise(async (resolve) => {
			console.log("connectWallet called");
			const acct = modal.getAccount("solana");
			if (acct && acct.isConnected) {
				resolve(acct);
				console.log(acct);
				return;
			}
			modal.open();
			const unsubscribe = modal.subscribeState((state) => {
				if (!state.open) {
					unsubscribe();
					resolve(modal.getAccount("solana"));
				}
			});
		});
	}

	async disconnectWallet() {
		try {
			modal.disconnect("solana");
			console.log("Disconnect wallet called");
		} catch (error) {
			console.error("Error disconnecting wallet:", error);
			throw error;
		}
	}

	getConnectedWallet() {
		const acct = modal.getAccount("solana");
		const address = acct.address;
		return address;
	}

	getWallets() {
		const walletInfo = modal.getWalletInfo();
		if (walletInfo) {
			return [
				{
					name: walletInfo.name,
					icon: walletInfo.icon,
				},
			];
		}

		return [];
	}

	async sendTransaction(wallet, recipient, amount) {
		let acct = modal.getAccount("solana");

		if (!acct && !acct.address) {
			acct = await this.connectWallet();
			if (!acct) {
				console.error("No account found");
				return { success: false };
			}
		}
		const addressFrom = acct.address;

		const wallets = new PublicKey(addressFrom);

		const latestBlockhash = await solanaConnection.getLatestBlockhash();

		const transaction = new Transaction({
			feePayer: wallets,
			recentBlockhash: latestBlockhash?.blockhash,
		}).add(
			SystemProgram.transfer({
				fromPubkey: wallets,
				toPubkey: new PublicKey(recipient), // destination address
				lamports: Math.round(amount * 10 ** 9),
			})
		);
		try {
			const signedTransaction = await solanaProvider.signTransaction(
				transaction
			);
			const signature = await solanaConnection.sendRawTransaction(
				signedTransaction.serialize()
			);
			await solanaConnection.confirmTransaction(signature);

			return { success: true, signature };
		} catch (error) {
			console.error("Error sending transaction:", error);
			return { success: false, error: error.message };
		}
	}
	async sendMessage() {
		console.log("Send message called");
	}
	onNewWalletAvailable(callback) {
		console.log("Wallet avaiable callback");
	}

	onWalletConnected(callback) {
		console.log("Wallet connected callback wtf");
	}
	onWalletDisconnected(callback) {
		console.log("Wallet disconnect called");
	}
}

export default SolanaWalletService;
