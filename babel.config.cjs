// babel.config.cjs
module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [
    "@babel/plugin-transform-export-namespace-from",
    [
      "module-resolver",
      {
        root: ["./src"],
        alias: {
          "@": "./src"
        }
      }
    ],
    "react-native-reanimated/plugin"
  ]
};
