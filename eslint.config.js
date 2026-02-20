const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const reactNativePlugin = require("eslint-plugin-react-native"); // импортируем плагин

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    plugins: {
      "react-native": reactNativePlugin // ✅ так подключаем
    },
    rules: {
      "no-console": [1, { allow: ["error", "info"] }],
      "no-unused-vars": [
        1,
        {
          vars: "all",
          args: "after-used",
          varsIgnorePattern: "^_$",
          argsIgnorePattern: "^_$"
        }
      ],

      // React Native правила
      "react-native/no-unused-styles": 2,
      "react-native/split-platform-components": 2,
      "react-native/no-inline-styles": 1,
      "react-native/no-color-literals": 1,

      // React hooks
      "react-hooks/rules-of-hooks": 2,
      "react-hooks/exhaustive-deps": 1,

      // Базовые ошибки
      "no-undef": 2,
      "import/no-cycle": 2,
      "react/prop-types": 2
    }
  }
]);
