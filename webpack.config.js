const path = require("path");
const { ProvidePlugin } = require("webpack"); // Usa require

module.exports = {
	// Usa module.exports
	mode: "production",
	entry: "./src/reown.js",
	output: {
		path: path.resolve(__dirname, "public"),
		filename: "mainModule.js",
		library: {
			type: "module",
		},
	},
	experiments: {
		outputModule: true,
	},
	target: "web",
	module: {
		rules: [
			{
				test: /\.js$/, // Archivos JS
				exclude: /node_modules/, // Excluye node_modules
				use: {
					loader: "babel-loader", // Usa babel-loader
				},
			},
		],
	},
	resolve: {
		extensions: [".js", ".mjs"],
		alias: {
			"react-native$": "react-native-web",
		},
	},
	plugins: [
		new ProvidePlugin({
			Buffer: ["buffer", "Buffer"],
		}),
	],
};
