// __tests__/App.test.tsx
import React from "react";
import ReactTestRenderer from "react-test-renderer";
import App from "../src/app";
import Router from "../src/router";
import { initDatabase } from "../src/components/database";
import { initLanguage } from "../src/locales";
import SplashScreen from "react-native-splash-screen";
import { Platform, Text } from "react-native";

jest.mock("../src/router", () => () => null);
jest.mock("../src/components/database", () => ({ initDatabase: jest.fn() }));
jest.mock("../src/locales", () => ({ initLanguage: jest.fn(), t: String }));
jest.mock("react-native-splash-screen", () => ({ hide: jest.fn() }));
jest.mock("react-native-edge-to-edge", () => ({ SystemBars: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default
);

test("renders correctly", async () => {
  let screen: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    screen = ReactTestRenderer.create(<App />);
  });
  expect(screen!.root.findAllByType(Router)).toHaveLength(1);
  await ReactTestRenderer.act(() => screen!.unmount());
});

test("waits for database and language before mounting navigation and hiding splash", async () => {
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
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  } finally {
    if (screen) await ReactTestRenderer.act(() => screen!.unmount());
    Platform.OS = originalOS;
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
