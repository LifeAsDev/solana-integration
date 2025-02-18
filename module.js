import SolanaWalletService from "./public/mainModule.js";

const solanaWalletService = new SolanaWalletService();

solanaWalletService.onWalletConnected((activeWallet) => {
	if (activeWallet) {
		const walletText = `${activeWallet.name}\n${activeWallet.publicKey}`;
		console.log(walletText);
	} else {
		console.log("No wallet connected");
	}
});

let activeWallet;

const element2 = document.getElementById("check");
element2.addEventListener("click", () => {
	activeWallet = solanaWalletService.getConnectedWallet();
	console.log({ activeWallet });
});

const element = document.getElementById("pagar");
element.addEventListener("click", async () => {
	await solanaWalletService.sendTransaction(undefined, undefined, 0.1);
});

const element3 = document.getElementById("connect");
element3.addEventListener("click", () => {
	solanaWalletService.connectWallet("Solflare");
});
