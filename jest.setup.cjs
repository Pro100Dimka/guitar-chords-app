// jest.setup.cjs
require("react-native-gesture-handler/jestSetup");
jest.mock("react-native-webview", () => ({ WebView: "WebView" }));
jest.mock("react-native-permissions", () =>
  require("react-native-permissions/mock")
);
