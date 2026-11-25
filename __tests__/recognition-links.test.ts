import {
  AppState,
  AppStateStatus,
  Linking,
  NativeModules,
  Platform
} from "react-native";
import { createRecognitionLinking } from "../src/components/song-autofill/links";

const first = "freetune://recognize/playback?autoStart=true&requestId=first";
const second = "freetune://recognize/playback?autoStart=true&requestId=second";
const previousNative = NativeModules.SongRecognition;
let urlEvent: (event: { url: string }) => void;
let stateEvent: (state: AppStateStatus) => void;
let unsubscribe: (() => void) | undefined;
const removeURL = jest.fn();
const removeState = jest.fn();
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "ios");
  NativeModules.SongRecognition = {
    consumeLaunchURL: jest.fn().mockResolvedValue(null)
  };
  jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
  jest
    .spyOn(Linking, "addEventListener")
    .mockImplementation((_event, listener) => {
      urlEvent = listener;
      return { remove: removeURL } as unknown as ReturnType<
        typeof Linking.addEventListener
      >;
    });
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      stateEvent = listener;
      return { remove: removeState };
    });
});
afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  NativeModules.SongRecognition = previousNative;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test("a Control Center cold launch reaches the recognition route before JS subscribed", async () => {
  NativeModules.SongRecognition.consumeLaunchURL.mockResolvedValueOnce(first);
  const linking = createRecognitionLinking();
  await expect(linking.getInitialURL()).resolves.toBe(first);
  expect(Linking.getInitialURL).not.toHaveBeenCalled();
  const listener = jest.fn();
  unsubscribe = linking.subscribe(listener);
  urlEvent({ url: first });
  await flush();
  expect(listener).not.toHaveBeenCalled();
});

test("ordinary initial deep links still open when no App Intent is pending", async () => {
  jest.mocked(Linking.getInitialURL).mockResolvedValue("freetune://library");
  await expect(createRecognitionLinking().getInitialURL()).resolves.toBe(
    "freetune://library"
  );
});

test("a warm Control Center URL and pending native copy are delivered only once", async () => {
  const listener = jest.fn();
  unsubscribe = createRecognitionLinking().subscribe(listener);
  await flush();
  NativeModules.SongRecognition.consumeLaunchURL.mockResolvedValueOnce(first);
  urlEvent({ url: first });
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(first);
});

test("resuming consumes new shortcuts while ignoring a repeated launch UUID", async () => {
  const listener = jest.fn();
  const linking = createRecognitionLinking();
  NativeModules.SongRecognition.consumeLaunchURL.mockResolvedValueOnce(first);
  await linking.getInitialURL();
  unsubscribe = linking.subscribe(listener);
  await flush();
  NativeModules.SongRecognition.consumeLaunchURL.mockResolvedValueOnce(first);
  stateEvent("active");
  await flush();
  expect(listener).not.toHaveBeenCalled();
  NativeModules.SongRecognition.consumeLaunchURL.mockResolvedValueOnce(second);
  stateEvent("active");
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(second);
});

test("unsubscribing removes listeners and discards a late native shortcut", async () => {
  let finish!: (url: string) => void;
  NativeModules.SongRecognition.consumeLaunchURL.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const listener = jest.fn();
  unsubscribe = createRecognitionLinking().subscribe(listener);
  unsubscribe();
  unsubscribe = undefined;
  finish(first);
  await flush();
  expect(removeURL).toHaveBeenCalledTimes(1);
  expect(removeState).toHaveBeenCalledTimes(1);
  expect(listener).not.toHaveBeenCalled();
});

test("Android uses normal links without calling the iOS App Intent bridge", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  jest.mocked(Linking.getInitialURL).mockResolvedValue(first);
  const linking = createRecognitionLinking();
  await expect(linking.getInitialURL()).resolves.toBe(first);
  const listener = jest.fn();
  unsubscribe = linking.subscribe(listener);
  urlEvent({ url: second });
  await flush();
  expect(NativeModules.SongRecognition.consumeLaunchURL).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledWith(second);
});
