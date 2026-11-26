// __tests__/App.test.tsx
import React from "react";
import ReactTestRenderer from "react-test-renderer";
import App from "../src/app";
import Router from "../src/router";
import { initDatabase } from "../src/components/database";
import { initLanguage } from "../src/locales";
import SplashScreen from "react-native-splash-screen";
import { AppState, Platform, Text, type AppStateStatus } from "react-native";
import {
  flushPreferences,
  loadPreferences
} from "../src/components/preferences";
jest.mock("@shopify/react-native-skia", () => {
  const fonts = {};
  return { useFonts: () => fonts };
});
jest.mock("../assets/fonts", () => ({}));

let mockTunerReady: (() => void) | undefined;
jest.mock("@react-navigation/native", () => ({
  useNavigationContainerRef: () => ({
    current: { getCurrentRoute: () => ({ name: "tuner" }) }
  })
}));
jest.mock("../src/router", () => () => {
  mockTunerReady = require("react").useContext(
    require("../src/components/startup").TunerReadyContext
  );
  return null;
});
jest.mock("../src/components/support", () => () => null);
jest.mock("../src/components/database", () => ({ initDatabase: jest.fn() }));
jest.mock("../src/components/preferences", () => ({
  loadPreferences: jest.fn().mockResolvedValue(undefined),
  flushPreferences: jest.fn(),
  usePreferences: (selector: (state: { saveError: boolean }) => unknown) =>
    selector({ saveError: false })
}));
jest.mock("../src/locales", () => ({ initLanguage: jest.fn(), t: String }));
jest.mock("react-native-splash-screen", () => ({ hide: jest.fn() }));
jest.mock("react-native-edge-to-edge", () => ({ SystemBars: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default
);

test("application manifest is standard JSON", () => {
  const fs = require("node:fs");
  expect(JSON.parse(fs.readFileSync("app.json", "utf8")).name).toBe("freetune");
});

test("shared Xcode scheme only references existing targets", () => {
  const fs = require("node:fs");
  const scheme = fs.readFileSync(
    "ios/freetune.xcodeproj/xcshareddata/xcschemes/freetune.xcscheme",
    "utf8"
  );
  const project = fs.readFileSync(
    "ios/freetune.xcodeproj/project.pbxproj",
    "utf8"
  );
  for (const match of scheme.matchAll(/BlueprintIdentifier = "([A-F0-9]+)"/g))
    expect(project).toContain(match[1]);
});

test("Ukrainian chord editor uses the correct spelling", () => {
  expect(require("../src/locales/ua.json").ChordsLyrics).toBe("Акорди / текст");
});

test("renders correctly", async () => {
  let screen: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    screen = ReactTestRenderer.create(<App />);
  });
  expect(screen!.root.findAllByType(Router)).toHaveLength(1);
  await ReactTestRenderer.act(() => screen!.unmount());
});

test("waits for database and language before mounting navigation and hiding splash", async () => {
  jest.useFakeTimers();
  const originalOS = Platform.OS;
  Platform.OS = "android";
  let finishDatabase!: () => void;
  let finishLanguage!: () => void;
  jest.mocked(initDatabase).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishDatabase = resolve;
    })
  );
  jest.mocked(initLanguage).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishLanguage = resolve;
    })
  );
  jest.clearAllMocks();
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(() => {
      screen = ReactTestRenderer.create(<App />);
    });
    expect(screen!.root.findAllByType(Router)).toHaveLength(0);
    expect(initLanguage).not.toHaveBeenCalled();
    expect(SplashScreen.hide).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => finishDatabase());
    expect(initLanguage).toHaveBeenCalledTimes(1);
    expect(screen!.root.findAllByType(Router)).toHaveLength(0);
    await ReactTestRenderer.act(async () => finishLanguage());
    expect(screen!.root.findAllByType(Router)).toHaveLength(1);
    expect(SplashScreen.hide).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      const callbacks = new Set(
        screen!.root
          .findAll((node) => typeof node.props.onLoadEnd === "function")
          .map((node) => node.props.onLoadEnd)
      );
      callbacks.forEach((callback) => callback());
      screen!.root.findByType(Router).props.onReady();
    });
    await ReactTestRenderer.act(async () => jest.advanceTimersByTime(32));
    expect(SplashScreen.hide).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => mockTunerReady?.());
    await ReactTestRenderer.act(async () => jest.advanceTimersByTime(32));
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  } finally {
    if (screen) await ReactTestRenderer.act(() => screen!.unmount());
    Platform.OS = originalOS;
    jest.useRealTimers();
  }
});

test("initialization failure shows a retry that can recover", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  jest
    .mocked(initDatabase)
    .mockRejectedValueOnce(new Error("storage failed"))
    .mockResolvedValue(undefined);
  let screen: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(<App />);
  });
  expect(screen!.root.findAllByType(Router)).toHaveLength(0);
  expect(
    screen!.root
      .findAllByType(Text)
      .some((node) => node.props.children === "ErrorStartingApp")
  ).toBe(true);
  await ReactTestRenderer.act(async () =>
    screen!.root.findByProps({ accessibilityRole: "button" }).props.onPress()
  );
  expect(screen!.root.findAllByType(Router)).toHaveLength(1);
  await ReactTestRenderer.act(async () => screen!.unmount());
  log.mockRestore();
});

test("backgrounding during a failed preference load never overwrites storage", async () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const subscription = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  let rejectLoad!: (error: Error) => void;
  jest.mocked(loadPreferences).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectLoad = reject;
    })
  );
  jest.mocked(flushPreferences).mockClear();
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(<App />);
    });
    await ReactTestRenderer.act(async () =>
      listeners.forEach((listener) => listener("background"))
    );
    expect(flushPreferences).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () =>
      rejectLoad(new Error("PreferenceReadFailed"))
    );
    await ReactTestRenderer.act(async () =>
      listeners.forEach((listener) => listener("background"))
    );
    expect(flushPreferences).not.toHaveBeenCalled();
    expect(screen!.root.findAllByType(Router)).toHaveLength(0);
    await ReactTestRenderer.act(async () =>
      screen!.root.findByProps({ accessibilityRole: "button" }).props.onPress()
    );
    await ReactTestRenderer.act(async () =>
      listeners.forEach((listener) => listener("background"))
    );
    expect(flushPreferences).toHaveBeenCalledTimes(1);
  } finally {
    if (screen) await ReactTestRenderer.act(async () => screen!.unmount());
    subscription.mockRestore();
    log.mockRestore();
  }
});

test("missing splash art and tuner callbacks cannot block an initialized application forever", async () => {
  jest.useFakeTimers();
  const originalOS = Platform.OS;
  Platform.OS = "android";
  jest.mocked(SplashScreen.hide).mockClear();
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(<App />);
    });
    expect(screen!.root.findAllByType(Router)).toHaveLength(1);
    await ReactTestRenderer.act(async () =>
      screen!.root.findByType(Router).props.onReady()
    );
    await ReactTestRenderer.act(async () => jest.advanceTimersByTimeAsync(9999));
    expect(SplashScreen.hide).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => jest.advanceTimersByTimeAsync(40));
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  } finally {
    if (screen) await ReactTestRenderer.act(async () => screen!.unmount());
    Platform.OS = originalOS;
    jest.useRealTimers();
  }
});
