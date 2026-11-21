import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, AppState, TextInput, View } from "react-native";
import PlayGuitar from "../src/screens/play";
import { TablaturePanel } from "../src/screens/play/tablature-panel";
import { TablatureLibrary } from "../src/screens/play/tablature-library";
import { TablaturePractice } from "../src/screens/play/tablature-practice";
import MicrophoneStream from "../src/screens/tuner/MicrophoneStream";
import { defaultTabPractice } from "../src/components/tablature-practice";
import {
  defaultSongPreferences,
  usePreferences
} from "../src/components/preferences";
import { Action, Sheet } from "../src/screens/song/tools";
import { guitarLayout } from "../src/screens/tuner/guitar-layout";
import { performanceAudio } from "../src/components/performance-audio";
import { warmGuitar } from "../src/components/guitar-audio";
import {
  emptyTablature,
  normalizeTablature,
  Tablature
} from "../src/components/tablature";
import {
  readTablatureDraft,
  writeTablatureDraft
} from "../src/components/tablature-draft";
import {
  getTablatureSong,
  listTablatureSongs,
  saveTablature
} from "../src/components/tablature-library";

let mockFocused = true;
let mockParams: { tablatureSongId?: number; tablatureRequest?: number } = {};
const mockNavigation = { setParams: jest.fn() };
let mockDown: (event: any, manager: any) => void;
let mockUp: (event: any, manager: any) => void;
jest.mock("@react-navigation/native", () => ({
  useIsFocused: () => mockFocused,
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => mockNavigation
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("@shopify/react-native-skia", () => ({
  Canvas: require("react-native").View
}));
jest.mock("../src/screens/tuner/strings", () => () => null);
jest.mock("react-native-reanimated", () => ({
  useSharedValue: (value: unknown) => require("react").useRef({ value }).current
}));
jest.mock("react-native-worklets", () => ({ runOnJS: (fn: unknown) => fn }));
jest.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: any) => children,
  Gesture: {
    Manual: () => {
      const gesture = {
        onTouchesDown: (fn: any) => {
          mockDown = fn;
          return gesture;
        },
        onTouchesUp: (fn: any) => {
          mockUp = fn;
          return gesture;
        },
        onTouchesMove: () => gesture,
        onTouchesCancelled: () => gesture,
        onFinalize: () => gesture
      };
      return gesture;
    }
  }
}));
jest.mock("../src/components/guitar-audio", () => ({
  prepareGuitar: jest.fn(),
  warmGuitar: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../src/components/performance-audio", () => ({
  performanceAudio: {
    guitarString: jest.fn(),
    stopGuitarString: jest.fn(),
    metronome: jest.fn(),
    metronomeBeat: jest.fn(),
    stopMetronomeBeats: jest.fn(),
    stopPlayback: jest.fn()
  }
}));
jest.mock("../src/components/database", () => ({
  db: {
    transaction: jest.fn((body, _error, success) => {
      body({ executeSql: jest.fn() });
      success?.();
    })
  }
}));
jest.mock("../src/screens/tuner/MicrophoneStream", () => ({
  __esModule: true,
  default: { setKeepAwake: jest.fn() }
}));
jest.mock("../src/screens/play/tablature-practice", () => ({
  TablaturePractice: (props: any) =>
    require("react").createElement(require("react-native").View, props)
}));
jest.mock("../src/components/tablature-library", () => ({
  getTablatureSong: jest.fn(),
  listTablatureSongs: jest.fn(),
  saveTablature: jest.fn(),
  TAB_LIBRARY_PAGE_SIZE: 30
}));
jest.mock("../src/components/tablature-draft", () => ({
  readTablatureDraft: jest.fn().mockResolvedValue(null),
  writeTablatureDraft: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../src/screens/song/tools", () => ({
  Diagram: () => null,
  Sheet: ({ children, ...props }: any) =>
    require("react").createElement(
      require("react-native").View,
      props,
      children
    ),
  Action: ({ label, ...props }: any) =>
    require("react").createElement(require("react-native").Pressable, {
      ...props,
      accessibilityLabel: label
    })
}));

let screen: Renderer.ReactTestRenderer | undefined;
const panel = () => screen!.root.findByType(TablaturePanel);
const transport = () =>
  panel().props.transport as React.ComponentProps<
    typeof TablaturePanel
  >["transport"];
const dimensions = { width: 390, height: 640 };
const manager = { begin: jest.fn(), activate: jest.fn(), end: jest.fn() };
const saved: Tablature = {
  ...emptyTablature(),
  notes: [{ string: 1, fret: 3, tick: 0, duration: 24 }]
};
async function render() {
  await act(async () => {
    screen = Renderer.create(<PlayGuitar />);
  });
  await act(async () => {
    screen!.root
      .findAllByType(View)
      .find((node) => typeof node.props.onLayout === "function")!
      .props.onLayout({ nativeEvent: { layout: dimensions } });
  });
}
async function pluck(string: number) {
  const frame = guitarLayout(dimensions.width, dimensions.height);
  const touch = {
    id: 1,
    x: frame.stringLeft + (frame.stringWidth / 5) * string,
    y: 100
  };
  await act(async () => {
    mockDown({ changedTouches: [touch] }, manager);
    mockUp({ changedTouches: [touch] }, manager);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  usePreferences.setState({ songs: {}, saveError: false });
  jest.mocked(readTablatureDraft).mockResolvedValue(null);
  jest.mocked(writeTablatureDraft).mockResolvedValue(undefined);
  mockFocused = true;
  mockParams = {};
  mockNavigation.setParams.mockImplementation((patch) => {
    Object.assign(mockParams, patch);
  });
  AppState.currentState = "active";
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.mocked(warmGuitar).mockResolvedValue(undefined);
  jest
    .mocked(getTablatureSong)
    .mockResolvedValue({ id: 7, title: "Saved riff", tablature: saved });
  jest
    .mocked(listTablatureSongs)
    .mockResolvedValue([{ id: 7, title: "Saved riff" }]);
  jest.mocked(saveTablature).mockResolvedValue(7);
});
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("screen-string touches record chosen frets and timing, save, and reopen the same tab", async () => {
  await render();
  await act(async () => panel().props.onRecord());
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "FreePlay")!
      .props.onPress()
  );
  const free = () =>
    screen!.root
      .findAllByType(Sheet)
      .find((node) => node.props.title === "FreePlay")!;
  await act(async () =>
    free()
      .findAllByType(Action)
      .filter((node) => node.props.label === "+")[0]
      .props.onPress()
  );
  await act(async () =>
    free()
      .findAllByType(Action)
      .filter((node) => node.props.label === "+")[0]
      .props.onPress()
  );
  await act(async () => free().props.onClose());
  await pluck(0);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(750);
  });
  await pluck(4);
  await act(async () => transport().stopRecording());
  const recorded = transport().tab;
  expect(recorded.notes).toEqual([
    { string: 0, fret: 2, tick: 0, duration: 24 },
    { string: 4, fret: 0, tick: 24, duration: 24 }
  ]);
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:42:string0",
    0
  );
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:59:string4",
    4
  );
  expect(panel().props.dirty).toBe(true);
  await act(async () => panel().props.onSave());
  const library = () => screen!.root.findByType(TablatureLibrary);
  await act(async () =>
    library().findByType(TextInput).props.onChangeText("My riff")
  );
  await act(async () =>
    library()
      .findAllByType(Action)
      .find((node) => node.props.label === "TabSave")!
      .props.onPress()
  );
  expect(saveTablature).toHaveBeenCalledWith({
    id: undefined,
    title: "My riff",
    tablature: recorded,
    practice: defaultTabPractice()
  });
  expect(panel().props.dirty).toBe(false);
  jest
    .mocked(getTablatureSong)
    .mockResolvedValue({ id: 7, title: "My riff", tablature: recorded });
  jest
    .mocked(listTablatureSongs)
    .mockResolvedValue([{ id: 7, title: "My riff" }]);
  await act(async () => panel().props.onOpen());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(150);
  });
  await act(async () =>
    library()
      .findAll(
        (node) =>
          node.props.accessibilityLabel === "My riff" &&
          typeof node.props.onPress === "function"
      )[0]
      .props.onPress()
  );
  expect(transport().tab).toEqual(recorded);
  expect(panel().props.title).toBe("My riff");
  expect(screen!.root.findAllByType(TablatureLibrary)).toHaveLength(0);
});

test.each(["Cancel", "TabDiscard"])(
  "edits made during a song navigation read require confirmation (%s)",
  async (decision) => {
    let finish!: (value: Awaited<ReturnType<typeof getTablatureSong>>) => void;
    jest.mocked(getTablatureSong).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mockParams = { tablatureSongId: 7, tablatureRequest: 1 };
    await render();
    const draft = normalizeTablature({
      ...emptyTablature(),
      notes: [{ string: 5, fret: 12, tick: 0 }]
    })!;
    await act(async () => {
      transport().setTab(draft);
    });
    await act(async () =>
      finish({ id: 7, title: "Saved riff", tablature: saved })
    );
    expect(transport().tab).toEqual(draft);
    expect(panel().props.dirty).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      "TabUnsavedTitle",
      "TabDiscardMessage",
      expect.any(Array)
    );
    await act(async () =>
      jest
        .mocked(Alert.alert)
        .mock.calls.at(-1)![2]!
        .find((button) => button.text === decision)!.onPress!()
    );
    expect(transport().tab).toEqual(decision === "Cancel" ? draft : saved);
    expect(panel().props.dirty).toBe(decision === "Cancel");
  }
);

test("leaving Play cancels pending audio preparation and keeps the tab", async () => {
  await render();
  await act(async () => {
    transport().setTab(saved);
  });
  let release!: () => void;
  jest.mocked(warmGuitar).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  let playing!: Promise<void>;
  await act(async () => {
    playing = transport().play();
  });
  expect(transport().status).toBe("preparing");
  mockFocused = false;
  await act(async () => screen!.update(<PlayGuitar />));
  await act(async () => {
    release();
    await playing;
  });
  expect(transport().status).toBe("idle");
  expect(transport().tab).toEqual(saved);
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
});

test("manual strings pause tab playback and retain their chosen chord frets", async () => {
  await render();
  await act(async () => {
    transport().setTab({
      ...emptyTablature(),
      notes: [{ string: 2, fret: 5, tick: 0 }]
    });
  });
  await act(async () => {
    await transport().play();
  });
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:55:string2",
    2
  );
  await pluck(2);
  expect(transport().status).toBe("idle");
  expect(performanceAudio.guitarString).toHaveBeenLastCalledWith(
    "440:52:string2",
    2
  );
  expect(transport().tab.notes).toEqual([
    { string: 2, fret: 5, tick: 0, duration: 24 }
  ]);
});

test("practice opens from Play, keeps the display awake and pauses when closed", async () => {
  await render();
  await act(async () => {
    transport().setTab(saved);
    panel().props.onPractice();
  });
  const practice = () => screen!.root.findByType(TablaturePractice);
  expect(practice().props.active).toBe(true);
  expect(MicrophoneStream.setKeepAwake).toHaveBeenLastCalledWith(
    true,
    "tablature-practice"
  );
  await act(async () => transport().play());
  expect(transport().status).toBe("playing");
  await act(async () => practice().props.onClose());
  expect(screen!.root.findAllByType(TablaturePractice)).toHaveLength(0);
  expect(transport().status).toBe("idle");
  expect(MicrophoneStream.setKeepAwake).toHaveBeenLastCalledWith(
    false,
    "tablature-practice"
  );
});

test("backgrounding cancels the shared count-in, releases the display and does not restart", async () => {
  const listeners: Array<(state: "active" | "background") => void> = [];
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
  await render();
  await act(async () => {
    transport().setTab(saved);
    transport().setPractice({ ...defaultTabPractice(), countInBars: 1 });
    panel().props.onPractice();
  });
  await act(async () => transport().play());
  expect(transport().status).toBe("countingIn");
  expect(performanceAudio.metronomeBeat).toHaveBeenCalled();
  await act(async () =>
    listeners.forEach((listener) => listener("background"))
  );
  expect(transport().status).toBe("idle");
  expect(screen!.root.findByType(TablaturePractice).props.active).toBe(false);
  expect(MicrophoneStream.setKeepAwake).toHaveBeenLastCalledWith(
    false,
    "tablature-practice"
  );
  jest.mocked(performanceAudio.metronomeBeat).mockClear();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10000);
    listeners.forEach((listener) => listener("active"));
  });
  expect(transport().status).toBe("idle");
  expect(performanceAudio.metronomeBeat).not.toHaveBeenCalled();
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
});

test("recording count-in permits fingering changes but preserves the old tab when cancelled", async () => {
  await render();
  await act(async () => {
    transport().replaceTab(saved);
    transport().setPractice({ ...defaultTabPractice(), countInBars: 1 });
  });
  await act(async () => panel().props.onRecord());
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === "TabRecord")!.onPress!()
  );
  expect(transport().status).toBe("countingIn");
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "FreePlay")!
      .props.onPress()
  );
  await pluck(0);
  expect(transport().status).toBe("countingIn");
  expect(transport().tab).toEqual(saved);
  expect(
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Metronome")!.props.disabled
  ).toBe(true);
  await act(async () => transport().stopRecording());
  expect(transport().status).toBe("idle");
  expect(transport().tab).toEqual(saved);
  expect(transport().canUndo).toBe(false);
});

test("practice settings save per song and changing songs never overwrites the previous settings", async () => {
  const first = {
    ...defaultTabPractice(),
    metronome: true,
    countInBars: 1 as const,
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 90,
      stepBpm: 5,
      repeats: 2
    }
  };
  const second = {
    ...defaultTabPractice(),
    volume: 0.3,
    countInBars: 2 as const
  };
  usePreferences.setState({
    songs: {
      7: { ...defaultSongPreferences, tablature: saved, tabPractice: first },
      8: { ...defaultSongPreferences, tablature: saved, tabPractice: second }
    }
  });
  jest.mocked(getTablatureSong).mockResolvedValue({
    id: 7,
    title: "First riff",
    tablature: saved,
    practice: first
  });
  mockParams = { tablatureSongId: 7, tablatureRequest: 1 };
  await render();
  expect(transport().practice).toEqual(first);
  expect(transport().loop).toBe(true);
  const changed = { ...first, volume: 0.5 };
  await act(async () => transport().setPractice(changed));
  expect(usePreferences.getState().songs[7].tabPractice).toEqual(changed);
  expect(panel().props.dirty).toBe(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(writeTablatureDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({
      practice: changed,
      song: { id: 7, title: "First riff" }
    })
  );
  await act(async () => panel().props.onOpen());
  await act(async () =>
    screen!.root
      .findByType(TablatureLibrary)
      .props.onLoad({ id: 8, title: "Second riff" }, saved, second)
  );
  expect(transport().practice).toEqual(second);
  expect(transport().loop).toBe(false);
  expect(usePreferences.getState().songs[7].tabPractice).toEqual(changed);
  expect(usePreferences.getState().songs[8].tabPractice).toEqual(second);
  usePreferences.getState().removeSong(8);
  await act(async () => transport().setPractice({ ...second, volume: 0.2 }));
  expect(usePreferences.getState().songs[8]).toBeUndefined();
});

test("restoring a draft restores practice without creating a score edit", async () => {
  const practice = {
    ...defaultTabPractice(),
    countInBars: 2 as const,
    metronome: true
  };
  jest.mocked(readTablatureDraft).mockResolvedValue({
    version: 1,
    tab: saved,
    savedTab: saved,
    song: null,
    practice
  });
  await render();
  expect(transport().practice).toEqual(practice);
  expect(transport().canUndo).toBe(false);
  expect(panel().props.dirty).toBe(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(writeTablatureDraft).not.toHaveBeenCalled();
});

test("draft hydration locks tab actions and restores unsaved rhythm with its library link", async () => {
  let finish!: (value: Awaited<ReturnType<typeof readTablatureDraft>>) => void;
  jest.mocked(readTablatureDraft).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  expect(panel().props.disabled).toBe(true);
  await act(async () => panel().props.onRecord());
  expect(transport().status).toBe("idle");
  const tab = {
    ...emptyTablature(112, 6, 8),
    barCount: 2,
    notes: [{ string: 0, fret: 3, tick: 0, duration: 18 }],
    rests: [{ tick: 18, duration: 6 }]
  };
  await act(async () =>
    finish({
      version: 1,
      tab,
      savedTab: saved,
      song: { id: 7, title: "Recovered riff" },
      practice: defaultTabPractice()
    })
  );
  expect(panel().props.disabled).toBe(false);
  expect(panel().props.title).toBe("Recovered riff");
  expect(panel().props.dirty).toBe(true);
  expect(transport().tab).toEqual(tab);
  expect(transport().canUndo).toBe(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(writeTablatureDraft).not.toHaveBeenCalled();
});

test("an incoming library tab waits for the restored unsaved draft to be confirmed", async () => {
  const draft = {
    ...saved,
    tempo: 120
  };
  jest.mocked(readTablatureDraft).mockResolvedValue({
    version: 1,
    tab: draft,
    savedTab: saved,
    song: { id: 7, title: "Local edit" }
  });
  mockParams = { tablatureSongId: 7, tablatureRequest: 1 };
  await render();
  expect(getTablatureSong).not.toHaveBeenCalled();
  expect(transport().tab).toEqual(draft);
  expect(Alert.alert).toHaveBeenCalledWith(
    "TabUnsavedTitle",
    "TabDiscardMessage",
    expect.any(Array)
  );
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === "Cancel")!.onPress!()
  );
  expect(transport().tab).toEqual(draft);
  expect(mockParams.tablatureSongId).toBeUndefined();
});

test("replacing a recording keeps its chosen meter and can be undone in one action", async () => {
  await render();
  const previous = {
    ...emptyTablature(120, 6, 8),
    notes: [{ string: 1, fret: 8, tick: 0, duration: 24 }],
    rests: [{ tick: 24, duration: 12 }]
  };
  await act(async () => {
    transport().replaceTab(previous);
  });
  await act(async () => panel().props.onRecord());
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === "TabRecord")!.onPress!()
  );
  await pluck(2);
  await act(async () => transport().stopRecording());
  expect(transport().tab).toMatchObject({
    tempo: 120,
    beatsPerBar: 6,
    beatUnit: 8,
    notes: [{ string: 2, fret: 2, tick: 0, duration: 24 }],
    rests: []
  });
  expect(transport().canUndo).toBe(true);
  await act(async () => transport().undo());
  expect(transport().tab).toEqual(previous);
  expect(transport().canUndo).toBe(false);
  expect(transport().canRedo).toBe(true);
});
