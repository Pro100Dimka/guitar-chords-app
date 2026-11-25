import { NativeModules } from "react-native";
import { performanceAudio } from "../src/components/performance-audio";

jest.unmock("../src/components/performance-audio");
jest.mock("react-native", () => ({
  NativeModules: {
    PerformanceAudio: {
      playMetronomeBeat: jest.fn(),
      stopMetronomeBeats: jest.fn(),
      setMetronome: jest.fn(),
      stopPlayback: jest.fn()
    }
  },
  NativeEventEmitter: jest.fn(() => ({ addListener: jest.fn() }))
}));

const native = NativeModules.PerformanceAudio;

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test.each([
  [0, 0.7, 0, 0.7],
  [1, 0.5, 1, 0.5],
  [2, 1, 2, 1],
  [9, 2, 2, 1],
  [-1, -0.3, 0, 0],
  [0.6, 0.4, 1, 0.4]
])("clamps one-shot click inputs %s / %s", (accent, volume, kind, level) => {
  performanceAudio.metronomeBeat(accent, volume);
  expect(native.playMetronomeBeat).toHaveBeenCalledTimes(1);
  expect(native.playMetronomeBeat).toHaveBeenCalledWith(kind, level);
});

test.each([NaN, Infinity, -Infinity])(
  "does not send nonfinite click parameters to the native bridge (%s)",
  (invalid) => {
    performanceAudio.metronomeBeat(invalid, 0.7);
    performanceAudio.metronomeBeat(2, invalid);
    expect(native.playMetronomeBeat).not.toHaveBeenCalled();
  }
);

test("dispatches one click without creating an independent beat clock", () => {
  jest.useFakeTimers();
  performanceAudio.metronomeBeat(2, 0.7);
  jest.advanceTimersByTime(10000);
  expect(native.playMetronomeBeat).toHaveBeenCalledTimes(1);
  expect(native.setMetronome).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("stops only the one-shot click bus, retaining the free-play metronome API", () => {
  performanceAudio.metronome(100, true, 0.25);
  performanceAudio.stopMetronomeBeats();
  expect(native.setMetronome).toHaveBeenCalledTimes(1);
  expect(native.setMetronome).toHaveBeenCalledWith(100, true, 0.25);
  expect(native.stopMetronomeBeats).toHaveBeenCalledTimes(1);
  expect(native.stopPlayback).not.toHaveBeenCalled();
});

test("older native builds without one-shot clicks remain usable", () => {
  const play = native.playMetronomeBeat;
  const stop = native.stopMetronomeBeats;
  delete native.playMetronomeBeat;
  delete native.stopMetronomeBeats;
  try {
    expect(() => performanceAudio.metronomeBeat(2, 0.7)).not.toThrow();
    expect(() => performanceAudio.stopMetronomeBeats()).not.toThrow();
    performanceAudio.metronome(80, true);
    expect(native.setMetronome).toHaveBeenCalledWith(80, true, 0);
  } finally {
    native.playMetronomeBeat = play;
    native.stopMetronomeBeats = stop;
  }
});

test("bar-aware native metronome receives the meter and phase instead of looping one identical beat", () => {
  native.setMetronomePattern = jest.fn();
  try {
    performanceAudio.metronome(100, true, 2.25, 3);
    expect(native.setMetronomePattern).toHaveBeenCalledWith(100, true, 2.25, 3);
    expect(native.setMetronome).not.toHaveBeenCalled();
  } finally {
    delete native.setMetronomePattern;
  }
});
