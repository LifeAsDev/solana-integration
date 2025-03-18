import SolanaWalletService from "./public/mainModule.js";

const solanaWalletService = new SolanaWalletService(
	"https://solana-mainnet.g.alchemy.com/v2/su4NQiUu5uSE_3oMj-_riW_gHXqQPECJ",
	true
);

solanaWalletService.onWalletConnected((activeWallet) => {
	if (activeWallet) {
		const walletText = `${activeWallet.name}\n${activeWallet.publicKey}`;
		console.log(walletText);
	} else {
		console.log("No wallet connected");
	}
});

solanaWalletService.onNewWalletAvailable((wallets) => {
	console.log(wallets);

	// Seleccionamos el contenedor donde queremos agregar las imágenes
	const container = document.getElementById("wallets-container");
	if (!container) return; // Verificamos que el contenedor existe

	// Limpiamos el contenedor antes de agregar nuevas imágenes
	container.innerHTML = "";

	// Agregamos cada wallet al DOM
	wallets.forEach((wallet) => {
		const img = document.createElement("img");
		img.src = wallet.iconUrl;
		img.alt = wallet.name;
		img.width = 50; // Ajusta el tamaño según sea necesario
		img.height = 50;
		img.style.margin = "5px"; // Espaciado entre imágenes

		container.appendChild(img);
	});
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
