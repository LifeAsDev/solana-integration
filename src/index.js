
const miBuffer = Buffer.from('¡Hola desde Buffer en el navegador con Webpack!', 'utf-8');
console.log("Buffer en Base64:", miBuffer.toString('base64'));
window.Buffer = require('buffer').Buffer; // Define Buffer globalmente

// Puedes seguir usando Buffer como lo harías en Node.js aquí...