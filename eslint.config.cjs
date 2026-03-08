// .eslintrc.cjs
const globals = require("globals");

module.exports = {
  ignores: [
    "node_modules/**",
    "dist/**",
    "build/**",
    "ios/**",
    "android/**",
    "web/**",
    "*.cjs"
  ],
  files: ["src/**/*.{ts,tsx,js,jsx}"],
  languageOptions: {
    parser: require("@typescript-eslint/parser"),
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      project: "./tsconfig.json",
      ecmaFeatures: { jsx: true }
    },
    globals: {
      ...globals.node,
      ...globals.browser,
      ...globals.jest,
      ...globals.amd,
      alert: "readonly"
    }
  },
  plugins: {
    react: require("eslint-plugin-react"),
    "react-native": require("eslint-plugin-react-native"),
    "react-hooks": require("eslint-plugin-react-hooks"),
    import: require("eslint-plugin-import"),
    "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
    prettier: require("eslint-plugin-prettier")
  },
  rules: {
    "no-console": [1, { allow: ["error", "info", "warn", "debug"] }],
    "no-unused-vars": "off", // отключаем стандартное правило
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        vars: "all",
        args: "after-used",
        varsIgnorePattern: "^_$",
        argsIgnorePattern: "^_$"
      }
    ],
    "react-native/no-unused-styles": 2,
    "react-native/split-platform-components": 2,
    "react-native/no-inline-styles": 1,
    "react-native/no-color-literals": 1,
    "react-hooks/rules-of-hooks": 2,
    "react-hooks/exhaustive-deps": 1,
    "no-undef": 2,
    "import/no-cycle": 2,
    "react/prop-types": 2,
    "prettier/prettier": ["error"],
    semi: 0
  },
  settings: {
    react: { version: "detect" }
  }
};
