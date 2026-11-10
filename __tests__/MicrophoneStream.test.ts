import { NativeEventEmitter } from "react-native";
import MicrophoneStream from "../src/screens/tuner/MicrophoneStream";

jest.mock("react-native", () => ({
  NativeModules: { MicrophoneStream: {} },
  NativeEventEmitter: jest.fn(() => ({ addListener: jest.fn() }))
}));

afterEach(() => {
  MicrophoneStream.removeAllListeners();
  jest.restoreAllMocks();
});

test("listeners added in the same millisecond can each be removed", () => {
  jest.spyOn(Date, "now").mockReturnValue(1000);
  const emitter = jest.mocked(NativeEventEmitter).mock.results[0].value;
  const first = { remove: jest.fn() };
  const second = { remove: jest.fn() };
  emitter.addListener.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const firstId = MicrophoneStream.addListener(jest.fn());
  const secondId = MicrophoneStream.addListener(jest.fn());
  MicrophoneStream.removeListener(firstId);
  expect(first.remove).toHaveBeenCalledTimes(1);
  expect(second.remove).not.toHaveBeenCalled();
  MicrophoneStream.removeListener(secondId);
  MicrophoneStream.removeListener(secondId);
  expect(second.remove).toHaveBeenCalledTimes(1);
});
