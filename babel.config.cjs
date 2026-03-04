module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["babel-plugin-react-compiler"],
      [
        "module-resolver",
        {
          alias: {
            "react/compiler-runtime": "react-compiler-runtime"
          }
        }
      ]
    ]
  };
};
