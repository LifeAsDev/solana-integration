import SolanaWalletService from "./mainModule/mainModule.js";
import {
	installApp,
	isAppInstalled,
	shareOnWhatsApp,
	deferredPrompt,
} from "./script.js";
import {
	Transaction as SolanaTransaction,
	Buffer,
	solanaProvider,
	modal,
} from "./mainModule/mainModule.js";

const appInstall = isAppInstalled();

const backendUrl = "http://localhost:3000";

const solanaWalletService = new SolanaWalletService({
	backendUrl: backendUrl,
	net: "https://api.devnet.solana.com",
});

let token = null;

const connectWallet = async () => {
	const rest = await solanaWalletService.connectWallet();
	localStorage.setItem(`jwt-${rest.account.address}`, rest.token);

	token = rest.token || null;
	return rest;
};
const sendPayment = async (pack) => {
	const requestTransaction = async (address, pack) => {
		const headers = { "Content-Type": "application/json" };
		if (token) headers["Authorization"] = `Bearer ${token}`;
		const apiResponse = await fetch(`${backendUrl}/create-transaction`, {
			method: "POST",
			headers: headers,
			body: JSON.stringify({ payerAddress: address, packageId: pack }),
		});
		if (!apiResponse.ok) return { success: false };
		return apiResponse.json();
	};

	const sendSignedTransaction = async (signedTransactionBase64) => {
		const headers = { "Content-Type": "application/json" };
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const apiResponse = await fetch(`${backendUrl}/send-transaction`, {
			method: "POST",
			headers: headers,
			body: JSON.stringify({
				signedTransaction: signedTransactionBase64,
			}),
		});

		if (!apiResponse.ok) return { success: false };

		return apiResponse.json();
	};
	if (!token) return { success: false, error: "No token found" };
	let acct = modal.getAccount("solana");
	if (!acct && !acct.address) {
		acct = await this.connectWallet();
		if (!acct) {
			console.error("No account found");
			return { success: false };
		}
	}
	const addressFrom = acct.address;

	const transactionResponse = await requestTransaction(addressFrom, pack);
	const transaction = transactionResponse.transaction;
	if (transactionResponse.success) {
		try {
			const bufferTx = Buffer.from(transaction, "base64");
			const transactionFrom = SolanaTransaction.from(bufferTx);

			const signedTransaction = await solanaProvider.signTransaction(
				transactionFrom
			);
			const signedTransactionResponse = await sendSignedTransaction(
				signedTransaction.serialize().toString("base64")
			);

			return signedTransactionResponse;
		} catch {
			return { success: false, error: "Error signing transaction" };
		}
	}
	return { success: false };
};

async function svgToPng(svgDataUrl, width, height) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");

			if (!ctx) {
				reject("No se pudo obtener el contexto del canvas");
				return;
			}

			ctx.drawImage(img, 0, 0, width, height);
			resolve(canvas.toDataURL("image/png"));
		};
		img.onerror = (error) => reject(error);
		img.src = svgDataUrl;
	});
}

async function convertUSDToSOL(usdAmount) {
	try {
		// Obtener la tasa de cambio actual desde una API confiable
		const response = await fetch(
			"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
		);
		const data = await response.json();

		// Extraer la tasa de cambio
		const exchangeRate = data.solana.usd;
		if (!exchangeRate) throw new Error("No se pudo obtener la tasa de cambio");

		// Convertir USD a SOL
		const solAmount = usdAmount / exchangeRate;
		return solAmount;
	} catch (error) {
		console.error("Error al convertir USD a SOL:", error);
		return null;
	}
}

const text = "Play ROAST RUSH!";
const url = "https://roastRush.com";
// const imageUrl = "https://leafy-paprenjak-fff616.netlify.app/Screenshot_7.png";
const imageUrl = "";

function shareWhatsApp(text, imageUrl = false) {
	let message = `${text}`;
	if (imageUrl) message += `\n${imageUrl}`;
	const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
	window.open(whatsappUrl, "_blank");
}

function shareX(text, imageUrl = false) {
	let tweet = `${text}`;
	if (imageUrl) tweet += ` ${imageUrl}`;
	const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
		tweet
	)}`;
	window.open(xUrl, "_blank");
}

function shareOnTelegram(url, text) {
	const baseUrl = "https://t.me/share/url?";
	const params = new URLSearchParams({ url });

	if (text) {
		params.append("text", text);
	}

	const telegramUrl = `${baseUrl}${params.toString()}`;
	window.open(telegramUrl, "_blank");
}

function copyToClipboardFallback(text) {
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed"; // evita que salte el scroll
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();

	try {
		const successful = document.execCommand("copy");
		console.log("Fallback copy:", successful ? "success" : "fail");
	} catch (err) {
		console.error("Fallback copy error:", err);
	}

	document.body.removeChild(textarea);
}
