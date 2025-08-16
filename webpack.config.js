const path = require("path");
const webpack = require("webpack");

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
		fallback: {
			stream: require.resolve("stream-browserify"),
			crypto: require.resolve("crypto-browserify"),
			buffer: require.resolve("buffer/"),
		},
	},
	plugins: [
		new webpack.ProvidePlugin({
			Buffer: ["buffer", "Buffer"],
		}),
	],
};
