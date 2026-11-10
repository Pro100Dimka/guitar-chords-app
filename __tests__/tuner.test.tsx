import React from "react";
import Renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import Tuner from "../src/screens/tuner/tuner";
import RequireMicAccess from "../src/screens/tuner";
import Buttons from "../src/screens/tuner/buttons";
import MicrophoneStream from "../src/screens/tuner/MicrophoneStream";
import checkMicPermission from "../src/components/permissions";

jest.mock("../src/screens/tuner/MicrophoneStream", () => ({
  setTargetNotes: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn()
}));
jest.mock("../src/components/permissions", () => jest.fn());
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("@shopify/react-native-skia", () => ({ Canvas: "Canvas" }));
jest.mock("react-native-reanimated", () => ({
  useSharedValue: () => ({ value: 0 })
}));
jest.mock("react-native-worklets", () => ({ runOnJS: (fn: unknown) => fn }));
jest.mock("react-native-gesture-handler", () => ({
  GestureDetector: "GestureDetector",
  Gesture: { Tap: () => ({ onStart: jest.fn() }) }
}));
jest.mock("../src/screens/tuner/strings", () => ({
  __esModule: true,
  default: () => null
}));
jest.mock("../src/screens/tuner/note-indicator", () => () => null);
jest.mock("../src/screens/tuner/chormatic-wheel", () => () => null);
jest.mock("../src/screens/tuner/chormatic", () => () => null);
jest.mock("../src/screens/tuner/buttons", () => () => null);
jest.mock("../src/screens/tuner/config", () => ({
  autoDetect: true,
  selectedInstrument: "guitar",
  instruments: {
    guitar: { stringNotes: [{ name: "E", octave: 2 }] },
    chromatic: { stringNotes: [] }
  }
}));

let screen: Renderer.ReactTestRenderer;
beforeEach(() => {
  AppState.currentState = "active";
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test("manual mode releases guitar targets when switching to chromatic and restores them on return", async () => {
  await act(async () => {
    screen = Renderer.create(<Tuner />);
  });
  const setConfig = screen.root.findByType(Buttons).props.setConfig;
  const config = screen.root.findByType(Buttons).props.config;
  await act(async () => setConfig({ ...config, autoDetect: false }));
  await act(async () =>
    setConfig({ ...config, autoDetect: false, selectedInstrument: "chromatic" })
  );
  expect(MicrophoneStream.setTargetNotes).toHaveBeenLastCalledWith([]);
  await act(async () => setConfig({ ...config, autoDetect: false }));
  expect(MicrophoneStream.setTargetNotes).toHaveBeenLastCalledWith(
    config.instruments.guitar.stringNotes
  );
});

test("returning from settings refreshes microphone access without requesting it again", async () => {
  jest
    .mocked(checkMicPermission)
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true);
  const listener = jest.spyOn(AppState, "addEventListener");
  await act(async () => {
    screen = Renderer.create(<RequireMicAccess />);
  });
  expect(MicrophoneStream.startRecording).not.toHaveBeenCalled();
  const onChange = listener.mock.calls.find(
    ([event]) => event === "change"
  )?.[1];
  expect(onChange).toBeDefined();
  await act(async () => onChange?.("active"));
  expect(checkMicPermission).toHaveBeenLastCalledWith(false);
  expect(MicrophoneStream.startRecording).toHaveBeenCalled();
  jest.mocked(checkMicPermission).mockResolvedValue(false);
  await act(async () => onChange?.("active"));
  expect(screen.root.findAllByType(Tuner)).toHaveLength(0);
  expect(MicrophoneStream.stopRecording).toHaveBeenCalled();
});

test("silence does not repeatedly restart the recorder", async () => {
  await act(async () => {
    screen = Renderer.create(<Tuner />);
  });
  const listener = jest.mocked(MicrophoneStream.addListener).mock.calls[0][0];
  await act(async () => {
    for (let count = 0; count < 100; count++) {
      listener({
        note: "Silence",
        rms: 0,
        pitch: 0,
        refFreq: 0,
        octave: 0,
        direction: "=",
        diff: 0
      });
    }
  });
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
  expect(MicrophoneStream.stopRecording).not.toHaveBeenCalled();
});

test("backgrounding stops capture and returning checks permission before restarting", async () => {
  jest.mocked(checkMicPermission).mockResolvedValue(true);
  const listener = jest.spyOn(AppState, "addEventListener");
  await act(async () => {
    screen = Renderer.create(<RequireMicAccess />);
  });
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
  const onChange = listener.mock.calls.find(
    ([event]) => event === "change"
  )?.[1];
  await act(async () => onChange?.("background"));
  expect(screen.root.findAllByType(Tuner)).toHaveLength(0);
  expect(MicrophoneStream.stopRecording).toHaveBeenCalledTimes(1);
  await act(async () => onChange?.("active"));
  expect(checkMicPermission).toHaveBeenLastCalledWith(false);
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(2);
});
