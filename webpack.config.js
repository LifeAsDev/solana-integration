const path = require("path");
const webpack = require("webpack");

module.exports = {
	mode: "development", // o 'production' para el entorno de producción
	entry: {
		"dist/main.js": "./src/index.js",
		"public/main.js": "./src/index.js",
	},
	output: {
		path: path.resolve(__dirname, "./"), // Ruta absoluta a la carpeta de salida
		filename: "[name].js", // Nombre del archivo de salida
		publicPath: "/", // Ruta pública para el navegador (importante para dev-server)
	},

	devServer: {
		static: {
			directory: path.join(__dirname, "public"), // Ruta a la carpeta de archivos estáticos (index.html)
			publicPath: "/", // La ruta pública para acceder a los archivos estáticos
		},
		port: 8080,
		hot: true, // Habilita la recarga en caliente (opcional, pero recomendado)
	},
	module: {
		// Para procesar diferentes tipos de archivos (CSS, imágenes, etc.)
		rules: [
			// Ejemplo para procesar archivos CSS (si los tienes)
			{
				test: /\.css$/i,
				use: ["style-loader", "css-loader"],
			},
			// Ejemplo para procesar imágenes (si las tienes)
			{
				test: /\.(png|svg|jpg|jpeg|gif)$/i,
				type: "asset/resource",
			},
			//... otras reglas para otros tipos de archivos
		],
	},
	plugins: [
		new webpack.ProvidePlugin({
			Buffer: ["buffer", "Buffer"],
		}),
	],
	resolve: {
		fallback: {
			buffer: require.resolve("buffer"),
		},
	},
};
