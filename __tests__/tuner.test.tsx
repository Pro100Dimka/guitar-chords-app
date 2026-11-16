import React from "react";
import Renderer, { act } from "react-test-renderer";
import { AppState, TextInput, Dimensions, View } from "react-native";
import NoteIndicator from "../src/screens/tuner/note-indicator";
import { Action } from "../src/screens/song/tools";
import Tuner from "../src/screens/tuner/tuner";
import RequireMicAccess from "../src/screens/tuner";
import Buttons from "../src/screens/tuner/buttons";
import MicrophoneStream from "../src/screens/tuner/MicrophoneStream";
import checkMicPermission from "../src/components/permissions";
import * as guitarAudio from "../src/components/guitar-audio";
import {
  calibratedNote,
  signalLevels
} from "../src/screens/tuner/chromatic-signal";
import { usePreferences } from "../src/components/preferences";

test.each([true, false])(
  "signal visualization handles short, large and invalid samples: %s",
  (spectrum) => {
    for (const samples of [
      [0.5],
      [NaN, Infinity, -Infinity, 0.2],
      Array(200000).fill(0.1)
    ]) {
      const levels = signalLevels(samples, 44100, spectrum);
      expect(levels).toHaveLength(spectrum ? 32 : 128);
      expect(
        levels.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)
      ).toBe(true);
    }
  }
);
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));

jest.mock("../src/screens/tuner/MicrophoneStream", () => ({
  setKeepAwake: jest.fn(),
  setTargetNotes: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  startRecording: jest.fn(),
  restartRecording: jest.fn().mockResolvedValue(true),
  stopRecording: jest.fn()
}));
jest.mock("../src/components/permissions", () => jest.fn());
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key === "TunerReading"
        ? `${values?.note} ${values?.frequency} ${values?.status}`
        : key
  })
}));
jest.mock("@shopify/react-native-skia", () => ({
  Canvas: "Canvas",
  Group: "Group"
}));
jest.mock("react-native-reanimated", () => ({
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  withTiming: (value: unknown) => value
}));
jest.mock("react-native-worklets", () => ({ runOnJS: (fn: unknown) => fn }));
jest.mock("react-native-gesture-handler", () => ({
  GestureDetector: "GestureDetector",
  Gesture: { Tap: () => ({ onBegin: jest.fn() }) }
}));
jest.mock("../src/screens/tuner/strings", () => ({
  __esModule: true,
  NECK_EXTENSION_RATIO: 680 / 2216,
  BRIDGE_Y_RATIO: 0.92,
  default: () => null
}));
jest.mock("../src/screens/tuner/note-indicator", () => () => null);
jest.mock("../src/screens/tuner/chormatic-wheel", () => ({
  __esModule: true,
  default: () => null,
  chromaticLayout: () => ({
    hole: { x: 0, y: 0, width: 100, height: 100 },
    octaveLeft: 0,
    octaveTop: 0,
    octaveWidth: 100
  })
}));
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

test("guitar strings expose accessible selection and throttled pitch readings", async () => {
  jest.useFakeTimers();
  const previous = usePreferences.getState();
  const config = require("../src/screens/tuner/config");
  const originalStrings = config.instruments.guitar.stringNotes;
  config.instruments.guitar.stringNotes = [40, 45, 50, 55, 59, 64].map(() => ({
    name: "E",
    octave: 2
  }));
  usePreferences.setState({ instrument: "guitar", autoDetect: true });
  const play = jest
    .spyOn(guitarAudio, "playGuitar")
    .mockImplementation(() => {});
  try {
    await act(async () => {
      screen = Renderer.create(<Tuner active />);
    });
    const strings = screen.root.findAll(
      (node) => node.props.accessibilityRole === "radio",
      { deep: false }
    );
    expect(strings).toHaveLength(6);
    expect(strings[0].props.accessibilityLabel).toBe("TunerStringLabel");
    await act(async () => strings[1].props.onPress());
    expect(usePreferences.getState().stringIndex).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(
      screen.root.findAll((node) => node.props.accessibilityRole === "radio", {
        deep: false
      })[1].props.accessibilityState.selected
    ).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    const listener = jest
      .mocked(MicrophoneStream.addListener)
      .mock.calls.at(-1)![0];
    await act(async () =>
      listener({
        note: "A",
        octave: 2,
        pitch: 110,
        refFreq: 110,
        direction: "=",
        rms: 0.1,
        diff: 0
      })
    );
    const reading = () =>
      screen.root
        .findAllByType(View)
        .find((node) => node.props.accessibilityLabel === "TunerMeasurement")!
        .props.accessibilityValue;
    expect(reading()).toEqual({ text: "A2 110.0 TunerInTune" });
    await act(async () =>
      listener({
        note: "A",
        octave: 2,
        pitch: 112,
        refFreq: 110,
        direction: ">",
        rms: 0.1,
        diff: 2
      })
    );
    expect(reading()).toEqual({ text: "A2 110.0 TunerInTune" });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await act(async () =>
      listener({
        note: "A",
        octave: 2,
        pitch: 112,
        refFreq: 110,
        direction: ">",
        rms: 0.1,
        diff: 2
      })
    );
    expect(reading()).toEqual({ text: "A2 112.0 TunerHigh" });
  } finally {
    await act(async () => screen.unmount());
    usePreferences.setState(previous);
    config.instruments.guitar.stringNotes = originalStrings;
    play.mockRestore();
    jest.useRealTimers();
  }
});

test("calibration updates live readings and reference playback without restarting capture", async () => {
  jest.useFakeTimers();
  const previous = usePreferences.getState();
  usePreferences.setState({
    instrument: "chromatic",
    tunerReference: 432,
    chromaticOctave: null
  });
  const play = jest
    .spyOn(guitarAudio, "playGuitar")
    .mockImplementation(() => {});
  try {
    await act(async () => {
      screen = Renderer.create(<Tuner active />);
    });
    const listener = jest.mocked(MicrophoneStream.addListener).mock.calls[0][0];
    const input = {
      note: "A",
      octave: 4,
      pitch: 432,
      refFreq: 440,
      direction: "<" as const,
      rms: 0.1,
      diff: 0
    };
    await act(async () => listener(input));
    const wheel = screen.root.findByType(
      require("../src/screens/tuner/chormatic-wheel").default
    );
    expect(wheel.props.note.value.refFreq).toBe(432);
    await act(async () =>
      screen.root.findByType(Buttons).props.onCalibration()
    );
    await act(async () =>
      screen.root.findByType(TextInput).props.onChangeText("442")
    );
    await act(async () =>
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "ApplyCalibration")!
        .props.onPress()
    );
    await act(async () => listener({ ...input, pitch: 442 }));
    expect(wheel.props.note.value).toMatchObject({
      name: "A",
      refFreq: 442,
      direction: "="
    });
    expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
    expect(MicrophoneStream.stopRecording).not.toHaveBeenCalled();
    await act(async () => screen.root.findByType(Buttons).props.onReference());
    expect(play).toHaveBeenCalledWith([69], 442);
    expect(wheel.props.note.value).toBeNull();
    await act(async () => screen.update(<Tuner active={false} />));
    expect(screen.root.findByType(Buttons).props.referencePlaying).toBe(false);
  } finally {
    await act(async () =>
      usePreferences.setState({
        instrument: previous.instrument,
        tunerReference: previous.tunerReference,
        chromaticOctave: previous.chromaticOctave
      })
    );
  }
});

test.each([432, 440, 442])(
  "chromatic calibration uses A4 = %s Hz",
  (reference) => {
    expect(calibratedNote(reference, reference)).toMatchObject({
      name: "A",
      octave: 4,
      refFreq: reference,
      direction: "="
    });
    expect(calibratedNote(reference * 2, reference)).toMatchObject({
      name: "A",
      octave: 5
    });
    expect(
      calibratedNote(reference * 2 ** (-45 / 1200), reference)?.direction
    ).toBe("<");
    expect(
      calibratedNote(reference * 2 ** (45 / 1200), reference)?.direction
    ).toBe(">");
    expect(calibratedNote(0, reference)).toBeNull();
  }
);

test("spectrum follows microphone samples and visual mode does not restart capture", async () => {
  const samples = Array.from(
    { length: 256 },
    (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / 11025)
  );
  const spectrum = signalLevels(samples, 11025, true);
  const peak = spectrum.indexOf(Math.max(...spectrum));
  expect(55 * (4961.25 / 55) ** (peak / 31)).toBeGreaterThan(370);
  expect(55 * (4961.25 / 55) ** (peak / 31)).toBeLessThan(510);
  expect(signalLevels(samples, 11025, false)).toHaveLength(128);
  expect(
    signalLevels(Array(256).fill(0), 11025, true).every((value) => value === 0)
  ).toBe(true);
  const previous = usePreferences.getState().instrument;
  usePreferences.setState({ instrument: "chromatic" });
  try {
    await act(async () => {
      screen = Renderer.create(<Tuner active />);
    });
    const starts = jest.mocked(MicrophoneStream.startRecording).mock.calls
      .length;
    await act(async () =>
      screen.root.findByType(Buttons).props.onVisualization()
    );
    expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(starts);
    expect(MicrophoneStream.stopRecording).not.toHaveBeenCalled();
  } finally {
    await act(async () =>
      usePreferences.setState({ instrument: previous, tunerSpectrum: false })
    );
  }
});
beforeEach(() => {
  AppState.currentState = "active";
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.useRealTimers();
});

test.each([false, true])(
  "audio preparation does not delay the first complete tuner frame (active=%s)",
  async (active) => {
    jest.useFakeTimers();
    const prepare = jest.spyOn(guitarAudio, "prepareGuitar");
    await act(async () => {
      screen = Renderer.create(<Tuner active={active} />);
    });
    await act(async () => jest.advanceTimersByTime(500));
    expect(prepare).not.toHaveBeenCalled();
  }
);

test("a stalled microphone restarts after three seconds and stops recovery when unmounted", async () => {
  jest.useFakeTimers();
  await act(async () => {
    screen = Renderer.create(<Tuner active />);
  });
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(3000));
  expect(MicrophoneStream.restartRecording).toHaveBeenCalledTimes(1);
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount());
  const starts = jest.mocked(MicrophoneStream.startRecording).mock.calls.length;
  await act(async () => jest.advanceTimersByTime(6000));
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(starts);
});

test("microphone recovery is bounded when no buffers ever arrive", async () => {
  jest.useFakeTimers();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await act(async () => {
    screen = Renderer.create(<Tuner active />);
  });
  for (let i = 0; i < 30; i++)
    await act(async () => jest.advanceTimersByTime(1500));
  expect(MicrophoneStream.restartRecording).toHaveBeenCalledTimes(3);
});

test("pending native recovery cannot overlap or restart after unmount", async () => {
  jest.useFakeTimers();
  let finish!: (started: boolean) => void;
  jest.mocked(MicrophoneStream.restartRecording).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => {
    screen = Renderer.create(<Tuner active />);
  });
  await act(async () => jest.advanceTimersByTime(12000));
  expect(MicrophoneStream.restartRecording).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount());
  await act(async () => {
    finish(true);
  });
  await act(async () => jest.advanceTimersByTime(12000));
  expect(MicrophoneStream.restartRecording).toHaveBeenCalledTimes(1);
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
});

test("manual mode releases guitar targets when switching to chromatic and restores them on return", async () => {
  await act(async () => {
    screen = Renderer.create(<Tuner active />);
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
    screen = Renderer.create(<Tuner active />);
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

test("an inactive tuner keeps its view without capturing or restarting the microphone", async () => {
  jest.useFakeTimers();
  await act(async () => {
    screen = Renderer.create(<Tuner active />);
  });
  const controls = screen.root.findByType(Buttons);
  await act(async () => screen.update(<Tuner active={false} />));
  expect(screen.root.findByType(Buttons)).toBe(controls);
  expect(MicrophoneStream.stopRecording).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(6000));
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(1);
  await act(async () => screen.update(<Tuner active />));
  expect(screen.root.findByType(Buttons)).toBe(controls);
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(2);
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
  expect(screen.root.findByType(Tuner).props.active).toBe(false);
  expect(MicrophoneStream.stopRecording).toHaveBeenCalledTimes(1);
  await act(async () => onChange?.("active"));
  expect(checkMicPermission).toHaveBeenLastCalledWith(false);
  expect(MicrophoneStream.startRecording).toHaveBeenCalledTimes(2);
});

test("changing octave stops the reference and the next tap plays again", async () => {
  const previous = usePreferences.getState();
  usePreferences.setState({ instrument: "chromatic", chromaticOctave: 4 });
  const play = jest
    .spyOn(guitarAudio, "playGuitar")
    .mockImplementation(() => {});
  try {
    await act(async () => {
      screen = Renderer.create(<Tuner active />);
    });
    await act(async () => screen.root.findByType(Buttons).props.onReference());
    expect(screen.root.findByType(Buttons).props.referencePlaying).toBe(true);
    await act(async () =>
      usePreferences.getState().update({ chromaticOctave: 5 })
    );
    expect(screen.root.findByType(Buttons).props.referencePlaying).toBe(false);
    await act(async () => screen.root.findByType(Buttons).props.onReference());
    expect(play).toHaveBeenLastCalledWith([81], previous.tunerReference);
    expect(play).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => screen.unmount());
    usePreferences.setState(previous);
    play.mockRestore();
  }
});

test("selecting a new string clears the previous measurement during reference playback", async () => {
  jest.useFakeTimers();
  const previous = usePreferences.getState();
  const config = require("../src/screens/tuner/config");
  const strings = config.instruments.guitar.stringNotes;
  config.instruments.guitar.stringNotes = [
    { name: "E", octave: 2 },
    { name: "A", octave: 2 }
  ];
  usePreferences.setState({
    instrument: "guitar",
    autoDetect: true,
    stringIndex: 0,
    tuning: "standard"
  });
  let tap!: (point: { x: number; y: number }) => void;
  jest
    .spyOn(require("react-native-gesture-handler").Gesture, "Tap")
    .mockImplementation(() => ({
      onBegin: (callback: typeof tap) => {
        tap = callback;
        return {};
      }
    }));
  jest.spyOn(guitarAudio, "playGuitar").mockImplementation(() => {});
  try {
    await act(async () => {
      screen = Renderer.create(<Tuner active />);
    });
    const listener = jest
      .mocked(MicrophoneStream.addListener)
      .mock.calls.at(-1)![0];
    const measured = {
      note: "E",
      octave: 2,
      pitch: 82.4069,
      refFreq: 82.4069,
      direction: "=" as const,
      rms: 0.1,
      diff: 0
    };
    await act(async () => listener(measured));
    expect(screen.root.findByType(NoteIndicator).props.note.value.name).toBe(
      "E"
    );
    const { width, height } = Dimensions.get("window");
    const guitar = require("../src/screens/tuner/guitar-layout").guitarLayout(
      width,
      height
    );
    await act(async () =>
      tap({ x: guitar.stringLeft + guitar.stringWidth, y: 10 })
    );
    expect(screen.root.findByType(NoteIndicator).props.currString.name).toBe(
      "A"
    );
    expect(screen.root.findByType(NoteIndicator).props.note.value).toBeNull();
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
        listener(measured);
      });
      expect(screen.root.findByType(NoteIndicator).props.note.value).toBeNull();
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(101);
      listener({ ...measured, note: "A", pitch: 110, refFreq: 110 });
    });
    expect(
      screen.root.findByType(NoteIndicator).props.note.value
    ).toMatchObject({ name: "A", pitch: 110 });
  } finally {
    await act(async () => screen.unmount());
    config.instruments.guitar.stringNotes = strings;
    usePreferences.setState(previous);
  }
});
