
const miBuffer = Buffer.from('¡Hola desde Buffer en el navegador con Webpack!', 'utf-8');
console.log("Buffer en Base64:", miBuffer.toString('base64'));
window.Buffer = require('buffer').Buffer; // Define Buffer globalmente

// Puedes seguir usando Buffer como lo harías en Node.js aquí...
const solConnect = new window.SolanaConnect();

async function connectWallet() {
    if (solConnect) solConnect.openMenu();
}
function check() {
    if (solConnect) {
        console.log(solConnect.activeWallet);
        const wallet = solConnect.getWallet();
        sendTransaction(
            wallet,
            "HeMuWnMKPdrgkTay1swBP3WLd3eeZDWUy4PYPCPkvVDQ",
            0.001
        );
    }
}
const sendTransaction = async (
    wallet, // La wallet conectada (Phantom, Solflare, etc.)
    recipient, // Dirección del destinatario
    amount
) => {
    const { Connection, PublicKey, SystemProgram, Transaction } =
        solanaWeb3;
    const devnet = "https://api.devnet.solana.com";
    const mainnet =
        "https://solana-mainnet.g.alchemy.com/v2/su4NQiUu5uSE_3oMj-_riW_gHXqQPECJ";
    if (!wallet || !wallet.publicKey) {
        console.error("No hay una wallet conectada");
        return;
    }
    console.log({ wallet });
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

        console.log("Transacción enviada:", signature);
    } catch (error) {
        console.error("Error enviando la transacción:", error);
    }
};

function set() {
    const buf = Buffer.from("Hola, mundo!", "utf-8");
    console.log(buf.toString("hex"));
}
