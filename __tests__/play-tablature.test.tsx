import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  Alert,
  AppState,
  Image,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import PlayGuitar from "../src/screens/play";
import { GuitarZoom } from "../src/screens/play/guitar-zoom";
import Strings from "../src/screens/tuner/strings";
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

let mockTransport: React.ComponentProps<typeof TablaturePanel>["transport"];
jest.mock("../src/screens/play/use-tablature", () => {
  const actual = jest.requireActual("../src/screens/play/use-tablature");
  return {
    ...actual,
    useTablature: (...args: Parameters<typeof actual.useTablature>) => {
      mockTransport = actual.useTablature(...args);
      return mockTransport;
    }
  };
});
let mockFocused = true;
let mockParams: { tablatureSongId?: number; tablatureRequest?: number } = {};
const mockNavigation = { setParams: jest.fn() };
let mockDown: (event: any, manager: any) => void;
let mockUp: (event: any, manager: any) => void;
let mockQueuedTouches: Array<() => void> | null = null;
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
jest.mock("react-native-worklets", () => ({
  runOnJS:
    (fn: (...args: any[]) => void) =>
    (...args: any[]) => {
      if (mockQueuedTouches) mockQueuedTouches.push(() => fn(...args));
      else fn(...args);
    }
}));
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
    stopPlayback: jest.fn(),
    listen: jest.fn(() => ({ remove: jest.fn() }))
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
  TempoControl: (props: any) =>
    require("react").createElement(require("react-native").View, props),
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
const panel = async () => {
  if (!screen!.root.findAllByType(TablaturePanel).length) {
    await act(async () => {
      screen!.root
        .findAll(
          (node) =>
            node.props.accessibilityLabel === "TabTitle" &&
            typeof node.props.onPress === "function"
        )[0]
        .props.onPress();
    });
  }
  return screen!.root.findByType(TablaturePanel);
};
const transport = () => mockTransport;
async function panelAction(
  name: "onRecord" | "onSave" | "onOpen" | "onPractice"
) {
  const current = await panel();
  await act(async () => current.props[name]());
}
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
      .find((node) => node.props.testID === "play-guitar-stage")!
      .props.onLayout({ nativeEvent: { layout: dimensions } });
  });
}
async function pluck(string: number) {
  const frame = guitarLayout(
    dimensions.width,
    dimensions.height,
    screen!.root.findByType(Strings).props.zoom
  );
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
  usePreferences.setState({ songs: {}, saveError: false, playGuitarZoom: 1 });
  jest.mocked(readTablatureDraft).mockResolvedValue(null);
  jest.mocked(writeTablatureDraft).mockResolvedValue(undefined);
  mockFocused = true;
  mockQueuedTouches = null;
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

test("zoom changes artwork, strings and touch coordinates together and persists only a settled edit", async () => {
  await render();
  const zoom = () => screen!.root.findByType(GuitarZoom);
  await act(async () => zoom().props.onInteractionChange(true));
  await act(async () => zoom().props.onChange(1.4));
  const frame = guitarLayout(dimensions.width, dimensions.height, 1.4);
  expect(screen!.root.findByType(Strings).props.zoom).toBe(1.4);
  expect(
    StyleSheet.flatten(screen!.root.findByType(Image).props.style)
  ).toMatchObject(frame.artwork);
  expect(usePreferences.getState().playGuitarZoom).toBe(1);
  jest.mocked(performanceAudio.guitarString).mockClear();
  await pluck(5);
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await act(async () => {
    zoom().props.onCommit(1.4);
    zoom().props.onInteractionChange(false);
  });
  expect(usePreferences.getState().playGuitarZoom).toBe(1.4);
  for (let string = 1; string < 6; string++) await pluck(string);
  expect(
    jest.mocked(performanceAudio.guitarString).mock.calls.map((call) => call[1])
  ).toEqual([1, 2, 3, 4, 5]);
  await act(async () => screen!.unmount());
  screen = undefined;
  await render();
  expect(zoom().props.value).toBe(1.4);
  expect(screen!.root.findByType(Strings).props.zoom).toBe(1.4);
});

test("a queued touch from the previous zoom cannot sound after resizing the guitar", async () => {
  await render();
  const queued: Array<() => void> = [];
  mockQueuedTouches = queued;
  await pluck(2);
  expect(queued).toHaveLength(1);
  await act(async () =>
    screen!.root.findByType(GuitarZoom).props.onChange(1.25)
  );
  mockQueuedTouches = null;
  jest.mocked(performanceAudio.guitarString).mockClear();
  await act(async () => queued.forEach((touch) => touch()));
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await pluck(2);
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:52:string2",
    2
  );
});

test("fret overlays follow the zoomed string columns", async () => {
  usePreferences.setState({ playGuitarZoom: 1.35 });
  await render();
  await act(async () => {
    await transport().setTab(saved);
  });
  await act(async () => {
    await transport().play();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30);
  });
  const frame = guitarLayout(dimensions.width, dimensions.height, 1.35);
  const overlay = screen!.root.findAllByType(View).find((node) => {
    const style = StyleSheet.flatten(node.props.style);
    return (
      style?.position === "absolute" && style?.top === 72 && style?.width === 32
    );
  });
  expect(overlay).toBeDefined();
  expect(StyleSheet.flatten(overlay!.props.style).left).toBeCloseTo(
    frame.stringLeft + frame.stringWidth / 5 - 16
  );
});

test("screen-string touches record chosen frets and timing, save, and reopen the same tab", async () => {
  await render();
  await panelAction("onRecord");
  await act(async () =>
    screen!.root
      .findAll(
        (node) =>
          node.props.accessibilityLabel === "FreePlay" &&
          typeof node.props.onPress === "function"
      )[0]
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
  expect((await panel()).props.dirty).toBe(true);
  await panelAction("onSave");
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
  expect((await panel()).props.dirty).toBe(false);
  jest
    .mocked(getTablatureSong)
    .mockResolvedValue({ id: 7, title: "My riff", tablature: recorded });
  jest
    .mocked(listTablatureSongs)
    .mockResolvedValue([{ id: 7, title: "My riff" }]);
  await panelAction("onOpen");
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
  expect((await panel()).props.title).toBe("My riff");
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
    expect((await panel()).props.dirty).toBe(true);
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
    expect((await panel()).props.dirty).toBe(decision === "Cancel");
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

test.each(["blur", "return", "unmount", "record", "practice", "interruption"])(
  "a queued string touch cannot sound after a newer %s transition",
  async (transition) => {
    await render();
    const queued: Array<() => void> = [];
    mockQueuedTouches = queued;
    await pluck(2);
    expect(queued).toHaveLength(1);
    if (transition === "blur" || transition === "return") {
      mockFocused = false;
      await act(async () => screen!.update(<PlayGuitar />));
      if (transition === "return") {
        mockFocused = true;
        await act(async () => screen!.update(<PlayGuitar />));
      }
    } else if (transition === "unmount") {
      await act(async () => screen!.unmount());
      screen = undefined;
    } else if (transition === "interruption") {
      const listener = jest
        .mocked(performanceAudio.listen)
        .mock.calls.at(-1)![0];
      await act(async () => listener({ state: "playbackInterrupted" }));
    } else if (transition === "record") {
      await panelAction("onRecord");
      expect(transport().status).toBe("recording");
    } else {
      await panelAction("onPractice");
      expect(screen!.root.findAllByType(TablaturePractice)).toHaveLength(1);
    }
    jest.mocked(performanceAudio.guitarString).mockClear();
    mockQueuedTouches = null;
    await act(async () => queued.forEach((touch) => touch()));
    expect(performanceAudio.guitarString).not.toHaveBeenCalled();
    if (transition === "record") expect(transport().tab.notes).toEqual([]);
    if (transition === "interruption") {
      await pluck(2);
      expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
    }
  }
);

test("a queued string touch survives ordinary recording clock renders", async () => {
  await render();
  await panelAction("onRecord");
  await pluck(1);
  const queued: Array<() => void> = [];
  mockQueuedTouches = queued;
  await pluck(2);
  await act(async () => jest.advanceTimersByTimeAsync(50));
  jest.mocked(performanceAudio.guitarString).mockClear();
  mockQueuedTouches = null;
  await act(async () => queued.forEach((touch) => touch()));
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:52:string2",
    2
  );
  expect(transport().tab.notes).toHaveLength(2);
});

test.each([false, true])(
  "queued strumming completes its own pause without interrupting a later Play (%s)",
  async (restart) => {
    await render();
    await act(async () => {
      transport().setTab(saved);
    });
    await act(async () => transport().play());
    const queued: Array<() => void> = [];
    mockQueuedTouches = queued;
    await pluck(1);
    await pluck(2);
    mockQueuedTouches = null;
    await act(async () => queued[0]());
    expect(transport().status).toBe("idle");
    if (restart) await act(async () => transport().play());
    jest.mocked(performanceAudio.guitarString).mockClear();
    await act(async () => queued[1]());
    if (restart) {
      expect(transport().status).toBe("playing");
      expect(performanceAudio.guitarString).not.toHaveBeenCalled();
    } else {
      expect(performanceAudio.guitarString).toHaveBeenCalledWith(
        "440:52:string2",
        2
      );
    }
  }
);

test("practice opens from Play, keeps the display awake and pauses when closed", async () => {
  await render();
  await act(async () => {
    transport().setTab(saved);
  });
  await panelAction("onPractice");
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

test("creating a new part supersedes a pending incoming song even when both drafts are empty", async () => {
  let finish!: (value: Awaited<ReturnType<typeof getTablatureSong>>) => void;
  jest.mocked(getTablatureSong).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mockParams = { tablatureSongId: 7, tablatureRequest: 1 };
  await render();
  expect(getTablatureSong).toHaveBeenCalledTimes(1);
  await panelAction("onOpen");
  await act(async () =>
    screen!.root.findByType(TablatureLibrary).props.onNew()
  );
  await act(async () =>
    finish({ id: 7, title: "Late riff", tablature: saved })
  );
  expect(transport().tab).toEqual(emptyTablature());
  expect((await panel()).props.title).toBeUndefined();
  expect(mockParams.tablatureSongId).toBeUndefined();
});

test("an obsolete incoming read failure cannot replace the new session with an error", async () => {
  let fail!: (error: Error) => void;
  jest.mocked(getTablatureSong).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  mockParams = { tablatureSongId: 7, tablatureRequest: 1 };
  await render();
  await panelAction("onOpen");
  await act(async () =>
    screen!.root.findByType(TablatureLibrary).props.onNew()
  );
  await act(async () => fail(new Error("SongMissing")));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(transport().tab).toEqual(emptyTablature());
  expect(mockParams.tablatureSongId).toBeUndefined();
});

test.each(["onOpen", "onSave"] as const)(
  "%s protects the active library dialog and typed text from an older incoming song",
  async (action) => {
    let finish!: (value: Awaited<ReturnType<typeof getTablatureSong>>) => void;
    jest.mocked(getTablatureSong).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    jest.mocked(readTablatureDraft).mockResolvedValue({
      version: 1,
      tab: saved,
      savedTab: saved,
      song: null,
      practice: defaultTabPractice()
    });
    mockParams = { tablatureSongId: 7, tablatureRequest: 1 };
    await render();
    await panelAction(action);
    await act(async () =>
      screen!.root
        .findByType(TablatureLibrary)
        .findByType(TextInput)
        .props.onChangeText("My current work")
    );
    await act(async () =>
      finish({ id: 7, title: "Late riff", tablature: saved })
    );
    expect(screen!.root.findAllByType(TablatureLibrary)).toHaveLength(1);
    expect(
      screen!.root.findByType(TablatureLibrary).findByType(TextInput).props
        .value
    ).toBe("My current work");
    expect((await panel()).props.title).toBeUndefined();
  }
);

test.each(["playing", "countingIn", "recording"])(
  "native audio interruption stops %s without an AppState transition or automatic restart",
  async (mode) => {
    await render();
    await act(async () => {
      transport().replaceTab(saved);
      if (mode === "countingIn")
        transport().setPractice({ ...defaultTabPractice(), countInBars: 1 });
    });
    await act(async () => {
      if (mode === "recording") transport().startRecording();
      else await transport().play();
    });
    if (mode === "recording") await pluck(0);
    expect(transport().status).toBe(mode);
    const current = transport().tab;
    const listener = jest.mocked(performanceAudio.listen).mock.calls.at(-1)![0];
    await act(async () => listener({ state: "processing" }));
    expect(transport().status).toBe(mode);
    await act(async () => listener({ state: "playbackInterrupted" }));
    expect(transport().status).toBe("idle");
    expect(transport().tab).toEqual(current);
    jest.mocked(performanceAudio.guitarString).mockClear();
    jest.mocked(performanceAudio.metronomeBeat).mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(transport().status).toBe("idle");
    expect(performanceAudio.guitarString).not.toHaveBeenCalled();
    expect(performanceAudio.metronomeBeat).not.toHaveBeenCalled();
  }
);

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
  });
  await panelAction("onPractice");
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
  await panelAction("onRecord");
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === "TabRecord")!.onPress!()
  );
  expect(transport().status).toBe("countingIn");
  await act(async () =>
    screen!.root
      .findAll(
        (node) =>
          node.props.accessibilityLabel === "FreePlay" &&
          typeof node.props.onPress === "function"
      )[0]
      .props.onPress()
  );
  await pluck(0);
  expect(transport().status).toBe("countingIn");
  expect(transport().tab).toEqual(saved);
  expect(
    screen!.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Metronome" &&
        typeof node.props.onPress === "function"
    )[0].props.disabled
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
  expect((await panel()).props.dirty).toBe(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(writeTablatureDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({
      practice: changed,
      song: { id: 7, title: "First riff" }
    })
  );
  await panelAction("onOpen");
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
  expect((await panel()).props.dirty).toBe(false);
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
  const opener = screen!.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "TabTitle" &&
      typeof node.props.onPress === "function"
  )[0];
  expect(opener.props.disabled).toBe(true);
  expect(screen!.root.findAllByType(TablaturePanel)).toHaveLength(0);
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
  expect((await panel()).props.disabled).toBe(false);
  expect((await panel()).props.title).toBe("Recovered riff");
  expect((await panel()).props.dirty).toBe(true);
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
  await panelAction("onRecord");
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

test.each(["new", "record"])(
  "a stale %s confirmation cannot replace a subsequently loaded song",
  async (action) => {
    await render();
    await act(async () => {
      transport().setTab(saved);
    });
    if (action === "new") {
      await panelAction("onOpen");
      await act(async () =>
        screen!.root.findByType(TablatureLibrary).props.onNew()
      );
    } else await panelAction("onRecord");
    const stale = jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find(
        (button) =>
          button.text === (action === "new" ? "TabDiscard" : "TabRecord")
      )!.onPress!;
    const replacement = {
      ...saved,
      notes: [{ string: 5, fret: 9, tick: 0, duration: 24 }]
    };
    await panelAction("onOpen");
    await act(async () =>
      screen!.root
        .findByType(TablatureLibrary)
        .props.onLoad({ id: 8, title: "Newer song" }, replacement)
    );
    await act(async () =>
      jest
        .mocked(Alert.alert)
        .mock.calls.at(-1)![2]!
        .find((button) => button.text === "TabDiscard")!.onPress!()
    );
    expect((await panel()).props.title).toBe("Newer song");
    await act(async () => stale());
    expect(transport().tab).toEqual(replacement);
    expect((await panel()).props.title).toBe("Newer song");
    expect(transport().status).toBe("idle");
  }
);

test("a navigation confirmation shown before New cannot revive its superseded request", async () => {
  await render();
  await act(async () => {
    transport().setTab(saved);
  });
  mockParams = { tablatureSongId: 7, tablatureRequest: 10 };
  await act(async () => screen!.update(<PlayGuitar />));
  const incoming = jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)![2]!
    .find((button) => button.text === "TabDiscard")!.onPress!;
  expect(getTablatureSong).not.toHaveBeenCalled();
  await panelAction("onOpen");
  await act(async () =>
    screen!.root.findByType(TablatureLibrary).props.onNew()
  );
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === "TabDiscard")!.onPress!()
  );
  expect(transport().tab).toEqual(emptyTablature());
  await act(async () => incoming());
  expect(transport().tab).toEqual(emptyTablature());
  expect((await panel()).props.title).toBeUndefined();
  expect(getTablatureSong).not.toHaveBeenCalled();
});

test("a recording confirmation from before leaving Play cannot restart when returning", async () => {
  await render();
  await act(async () => {
    transport().setTab(saved);
  });
  await panelAction("onRecord");
  const start = jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)![2]!
    .find((button) => button.text === "TabRecord")!.onPress!;
  mockFocused = false;
  await act(async () => screen!.update(<PlayGuitar />));
  mockFocused = true;
  await act(async () => screen!.update(<PlayGuitar />));
  await act(async () => start());
  expect(transport().status).toBe("idle");
  expect(transport().tab).toEqual(saved);
});

test("restoring a clean draft does not overwrite newer library practice until the user changes it", async () => {
  const restored = {
    ...defaultTabPractice(),
    volume: 0.3,
    countInBars: 1 as const
  };
  const libraryPractice = {
    ...defaultTabPractice(),
    volume: 0.8,
    countInBars: 2 as const
  };
  usePreferences.setState({
    songs: {
      7: {
        ...defaultSongPreferences,
        tablature: saved,
        tabPractice: libraryPractice
      }
    }
  });
  jest.mocked(readTablatureDraft).mockResolvedValue({
    version: 1,
    tab: saved,
    savedTab: saved,
    song: { id: 7, title: "Recovered song" },
    practice: restored
  });
  await render();
  expect(transport().practice).toEqual(restored);
  expect((await panel()).props.dirty).toBe(false);
  expect(usePreferences.getState().songs[7].tabPractice).toEqual(
    libraryPractice
  );
  const edited = { ...restored, volume: 0.4 };
  await act(async () => transport().setPractice(edited));
  expect(usePreferences.getState().songs[7].tabPractice).toEqual(edited);
});

test("a draft reset confirmation cannot erase a working copy restored by a later retry", async () => {
  jest
    .mocked(readTablatureDraft)
    .mockRejectedValueOnce(new Error("read failure"));
  await render();
  const button = (label: string) =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === label)!;
  await act(async () => button("TabDraftStartNew").props.onPress());
  const reset = jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)![2]!
    .find((entry) => entry.text === "TabDraftStartNew")!.onPress!;
  jest.mocked(readTablatureDraft).mockResolvedValueOnce({
    version: 1,
    tab: saved,
    savedTab: emptyTablature(),
    song: { id: 7, title: "Recovered after retry" },
    practice: defaultTabPractice()
  });
  await act(async () => button("TabDraftRetry").props.onPress());
  expect(transport().tab).toEqual(saved);
  jest.mocked(writeTablatureDraft).mockClear();
  await act(async () => reset());
  expect(writeTablatureDraft).not.toHaveBeenCalledWith(null);
  expect(transport().tab).toEqual(saved);
  expect((await panel()).props.title).toBe("Recovered after retry");
  expect((await panel()).props.dirty).toBe(true);
});

test("saving a snapshot while newer edits arrive preserves them and completes even after backgrounding", async () => {
  let finish!: (id: number) => void;
  jest.mocked(saveTablature).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => {
    transport().setTab(saved);
  });
  await panelAction("onSave");
  const library = () => screen!.root.findByType(TablatureLibrary);
  await act(async () =>
    library().findByType(TextInput).props.onChangeText("Saved snapshot")
  );
  await act(async () =>
    library()
      .findAllByType(Action)
      .find((node) => node.props.label === "TabSave")!
      .props.onPress()
  );
  const newer = {
    ...saved,
    notes: [{ string: 5, fret: 12, tick: 0, duration: 12 }]
  };
  await act(async () => {
    transport().setTab(newer);
  });
  mockFocused = false;
  await act(async () => screen!.update(<PlayGuitar />));
  await act(async () => finish(7));
  expect(saveTablature).toHaveBeenCalledWith(
    expect.objectContaining({ tablature: saved, title: "Saved snapshot" })
  );
  expect(transport().tab).toEqual(newer);
  expect((await panel()).props.dirty).toBe(true);
  expect((await panel()).props.title).toBe("Saved snapshot");
  expect(screen!.root.findAllByType(TablatureLibrary)).toHaveLength(0);
});

test("a cold string prepares asynchronously and coalesces repeated touches", async () => {
  let finish!: () => void;
  jest.mocked(warmGuitar).mockImplementation(
    (_notes, _a, _signal, string) =>
      new Promise<void>((resolve) => {
        if (string === 2) finish = resolve;
      })
  );
  await render();
  await pluck(2);
  await pluck(2);
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  expect(
    jest.mocked(warmGuitar).mock.calls.filter((call) => call[3] === 2)
  ).toHaveLength(1);
  await act(async () => finish());
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:52:string2",
    2
  );
});

test.each(["blur", "record", "unmount"] as const)(
  "a cold string cannot sound after %s supersedes its touch",
  async (transition) => {
    let finish!: () => void;
    jest.mocked(warmGuitar).mockImplementation(
      (_notes, _a, _signal, string) =>
        new Promise<void>((resolve) => {
          if (string === 2) finish = resolve;
        })
    );
    await render();
    await pluck(2);
    await act(async () => {
      if (transition === "blur") {
        mockFocused = false;
        screen!.update(<PlayGuitar />);
      } else if (transition === "record") {
        transport().startRecording();
      } else {
        screen!.unmount();
        screen = undefined;
      }
    });
    await act(async () => finish());
    expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  }
);
