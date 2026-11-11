// jest.setup.cjs
require("react-native-gesture-handler/jestSetup");
jest.mock("react-native-vector-icons/MaterialCommunityIcons", () => "Icon");
jest.mock("react-native-linear-gradient", () => "LinearGradient");
jest.mock("react-native-svg", () => ({
  __esModule: true,
  default: "Svg",
  Circle: "Circle",
  Ellipse: "Ellipse",
  Line: "Line",
  Path: "Path",
  Text: "SvgText"
}));
jest.mock("@react-native-documents/picker", () => ({
  pick: jest.fn(),
  keepLocalCopy: jest.fn(),
  saveDocuments: jest.fn(),
  types: { images: "image/*" },
  errorCodes: { OPERATION_CANCELED: "cancelled" },
  isErrorWithCode: (error) => typeof error?.code === "string"
}));
jest.mock("@bam.tech/react-native-image-resizer", () => ({
  createResizedImage: jest.fn()
}));
jest.mock("react-native-file-access", () => ({
  Dirs: { CacheDir: "E:/CodexTemp/guitar-release" },
  FileSystem: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn()
  }
}));
jest.mock("./src/components/performance-audio", () => ({
  performanceAudio: {
    start: jest.fn(),
    stop: jest.fn(),
    list: jest.fn(),
    play: jest.fn(),
    remove: jest.fn(),
    stopPlayback: jest.fn(),
    success: jest.fn(),
    guitar: jest.fn(),
    listen: () => ({ remove() {} })
  }
}));
jest.mock("react-native-webview", () => ({ WebView: "WebView" }));
jest.mock("react-native-permissions", () =>
  require("react-native-permissions/mock")
);
