import { db } from "../src/components/database";
import type { SQLTransaction } from "react-native-sqlite-2";
import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Text,
  AppState,
  NativeModules,
  Alert,
  Platform,
  type AppStateStatus
} from "react-native";
import Select from "../src/components/fields/api-select";
import Song from "../src/screens/song";
import Editor from "../src/screens/create-song-chords";
import Menu from "../src/screens/song/header-modal";
import SongRecorder from "../src/screens/song/recorder";
import {
  Action,
  SongTools,
  RhythmGrid,
  ChordSheet
} from "../src/screens/song/tools";
import { defaultSongPreferences } from "../src/components/preferences";
import { WebView } from "react-native-webview";
import { rhythms } from "../src/screens/song/rhythms";
import {
  performanceAudio,
  PerformanceEvent
} from "../src/components/performance-audio";
import * as crud from "../src/components/database/crud";
import * as acousticPlayer from "../src/components/acoustic-player";
import * as acousticInstrument from "../src/components/acoustic-instrument";
import { chordsAboveLyrics } from "../src/screens/song/chords";
import { Formik, FormikProps } from "formik";
import onSubmit from "../src/screens/create-song-chords/formik/on-sabmit";
import initialSong from "../src/screens/create-song-chords/formik/initial-values";
jest.mock("../src/screens/tuner", () => () => null);
jest.mock("../src/screens/tuner/MicrophoneStream", () => ({
  setKeepAwake: jest.fn()
}));
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn()
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: String, i18n: { language: "en" } })
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ setParams: jest.fn() }),
  usePreventRemove: jest.fn(),
  useIsFocused: () => true,
  useRoute: () => ({ params: { id: "1" } }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("../src/screens/create-song-chords", () => () => null);
jest.mock("../src/screens/song/header-modal", () => () => null);
jest.mock("../src/screens/song/video-tabs", () => () => null);
jest.mock(
  "../src/components/header",
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children
);
function mockSongSave(id: number) {
  const writes: string[] = [];
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    const tx: SQLTransaction = {
      executeSql: (sql, _args, done) => {
        writes.push(String(sql));
        done?.(tx, {
          insertId: id,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    success?.();
  });
  return writes;
}
let screen: Renderer.ReactTestRenderer | undefined;

test("a preference edit after the song SQL write wins over stale recognition metadata", async () => {
  const {
    usePreferences,
    flushPreferences
  } = require("../src/components/preferences");
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  usePreferences.setState({
    songs: { 17: { ...defaultSongPreferences, tempo: 80 } }
  });
  let commit: (() => void) | undefined;
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    const tx: SQLTransaction = {
      executeSql: (sql, args, done) =>
        done?.(tx, {
          insertId: 17,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        })
    };
    body(tx);
    commit = success;
  });
  const pending = onSubmit(
    {} as FormikProps<typeof initialSong>,
    {
      ...initialSong,
      id: 17,
      title: "Title",
      content: "Am\nWords",
      tempo: 100
    },
    { replace: jest.fn() }
  );
  for (let i = 0; i < 15; i++) await Promise.resolve();
  usePreferences.getState().updateSong(17, { tempo: 140 });
  commit?.();
  expect(await pending).toBe(true);
  expect(usePreferences.getState().songs[17].tempo).toBe(140);
  commit?.();
  await flushPreferences();
});

test.each(["title", "content"] as const)(
  "raw %s whitespace counts toward the storage limit",
  async (key) => {
    const {
      validationSchema
    } = require("../src/screens/create-song-chords/formik/validation-schema");
    const { songFieldLimits } = require("../src/@interfaces");
    const values = {
      ...initialSong,
      title: "Title",
      content: "  Am\n  Words\n",
      [key]: "\n".repeat(songFieldLimits[key]) + "Words"
    };
    expect(await validationSchema(String).isValid(values)).toBe(false);
  }
);

test("padded oversized content is rejected before opening a save transaction", async () => {
  const writes = mockSongSave(91);
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const values = {
    ...initialSong,
    title: "Padded",
    content: "\n".repeat(2100000) + "Words"
  };
  try {
    const saved = await onSubmit(
      {} as FormikProps<typeof initialSong>,
      values,
      { replace: jest.fn() }
    );
    expect(saved).toBe(false);
    expect(writes.length).toBe(0);
  } finally {
    error.mockRestore();
  }
});

test("legacy field compatibility does not bypass the raw aggregate budget", async () => {
  const {
    validationSchema
  } = require("../src/screens/create-song-chords/formik/validation-schema");
  const original = {
    ...initialSong,
    id: 1,
    title: " ".repeat(270000) + "Title",
    content: "Words"
  };
  expect(await validationSchema(String, original).isValid(original)).toBe(true);
  expect(
    await validationSchema(String, original).isValid({
      ...original,
      content: "\n".repeat(150000) + "Words"
    })
  ).toBe(false);
});

test("an early edit action cannot strand a pending song load", async () => {
  let finish!: (rows: { id: number; title: string; content: string }[]) => void;
  jest.mocked(crud.getAllItems).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  await act(async () => screen!.root.findByType(Menu).props.setIsEdit(true));
  await act(async () =>
    finish([{ id: 1, title: "Loaded", content: "Am\nWords" }])
  );
  expect(JSON.stringify(screen!.toJSON()).includes("LoadingSong")).toBe(false);
  await act(async () => screen!.root.findByType(Menu).props.setIsEdit(true));
  expect(screen!.root.findAllByType(Editor).length).toBe(1);
});

test("independent chord runs produce bounded virtualized items", async () => {
  jest.useFakeTimers();
  require("../src/components/preferences")
    .usePreferences.getState()
    .updateSong(1, { transpose: 0, capo: 0 });
  jest.mocked(crud.getAllItems).mockResolvedValue([
    {
      id: 1,
      title: "Many chords",
      content: "C\n".repeat(3000) + "Final words"
    }
  ]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const blocks: { line: string; onlyChords: boolean }[][] =
    screen!.root.findByType(FlatList).props.data;
  expect(Math.max(...blocks.map((block) => block.length))).toBeLessThanOrEqual(
    9
  );
  expect(
    blocks.flatMap((block) => block).filter((row) => row.line === "C").length
  ).toBe(3000);
  const ending = blocks.find((block) =>
    block.some((row) => row.line === "Final words")
  )!;
  expect(ending[ending.length - 2].line).toBe("C");
});

test.each([
  "title",
  "content",
  "band_name",
  "youtube_music",
  "youtobe_lesson"
] as const)(
  "legacy %s is accepted unchanged but an oversized replacement is rejected",
  async (key) => {
    const {
      validationSchema
    } = require("../src/screens/create-song-chords/formik/validation-schema");
    const { songFieldLimits } = require("../src/@interfaces");
    const value = "x".repeat(songFieldLimits[key] + 1);
    const original = {
      ...initialSong,
      id: 1,
      title: "Title",
      content: "Am\nWords",
      ...(key === "band_name"
        ? { fk_band: { ...initialSong.fk_band, name: value } }
        : { [key]: value })
    };
    const changed =
      key === "band_name"
        ? { ...original, fk_band: { ...original.fk_band, name: value + "y" } }
        : { ...original, [key]: value + "y" };
    expect(await validationSchema(String, original).isValid(original)).toBe(
      true
    );
    expect(await validationSchema(String, original).isValid(changed)).toBe(
      false
    );
    expect(await validationSchema(String).isValid(original)).toBe(false);
  }
);

test("virtualization keeps a dense chord group and its words in the same horizontal block", async () => {
  jest.useFakeTimers();
  require("../src/components/preferences")
    .usePreferences.getState()
    .updateSong(1, { transpose: 0, capo: 0 });
  jest.mocked(crud.getAllItems).mockResolvedValue([
    {
      id: 1,
      title: "Dense",
      content:
        "Long introduction text [Cmaj7]a[Am7]b[Dm7]c[Fmaj7]d words at the end of the long line\n" +
        "Plain line\n".repeat(201)
    }
  ]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const blocks: { line: string; onlyChords: boolean }[][] =
    screen!.root.findByType(FlatList).props.data;
  const chordBlock = blocks.find((block) =>
    block.some((row) => row.onlyChords)
  )!;
  expect(chordBlock.some((row) => row.line.includes("words at the end"))).toBe(
    true
  );
  expect(chordBlock.length).toBeGreaterThan(4);
});

test("long chord labels keep subsequent chords aligned with their lyric words", () => {
  const output = chordsAboveLyrics("[Cmaj7]I [D]go");
  const [chords, words] = output.split("\n");
  expect(chords.indexOf("D")).toBe(words.indexOf("go"));
  expect(words.replace(/ +/g, " ")).toBe("I go");
  expect(chordsAboveLyrics(output)).toBe(output);
});

test("pending native fingering cannot resume after a background and foreground cycle", async () => {
  jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
  const previous = AppState.currentState;
  AppState.currentState = "active";
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .mocked(AppState.addEventListener)
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  let finish!: (ready: boolean) => void;
  const prepared = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  jest
    .mocked(performanceAudio.prepareFingering)
    .mockImplementation((_key, wave) =>
      wave ? prepared : Promise.resolve(false)
    );
  try {
    await act(async () => {
      screen = Renderer.create(
        <ChordSheet chord="Am" onChange={() => {}} onClose={() => {}} />
      );
    });
    const card = screen!.root.findAll(
      (node) =>
        typeof node.props.onPressIn === "function" &&
        String(node.props.accessibilityLabel).startsWith("Fingering ")
    )[0];
    await act(async () => card.props.onPressIn());
    const key = jest
      .mocked(performanceAudio.prepareFingering)
      .mock.calls.at(-1)![0];
    await act(async () =>
      screen!.root.findByType(WebView).props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: "fingering", key, wave: "AAAA" })
        }
      })
    );
    for (const state of ["background", "active"] as const)
      await act(async () => {
        AppState.currentState = state;
        [...listeners].forEach((listener) => listener(state));
      });
    await act(async () => finish(true));
    expect(performanceAudio.playPreparedGuitar).not.toHaveBeenCalled();
    await act(async () => card.props.onPressIn());
    expect(performanceAudio.playPreparedGuitar).toHaveBeenCalledTimes(1);
  } finally {
    AppState.currentState = previous;
  }
});

test("late preparation of an earlier fingering cannot replace the latest tap", async () => {
  jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
  jest
    .mocked(performanceAudio.prepareFingering)
    .mockImplementation(async (_key, wave) => !!wave);
  await act(async () => {
    screen = Renderer.create(
      <ChordSheet chord="Am" onChange={() => {}} onClose={() => {}} />
    );
  });
  const cards = screen!.root.findAll(
    (node) =>
      typeof node.props.onPressIn === "function" &&
      String(node.props.accessibilityLabel).startsWith("Fingering ")
  );
  expect(cards.length).toBeGreaterThanOrEqual(2);
  const key = (index: number) =>
    "fingering:" +
    JSON.stringify([
      0,
      ...String(cards[index].props.accessibilityLabel)
        .split(": ")[1]
        .split(", ")
        .map((fret) => (fret === "×" ? null : Number(fret)))
    ]);
  const first = key(0),
    second = key(1);
  expect(first).not.toBe(second);
  await act(async () =>
    jest
      .mocked(AppState.addEventListener)
      .mock.calls.forEach(([, listener]) => listener("active"))
  );
  await act(async () => {
    cards[0].props.onPressIn();
    cards[1].props.onPressIn();
  });
  const web = screen!.root.findByType(WebView);
  await act(async () =>
    web.props.onMessage({
      nativeEvent: {
        data: JSON.stringify({ type: "fingering", key: first, wave: "AAAA" })
      }
    })
  );
  expect(performanceAudio.playPreparedGuitar).not.toHaveBeenCalled();
  await act(async () =>
    web.props.onMessage({
      nativeEvent: {
        data: JSON.stringify({ type: "fingering", key: second, wave: "AAAA" })
      }
    })
  );
  expect(performanceAudio.playPreparedGuitar).toHaveBeenCalledTimes(1);
  expect(performanceAudio.playPreparedGuitar).toHaveBeenCalledWith(second);
});

test("saving an imported draft replaces the form route instead of retaining a reusable new-song draft", async () => {
  const writes = mockSongSave(73);
  const navigation = { navigate: jest.fn(), replace: jest.fn() };
  let form!: FormikProps<typeof initialSong>;
  await act(async () => {
    screen = Renderer.create(
      <Formik
        initialValues={{
          ...initialSong,
          title: "Imported",
          content: "Am\nWords"
        }}
        onSubmit={(values, actions) => onSubmit(actions, values, navigation)}
      >
        {(value) => {
          form = value;
          return null;
        }}
      </Formik>
    );
  });
  await act(async () => {
    await form.submitForm();
  });
  expect(navigation.replace).toHaveBeenCalledWith("Song", { id: "73" });
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(
    writes.filter((sql) => sql.startsWith("INSERT INTO songs"))
  ).toHaveLength(1);
});

test("recording list hides empty interrupted takes while retaining active processing", async () => {
  const previous = NativeModules.PerformanceAudio;
  const saved = { path: "saved.m4a", date: 3, bytes: 2048 };
  const processing = {
    path: "processing.m4a",
    date: 2,
    bytes: 0,
    processing: true
  };
  NativeModules.PerformanceAudio = {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    listTakes: jest
      .fn()
      .mockResolvedValue([
        saved,
        processing,
        { path: "interrupted.m4a", date: 1, bytes: 0, processing: false }
      ])
  };
  try {
    const { performanceAudio: actual } = jest.requireActual<
      typeof import("../src/components/performance-audio")
    >("../src/components/performance-audio");
    await expect(actual.list(1)).resolves.toEqual([saved, processing]);
  } finally {
    NativeModules.PerformanceAudio = previous;
  }
});

beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(() => ({ remove: jest.fn() }));
});

test("starting a recording enables lyric scrolling and allows an independent pause", async () => {
  jest.useFakeTimers();
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValue([{ id: 1, title: "Song", content: "Am\nWords" }]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const recorder = screen!.root.findByType(SongRecorder);
  expect(
    screen!.root
      .findAllByType(Action)
      .some((node) => node.props.label === "Rhythm")
  ).toBe(false);
  await act(async () => recorder.props.onStart());
  const scrollButton = () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "ScrollLyrics")!;
  expect(scrollButton().props.selected).toBe(true);
  await act(async () => scrollButton().props.onPress());
  expect(scrollButton().props.selected).toBe(false);
  expect(screen!.root.findByType(SongRecorder).props.active).toBe(true);
});

test.each([
  { position: 300, expected: 300 },
  { position: 1200, expected: 0 }
])(
  "recording resumes scrolling from $expected when saved at $position",
  async ({ position, expected }) => {
    jest.useFakeTimers();
    jest
      .mocked(crud.getAllItems)
      .mockResolvedValue([
        { id: 1, title: "Song", content: "Am\nOriginal words" }
      ]);
    await act(async () => {
      screen = Renderer.create(<Song />);
    });
    const scroll = screen!.root.findByType(ScrollView);
    const scrollTo = jest.spyOn(scroll.instance, "scrollTo");
    await act(async () => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
      scroll.props.onContentSizeChange(360, 1600);
      scroll.props.onScroll({
        nativeEvent: { contentOffset: { y: position } }
      });
    });
    scrollTo.mockClear();
    await act(async () =>
      screen!.root.findByType(SongRecorder).props.onStart()
    );
    await act(async () => jest.advanceTimersByTime(32));
    expect(scrollTo).toHaveBeenCalledWith({ y: expected, animated: false });
    expect(
      screen!.root
        .findAllByType(Action)
        .find((button) => button.props.label === "ScrollLyrics")!.props.selected
    ).toBe(true);
  }
);
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.resetAllMocks();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("practice asks for a song pattern instead of inventing downstrokes", async () => {
  await act(async () => {
    screen = Renderer.create(
      <SongTools
        content={"Am\nWords"}
        value={defaultSongPreferences}
        onChange={() => {}}
        onClose={() => {}}
      />
    );
  });
  await act(async () =>
    screen!.root
      .findAll(
        (node) =>
          node.props.accessibilityRole === "tab" &&
          typeof node.props.onPress === "function" &&
          node
            .findAllByType(Text)
            .some((text) => text.props.children === "Practice")
      )[0]
      .props.onPress()
  );
  expect(screen!.root.findAllByType(WebView)).toHaveLength(0);
  const choose = screen!.root
    .findAllByType(Action)
    .find((node) => node.props.label === "ChooseSongRhythm");
  expect(choose).toBeDefined();
  await act(async () => choose!.props.onPress());
  expect(screen!.root.findAllByType(RhythmGrid)).toHaveLength(rhythms.length);
});

test("opening song tools mounts the controls before preparing the audio bank", async () => {
  jest.useFakeTimers();
  const previous = AppState.currentState;
  AppState.currentState = "active";
  const bank = jest.spyOn(acousticPlayer, "acousticBank");
  await act(async () => {
    screen = Renderer.create(
      <SongTools
        initialTab="rhythm"
        content="Am\nOriginal words"
        value={defaultSongPreferences}
        onChange={() => {}}
        onClose={() => {}}
      />
    );
  });
  expect(screen!.root.findAllByType(RhythmGrid)).toHaveLength(rhythms.length);
  expect(bank).not.toHaveBeenCalled();
  await act(async () => jest.runAllTimersAsync());
  expect(bank).toHaveBeenCalledTimes(1);
  AppState.currentState = previous;
});
test("each rhythm can be selected once through its full pattern and applied", async () => {
  jest.useFakeTimers();
  const change = jest.fn();
  const injectJavaScript = jest.fn();

  await act(async () => {
    screen = Renderer.create(
      <SongTools
        initialTab="rhythm"
        content="E\nWords"
        value={defaultSongPreferences}
        onChange={change}
        onClose={() => {}}
      />,
      { createNodeMock: () => ({ injectJavaScript }) }
    );
  });
  const activatePreview = async () => {
    const calls = jest.mocked(AppState.addEventListener).mock.calls;
    await act(async () => calls[calls.length - 1][1]("active"));
  };
  const cards = () =>
    screen!.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        rhythms.some((item) => item.title === node.props.accessibilityLabel) &&
        node.props.accessibilityState?.selected !== undefined
    );
  const previews = () =>
    screen!.root
      .findAllByType(Action)
      .filter((node) => ["play", "pause"].includes(node.props.icon));
  expect(previews()).toHaveLength(rhythms.length);
  for (let index = 0; index < rhythms.length; index++) {
    await act(async () => previews()[index].props.onPress());
    await activatePreview();
    await act(async () =>
      screen!.root
        .findByType(WebView)
        .props.onMessage({ nativeEvent: { data: "ready" } })
    );
    expect(previews().some((node) => node.props.icon === "pause")).toBe(false);
    await act(async () =>
      screen!.root
        .findByType(WebView)
        .props.onMessage({ nativeEvent: { data: "started" } })
    );
    expect(change).not.toHaveBeenCalled();
    const configuration = injectJavaScript.mock.calls
      .filter(([script]) => script.startsWith("window.configurePlayer("))
      .at(-1)![0];
    expect(configuration).toContain(
      `"pattern":${JSON.stringify(rhythms[index].pattern.padEnd(Math.ceil(rhythms[index].pattern.length / (rhythms[index].meter * rhythms[index].division)) * rhythms[index].meter * rhythms[index].division, "-"))}`
    );
    expect(configuration).toContain('"requested":true');
    expect(
      previews().filter((node) => node.props.icon === "pause")
    ).toHaveLength(1);
  }
  for (let index = 0; index < rhythms.length; index++) {
    expect(cards()[index].findAllByType(RhythmGrid)).toHaveLength(1);
    await act(async () => cards()[index].props.onPress());
    expect(change).toHaveBeenLastCalledWith({
      strum: rhythms[index].pattern,
      strumMeter: rhythms[index].meter,
      strumDivision: rhythms[index].division,
      strumPreset: rhythms[index].id
    });
  }
  expect(
    screen!.root
      .findAllByType(Action)
      .some((node) => node.props.label === "UseRhythm")
  ).toBe(false);
  expect(change).toHaveBeenCalledWith({
    strum: rhythms[7].pattern,
    strumMeter: rhythms[7].meter,
    strumDivision: rhythms[7].division,
    strumPreset: rhythms[7].id
  });
  await act(async () => jest.runAllTimersAsync());
  // Publishing prepared chunks commits before the transfer effect schedules its timers.
  await act(async () => jest.runAllTimersAsync());
  const html = screen!.root.findByType(WebView).props.source.html;
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const sources: any[] = [];
  let clock = 0;
  const parameter = () => ({
    value: 0,
    setValueAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
    cancelAndHoldAtTime: jest.fn()
  });
  const connect = () => ({ connect() {}, disconnect() {} });
  const decoded: object[] = [];
  const AudioContext = jest.fn(() => ({
    get currentTime() {
      return clock;
    },
    destination: {},
    resume: () => Promise.resolve(),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length)
    }),
    decodeAudioData: () => {
      const buffer = { duration: 4, id: decoded.length };
      decoded.push(buffer);
      return Promise.resolve(buffer);
    },
    createGain: () => ({ ...connect(), gain: parameter() }),
    createConvolver: () => ({ ...connect(), normalize: true, buffer: null }),
    createDynamicsCompressor: () => ({
      ...connect(),
      ...Object.fromEntries(
        ["threshold", "knee", "ratio", "attack", "release"].map((key) => [
          key,
          parameter()
        ])
      )
    }),
    createBufferSource: () => {
      const voice = {
        ...connect(),
        buffer: null,
        playbackRate: { value: 1 },
        start: jest.fn(),
        stop: jest.fn()
      };
      sources.push(voice);
      return voice;
    }
  }));
  let schedule = () => {};
  const window: any = {
    AudioContext,
    ReactNativeWebView: { postMessage: jest.fn() },
    addEventListener() {}
  };
  require("node:vm").runInNewContext(source, {
    window,
    document: {
      hidden: false,
      getElementById: () => ({ setAttribute() {} }),
      addEventListener() {}
    },
    atob: (value: string) =>
      require("node:buffer").Buffer.from(value, "base64").toString("binary"),
    setTimeout: (callback: () => void) => {
      schedule = callback;
    },
    clearTimeout() {}
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(window.ReactNativeWebView.postMessage).toHaveBeenCalledWith("ready");
  const initialization = injectJavaScript.mock.calls
    .map(([script]) => script as string)
    .filter((script) =>
      /^window\.(beginInstrument|appendInstrument|finishInstrument)\(/.test(
        script
      )
    )
    .join("\n");
  expect(initialization).toContain("window.finishInstrument(");
  const load = window.loadInstrument;
  window.loadInstrument = (data: any) => {
    data.bank.recordings = [];
    return load(data);
  };
  require("node:vm").runInNewContext(initialization, { window });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  window.configurePlayer({
    stroke: null,
    activeFingering: 0,
    pattern: "DU",
    meter: 4,
    tempo: 120,
    requested: true,
    practice: false
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  clock = 1;
  schedule();
  const sampleCount = decoded.length / 2;
  expect(sampleCount).toBeGreaterThanOrEqual(4);
  const down = sources.slice(0, sampleCount);
  const up = sources.slice(sampleCount, sampleCount + 3);
  const medium = decoded.filter((_, index) => index % 2 === 1);
  const soft = decoded.filter((_, index) => index % 2 === 0);
  expect(down.map((voice) => voice.buffer)).toEqual(medium);
  expect(up.map((voice) => voice.buffer)).toEqual(
    [...soft].reverse().slice(0, 3)
  );
  for (const stroke of [down, up]) {
    const times = stroke.map((voice) => voice.start.mock.calls[0][0]);
    expect(times.every(Number.isFinite)).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.at(-1) - times[0]).toBeLessThan(0.09);
  }
  const decodeCount = decoded.length;
  const previous = sources.slice();
  window.configurePlayer({
    stroke: null,
    activeFingering: 0,
    pattern: "U-D-",
    meter: 4,
    tempo: 80,
    requested: true,
    practice: false
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(AudioContext).toHaveBeenCalledTimes(1);
  expect(decoded).toHaveLength(decodeCount);
  expect(previous.every((voice) => voice.stop.mock.calls.length)).toBe(true);
  expect(sources[previous.length].buffer).toBe(soft.at(-1));
  window.configurePlayer({
    stroke: null,
    activeFingering: 0,
    pattern: "U-D-",
    meter: 4,
    tempo: 80,
    requested: false,
    practice: false
  });
});
test.each(["saved", "interrupted"] as const)(
  "processing recordings unlock after %s and interrupted takes remain visible",
  async (state) => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    let listener!: (event: PerformanceEvent) => void;
    const subscription = performanceAudio.listen(() => {});
    jest.spyOn(performanceAudio, "listen").mockImplementation((callback) => {
      listener = callback;
      return subscription;
    });
    const take = {
      path: "/performances/song-1-123.m4a",
      date: 123,
      bytes: 1000,
      processing: true
    };
    jest.mocked(performanceAudio.list).mockResolvedValue([take]);
    await act(async () => {
      screen = Renderer.create(
        <SongRecorder songId={1} active onStart={() => {}} />
      );
    });
    await act(async () =>
      screen!.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RecordPerformance")!
        .props.onPress()
    );
    const controls = () =>
      screen!.root
        .findAllByType(Action)
        .filter((node) =>
          ["ListenTake", "SaveRecordingFile", "DeleteTake"].includes(
            node.props.accessibilityLabel
          )
        );
    expect(controls()).toHaveLength(3);
    expect(controls().every((node) => node.props.disabled)).toBe(true);
    jest
      .mocked(performanceAudio.list)
      .mockResolvedValue([
        { ...take, processing: false, interrupted: state === "interrupted" }
      ]);
    await act(async () => listener({ state, uri: take.path }));
    expect(controls().every((node) => !node.props.disabled)).toBe(true);
    if (state === "interrupted") {
      expect(Alert.alert).toHaveBeenCalledWith("RecordingInterrupted");
      expect(
        screen!.root
          .findAllByType(Text)
          .some((node) => node.props.children === "RecordingInterrupted")
      ).toBe(true);
    }
  }
);
async function openSelect(onSelect: jest.Mock) {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  await act(async () => {
    screen = Renderer.create(
      React.createElement(Select, {
        tableName: "bands",
        labelKey: "name",
        valueKey: "id",
        hasCreateBtn: true,
        value: { id: "", name: "", search_text_lower: "" },
        onSelect
      })
    );
  });
  await act(async () =>
    screen!.root.findAllByType(TouchableOpacity)[0].props.onPress()
  );
}
test("creating a performer selects the persisted record", async () => {
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { id: 7, name: "Audit band", search_text_lower: "audit band" }
    ]);
  jest.mocked(crud.createItem).mockResolvedValue({
    insertId: 7,
    rowsAffected: 1,
    rows: { length: 0, item: jest.fn() }
  });
  const selected = jest.fn();
  await openSelect(selected);
  await act(async () =>
    screen!.root.findByType(TextInput).props.onChangeText("Audit band")
  );
  await act(async () => jest.advanceTimersByTime(400));
  const create = screen!.root
    .findAllByType(TouchableOpacity)
    .find((button) => button.props.onPress.name === "handleCreate");
  expect(create).toBeDefined();
  await act(async () => create!.props.onPress());
  expect(selected).toHaveBeenCalledWith({
    id: 7,
    name: "Audit band",
    search_text_lower: "audit band"
  });
});
test("performer suggestions ignore obsolete responses", async () => {
  let finishOld!: (rows: { id: number; name: string }[]) => void;
  jest
    .mocked(crud.getAllItems)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    )
    .mockResolvedValueOnce([{ id: 2, name: "New" }]);
  await openSelect(jest.fn());
  await act(async () =>
    screen!.root.findByType(TextInput).props.onChangeText("Old")
  );
  await act(async () => jest.advanceTimersByTime(400));
  await act(async () =>
    screen!.root.findByType(TextInput).props.onChangeText("New")
  );
  await act(async () => jest.advanceTimersByTime(400));
  expect(screen!.root.findByType(FlatList).props.data[0].name).toBe("New");
  await act(async () => finishOld([{ id: 1, name: "Old" }]));
  expect(screen!.root.findByType(FlatList).props.data[0].name).toBe("New");
});
test("closing the song editor reloads the persisted content", async () => {
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValueOnce([
      {
        id: 1,
        title: "Title",
        content: "Old content",
        band_name: "Band",
        band_id: 3
      }
    ])
    .mockResolvedValueOnce([
      {
        id: 1,
        title: "Title",
        content: "New content",
        band_name: "Band",
        band_id: 3
      }
    ]);
  jest.mocked(crud.updateItem).mockResolvedValue(undefined);
  await act(async () => {
    screen = Renderer.create(React.createElement(Song));
  });
  await act(async () => screen!.root.findByType(Menu).props.setIsEdit(true));
  const endEdit = screen!.root.findByType(Editor).props.setIsEdit;
  await act(async () => endEdit(false));
  expect(crud.getAllItems).toHaveBeenCalledTimes(2);
  expect(
    screen!.root
      .findAllByType(Text)
      .some(
        (node) =>
          React.Children.toArray(node.props.children).join("") === "New content"
      )
  ).toBe(true);
});

test.each([
  "Em7 G D4 A7(4)",
  "[Intro] Em7 G Dsus4 A7sus4",
  "Em7 G Dsus4 A7sus4 2x"
])("provider chord line participates in musical tools: %s", (line) => {
  const {
    songChordSequence,
    transposeChord
  } = require("../src/screens/song/chords");
  const normalized = chordsAboveLyrics(line);
  expect(songChordSequence(normalized)).toEqual([
    "Em7",
    "G",
    "Dsus4",
    "A7sus4"
  ]);
  expect(transposeChord("D4", 2)).toBe("Esus4");
});

test.each([
  ["title", 1001],
  ["content", 200001],
  ["youtube_music", 4001]
])("editor rejects oversized %s before storage", async (key, length) => {
  const {
    validationSchema
  } = require("../src/screens/create-song-chords/formik/validation-schema");
  expect(
    await validationSchema(String).isValid({
      title: "Title",
      content: "Am\nWords",
      [key]:
        key === "youtube_music"
          ? "https://youtube.com/watch?v=" + "a".repeat(length)
          : "a".repeat(length)
    })
  ).toBe(false);
});

test.each([
  "https://youtube.com/shorts/dQw4w9WgXcQ",
  "https://youtube.com/live/dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ?t=12"
])("supported video URL: %s", (url) => {
  expect(
    require("../src/components/utils/extract-youtube-id").default(url)
  ).toBe("dQw4w9WgXcQ");
});

test.each(["youtube_music", "youtobe_lesson"] as const)(
  "%s rejects links that cannot identify a playable YouTube video",
  async (key) => {
    const {
      validationSchema
    } = require("../src/screens/create-song-chords/formik/validation-schema");
    const values = { ...initialSong, title: "Title", content: "Am\nWords" };
    const schema = validationSchema(String);
    for (const link of [
      "https://example.com/?v=dQw4w9WgXcQ",
      "https://www.youtube.com/playlist?list=PL1234567890",
      "https://www.youtube.com/watch?v=short",
      "ftp://youtube.com/watch?v=dQw4w9WgXcQ"
    ]) {
      expect(await schema.isValid({ ...values, [key]: link })).toBe(false);
    }
    for (const link of [
      "",
      "https://youtu.be/dQw4w9WgXcQ?t=12",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ"
    ]) {
      expect(await schema.isValid({ ...values, [key]: link })).toBe(true);
    }
    const legacy = {
      ...values,
      id: 1,
      [key]: "https://example.com/legacy"
    };
    expect(await validationSchema(String, legacy).isValid(legacy)).toBe(true);
  }
);

test("non-HTTP video links are not embedded", () => {
  expect(
    require("../src/components/utils/extract-youtube-id").default(
      "ftp://youtube.com/watch?v=dQw4w9WgXcQ"
    )
  ).toBe("");
});

test("non-YouTube v parameters are not embedded", () => {
  expect(
    require("../src/components/utils/extract-youtube-id").default(
      "https://example.com/?v=dQw4w9WgXcQ"
    )
  ).toBe("");
});

test("saving an imported capo arrangement preserves sounding pitch and playable shapes", async () => {
  const { importedSong } = require("../src/components/library-files");
  const {
    songChordSequence,
    transposeChord
  } = require("../src/screens/song/chords");
  const { usePreferences } = require("../src/components/preferences");
  const imported = importedSong(
    "{title: Example}\n{capo: 2}\n{tuning: E A D G B E}\n[Em]Example words",
    "sample.cho"
  );
  expect(songChordSequence(imported.content)).toEqual(["F#m"]);
  mockSongSave(888);
  const navigation = { replace: jest.fn() };
  await act(async () => {
    screen = Renderer.create(
      <Formik
        initialValues={{ ...initialSong, ...imported }}
        onSubmit={(values, actions) => onSubmit(actions, values, navigation)}
      >
        {({ submitForm }) => <Text onPress={submitForm}>Save</Text>}
      </Formik>
    );
  });
  await act(async () => screen!.root.findByType(Text).props.onPress());
  const preferences = usePreferences.getState().songs[888];
  expect(preferences).toMatchObject({
    capo: 2,
    transpose: 0,
    sourceTuning: "E A D G B E"
  });
  expect(
    transposeChord(
      songChordSequence(imported.content)[0],
      preferences.transpose - preferences.capo
    )
  ).toBe("Em");
});

test("artist length uses the same contract as song backup fields", async () => {
  const {
    validationSchema
  } = require("../src/screens/create-song-chords/formik/validation-schema");
  expect(
    await validationSchema(String).isValid({
      ...initialSong,
      title: "Title",
      content: "Am\nWords",
      fk_band: { id: "", name: "a".repeat(1001), search_text_lower: "" }
    })
  ).toBe(false);
});

test.each(["|Am | F | C | G|", "|:Am|F|C|G:|"])(
  "bar-delimited chord text stays consistent across transposition, import and practice: %s",
  (line) => {
    const {
      transposeSong,
      songChordSequence
    } = require("../src/screens/song/chords");
    const { importedSong } = require("../src/components/library-files");
    expect(songChordSequence(transposeSong(line, 2))).toEqual([
      "Bm",
      "G",
      "D",
      "A"
    ]);
    expect(transposeSong(line, 2).replace(/[A-G][#b]?(?:m)?/g, "_")).toBe(
      line.replace(/[A-G][#b]?(?:m)?/g, "_")
    );
    const imported = importedSong(
      `{title: Example}\n{capo:2}\n${line}\nWords`,
      "example.cho"
    );
    expect(songChordSequence(imported.content)).toEqual(["Bm", "G", "D", "A"]);
  }
);

test("bar-delimited edge chords remain clickable in the displayed key", async () => {
  const { usePreferences } = require("../src/components/preferences");
  usePreferences.getState().updateSong(1, { transpose: 2, capo: 0 });
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValue([
      { id: 1, title: "Song", content: "|Am | F | C | G|\nWords" }
    ]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const chords = screen!.root
    .findAllByType(Text)
    .filter(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.props.accessibilityRole === "button" &&
        ["Bm", "G", "D", "A"].includes(node.props.children)
    );
  expect(chords.map((node) => node.props.children)).toEqual([
    "Bm",
    "G",
    "D",
    "A"
  ]);
});

test("the song screen transposes chord and lyric rows together", async () => {
  const { usePreferences } = require("../src/components/preferences");
  usePreferences.getState().updateSong(1, { transpose: 1, capo: 0 });
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValue([{ id: 1, title: "Alignment", content: "C G\na b" }]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const rows = screen!.root.findAllByType(Text).flatMap((node) => {
    const parts = node.props.children?.[0];
    return Array.isArray(parts)
      ? [
          parts
            .map((part) =>
              typeof part === "string" ? part : part.props.children
            )
            .join("")
        ]
      : [];
  });
  expect(rows).toEqual(["C# G#", "a  b"]);
});

test("song settings do not end an active performance recording", async () => {
  const previousState = AppState.currentState;
  AppState.currentState = "active";
  try {
    jest.useFakeTimers();
    jest
      .spyOn(require("../src/components/permissions"), "default")
      .mockResolvedValue(true);
    jest.mocked(performanceAudio.start).mockResolvedValue("song-1-123.m4a");
    jest.mocked(performanceAudio.stop).mockResolvedValue("song-1-123.m4a");
    jest.mocked(performanceAudio.list).mockResolvedValue([]);
    jest
      .mocked(crud.getAllItems)
      .mockResolvedValue([{ id: 1, title: "Song", content: "Am\nWords" }]);
    await act(async () => {
      screen = Renderer.create(<Song />);
    });
    await act(async () =>
      screen!.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RecordPerformance")!
        .props.onPress()
    );
    await act(async () =>
      screen!.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "StartRecording" &&
            typeof node.props.onPress === "function"
        )
        .props.onPress()
    );
    expect(performanceAudio.start).toHaveBeenCalledTimes(1);
    jest.mocked(performanceAudio.stop).mockClear();
    await act(async () =>
      screen!.root
        .findAllByType(Action)
        .find((node) => node.props.accessibilityLabel === "SongTools")!
        .props.onPress()
    );
    expect(screen!.root.findByType(SongRecorder).props.active).toBe(true);
    expect(performanceAudio.stop).not.toHaveBeenCalled();
    await act(async () => screen!.unmount());
    screen = undefined;
    expect(performanceAudio.stop).toHaveBeenCalledTimes(1);
  } finally {
    AppState.currentState = previousState;
  }
});

test("an unmounted fingering cannot start a delayed native preview", async () => {
  jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
  let resolve!: (prepared: boolean) => void;
  jest
    .mocked(performanceAudio.prepareFingering)
    .mockImplementation(async (_key, wave) =>
      wave
        ? await new Promise<boolean>((done) => {
            resolve = done;
          })
        : false
    );
  await act(async () => {
    screen = Renderer.create(
      <ChordSheet chord="Am" onChange={() => {}} onClose={() => {}} />
    );
  });
  await act(async () =>
    jest
      .mocked(AppState.addEventListener)
      .mock.calls.forEach(([, listener]) => listener("active"))
  );
  const card = screen!.root.findAll(
    (node) =>
      typeof node.props.onPressIn === "function" &&
      String(node.props.accessibilityLabel).startsWith("Fingering ")
  )[0];
  const key =
    "fingering:" +
    JSON.stringify([
      0,
      ...String(card.props.accessibilityLabel)
        .split(": ")[1]
        .split(", ")
        .map((fret) => (fret === "×" ? null : Number(fret)))
    ]);
  await act(async () => card.props.onPressIn());
  await act(async () =>
    screen!.root.findByType(WebView).props.onMessage({
      nativeEvent: {
        data: JSON.stringify({ type: "fingering", key, wave: "AAAA" })
      }
    })
  );
  await act(async () => screen!.unmount());
  screen = undefined;
  await act(async () => resolve(true));
  expect(performanceAudio.playPreparedGuitar).not.toHaveBeenCalled();
});

test("source tuning is visible in both the song and the editor", async () => {
  const { usePreferences } = require("../src/components/preferences");
  usePreferences.getState().updateSong(1, { sourceTuning: "D A D G B E" });
  const song = { id: 1, title: "Drop D", content: "D\nWords" };
  jest.mocked(crud.getAllItems).mockResolvedValue([song]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  expect(JSON.stringify(screen!.toJSON())).toContain("D A D G B E");
  await act(async () => screen!.unmount());
  const ActualEditor = jest.requireActual<
    typeof import("../src/screens/create-song-chords")
  >("../src/screens/create-song-chords").default;
  await act(async () => {
    screen = Renderer.create(<ActualEditor song={song} />);
  });
  expect(JSON.stringify(screen!.toJSON())).toContain("D A D G B E");
});

test.each(["android", "ios"] as const)(
  "cover actions offer cancellation on %s",
  async (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    const { usePreferences } = require("../src/components/preferences");
    usePreferences
      .getState()
      .updateSong(1, { cover: "data:image/jpeg;base64,/9j/2Q==" });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const ActualEditor = jest.requireActual<
      typeof import("../src/screens/create-song-chords")
    >("../src/screens/create-song-chords").default;
    await act(async () => {
      screen = Renderer.create(
        <ActualEditor song={{ id: 1, title: "Title", content: "Am\nWords" }} />
      );
    });
    await act(async () =>
      screen!.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "ChangeSongCover" &&
            typeof node.props.onPress === "function"
        )
        .props.onPress()
    );
    const args = alert.mock.calls.at(-1)!;
    if (platform === "android") expect(args[2]!.length).toBeLessThanOrEqual(3);
    else
      expect(args[2]!.some((button) => button.style === "cancel")).toBe(true);
    expect(
      args[3]?.cancelable ||
        args[2]!.some((button) => button.style === "cancel")
    ).toBe(true);
  }
);

test.each(["C7(b9)", "Cmaj13", "C11"])(
  "extended chord notation survives transposition and practice: %s",
  (chord) => {
    const {
      transposeSong,
      songChordSequence
    } = require("../src/screens/song/chords");
    expect(transposeSong(`C ${chord} F`, 2)).toBe(
      `D ${chord.replace(/^C/, "D")} G`
    );
    expect(songChordSequence(`C ${chord} F`)).toEqual(["C", chord, "F"]);
  }
);

test.each(["Cm(maj7)", "CmMaj7", "Cø7", "C°7", "C+", "DbM9/Ab", "C6/9"])(
  "expanded parser preserves previously supported notation: %s",
  (chord) => {
    const {
      songChordSequence,
      transposeChord
    } = require("../src/screens/song/chords");
    expect(songChordSequence(chord)).toEqual([chord]);
    expect(transposeChord(chord, 2)).not.toBe(chord);
  }
);

test("an evicted native fingering is rebuilt from its rendered waveform and plays once", async () => {
  jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
  let cached = false;
  jest
    .mocked(performanceAudio.prepareFingering)
    .mockImplementation(async (_key, wave) => {
      if (wave) cached = true;
      return cached;
    });
  await act(async () => {
    screen = Renderer.create(
      <ChordSheet chord="Am" onChange={() => {}} onClose={() => {}} />
    );
  });
  await act(async () =>
    jest
      .mocked(AppState.addEventListener)
      .mock.calls.forEach(([, listener]) => listener("active"))
  );
  const card = screen!.root.findAll(
    (node) =>
      typeof node.props.onPressIn === "function" &&
      String(node.props.accessibilityLabel).startsWith("Fingering ")
  )[0];
  const key =
    "fingering:" +
    JSON.stringify([
      0,
      ...String(card.props.accessibilityLabel)
        .split(": ")[1]
        .split(", ")
        .map((value) => (value === "×" ? null : Number(value)))
    ]);
  await act(async () =>
    screen!.root.findByType(WebView).props.onMessage({
      nativeEvent: {
        data: JSON.stringify({ type: "fingering", key, wave: "AAAA" })
      }
    })
  );
  cached = false;
  jest.mocked(performanceAudio.prepareFingering).mockClear();
  jest.mocked(performanceAudio.playPreparedGuitar).mockImplementation(() => {
    expect(cached).toBe(true);
  });
  await act(async () => card.props.onPressIn());
  expect(performanceAudio.prepareFingering).toHaveBeenCalledWith(key, "AAAA");
  expect(performanceAudio.playPreparedGuitar).toHaveBeenCalledTimes(1);
});

test("the initially highlighted Cm shape matches the recorded rhythm voicing", async () => {
  await act(async () => {
    screen = Renderer.create(
      <ChordSheet chord="Cm" onChange={() => {}} onClose={() => {}} />
    );
  });
  const selected = screen!.root.findAll(
    (node) =>
      typeof node.props.onPressIn === "function" &&
      node.props.accessibilityState?.selected &&
      String(node.props.accessibilityLabel).startsWith("Fingering ")
  );
  expect(selected).toHaveLength(1);
  expect(String(selected[0].props.accessibilityLabel).split(": ")[1]).toBe(
    "×, 3, 5, 5, 4, 3"
  );
});

test("all 24 recorded defaults and explicit selections use one fingering resolver", () => {
  const {
    recordedChordFrets,
    selectedChordShape
  } = require("../src/components/acoustic-player");
  const { chordShapes } = require("../src/screens/song/chords");
  expect(Object.keys(recordedChordFrets)).toHaveLength(24);
  for (const [chord, frets] of Object.entries(recordedChordFrets)) {
    expect(selectedChordShape(chord).frets).toEqual(frets);
    expect(chordShapes(chord)[selectedChordShape(chord).index]).toEqual(frets);
    expect(selectedChordShape(chord, 0).index).toBe(0);
  }
});

test.each(["[Intro]Am", "[Verse]C G", "[Verse] C G"])(
  "section chord row survives editor save/reopen/transposition: %s",
  (line) => {
    const {
      transposeSong,
      songChordSequence,
      songContentFromEditor
    } = require("../src/screens/song/chords");
    const original = `${line}\nHello words`;
    const saved = songContentFromEditor(original, chordsAboveLyrics(original));
    const reopened = transposeSong(saved, 0);
    expect(reopened).toContain(
      line.startsWith("[Intro]") ? "[Intro]" : "[Verse]"
    );
    expect(songChordSequence(reopened)).toEqual(
      line.startsWith("[Intro]") ? ["Am"] : ["C", "G"]
    );
    expect(chordsAboveLyrics(reopened).split("\n").at(-1)).toBe("Hello words");
    expect(songChordSequence(transposeSong(saved, 2))).toEqual(
      line.startsWith("[Intro]") ? ["Bm"] : ["D", "A"]
    );
  }
);

test.each([false, true])(
  "recording waits for foreground after permission and cancels on exit: %s",
  async (leave) => {
    jest.mocked(performanceAudio.list).mockResolvedValue([]);
    jest.mocked(performanceAudio.stop).mockResolvedValue(null);
    const previous = AppState.currentState;
    AppState.currentState = "active";
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest
      .mocked(AppState.addEventListener)
      .mockImplementation((_event, callback) => {
        listeners.add(callback);
        return { remove: () => listeners.delete(callback) };
      });
    let grant!: (value: boolean) => void;
    jest
      .spyOn(require("../src/components/permissions"), "default")
      .mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            grant = resolve;
          })
      );
    const onStart = jest.fn();
    const state = (value: "active" | "background") => {
      AppState.currentState = value;
      [...listeners].forEach((listener) => listener(value));
    };
    try {
      await act(async () => {
        screen = Renderer.create(
          <SongRecorder songId={1} active open onStart={onStart} />
        );
      });
      await act(async () => {
        screen!.root
          .find(
            (node) =>
              node.props.accessibilityLabel === "StartRecording" &&
              typeof node.props.onPress === "function"
          )
          .props.onPress();
      });
      await act(async () => state("background"));
      await act(async () => grant(true));
      expect(performanceAudio.start).not.toHaveBeenCalled();
      if (leave)
        await act(async () => {
          screen!.update(
            <SongRecorder songId={1} active={false} onStart={onStart} />
          );
        });
      await act(async () => state("active"));
      expect(performanceAudio.start).toHaveBeenCalledTimes(leave ? 0 : 1);
      expect(onStart).toHaveBeenCalledTimes(leave ? 0 : 1);
    } finally {
      AppState.currentState = previous;
    }
  }
);

test.each(["return", "song"])(
  "cancelled native recording startup cannot resume after a navigation change: %s",
  async (change) => {
    const previous = AppState.currentState;
    AppState.currentState = "active";
    jest.mocked(performanceAudio.list).mockResolvedValue([]);
    jest.mocked(performanceAudio.stop).mockResolvedValue(null);
    jest
      .spyOn(require("../src/components/permissions"), "default")
      .mockResolvedValue(true);
    let finish!: (path: string) => void;
    jest.mocked(performanceAudio.start).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const onStart = jest.fn();
    try {
      await act(async () => {
        screen = Renderer.create(
          <SongRecorder songId={1} active open onStart={onStart} />
        );
      });
      await act(async () => {
        screen!.root
          .find(
            (node) =>
              node.props.accessibilityLabel === "StartRecording" &&
              typeof node.props.onPress === "function"
          )
          .props.onPress();
      });
      expect(performanceAudio.start).toHaveBeenCalledWith(1);
      if (change === "return")
        await act(async () =>
          screen!.update(
            <SongRecorder songId={1} active={false} onStart={onStart} />
          )
        );
      await act(async () =>
        screen!.update(
          <SongRecorder
            songId={change === "song" ? 2 : 1}
            active
            onStart={onStart}
          />
        )
      );
      await act(async () => finish("/performances/song-1-123.m4a"));
      expect(onStart).not.toHaveBeenCalled();
      expect(performanceAudio.stop).toHaveBeenCalledTimes(1);
      expect(
        screen!.root
          .findAllByType(Action)
          .some((node) => node.props.accessibilityLabel === "StopRecording")
      ).toBe(false);
    } finally {
      AppState.currentState = previous;
    }
  }
);

test("unsupported song chord explains and disables rhythm auditions", async () => {
  await act(async () => {
    screen = Renderer.create(
      <SongTools
        initialTab="rhythm"
        content={"Am C6/9 G\nWords"}
        value={defaultSongPreferences}
        onChange={() => {}}
        onClose={() => {}}
      />
    );
  });
  const previews = screen!.root
    .findAllByType(Action)
    .filter((node) => String(node.props.label).startsWith("ListenRhythm:"));
  expect(previews).toHaveLength(rhythms.length);
  expect(previews.every((node) => node.props.disabled)).toBe(true);
  expect(
    screen!.root
      .findAllByType(Text)
      .some((node) => JSON.stringify(node.props.children).includes("C6/9"))
  ).toBe(true);
  expect(screen!.root.findAllByType(WebView)).toHaveLength(0);
});

test("ordinary chord rows preserve their order and existing inline markers", () => {
  const {
    transposeSong,
    songChordSequence
  } = require("../src/screens/song/chords");
  expect(transposeSong("C Dm\n Am\nабв", 0)).toBe("C Dm\n Am\nабв");
  expect(songChordSequence(transposeSong("C\nа[Am]б[Dm]в", 0))).toEqual([
    "C",
    "Am",
    "Dm"
  ]);
  const annotated = "C | G | (x2)\nHello there";
  expect(transposeSong(annotated, 2)).toBe("D | A | (x2)\nHello there");
  expect(songChordSequence(transposeSong(annotated, 2))).toEqual(["D", "A"]);
});

test("large consecutive chord blocks are processed once without changing content", () => {
  const { transposeSong } = require("../src/screens/song/chords");
  const content = "C\n".repeat(30000);
  const start = Date.now();
  expect(transposeSong(content, 0)).toBe(content);
  expect(Date.now() - start).toBeLessThan(2000);
});

test("only editor-origin rows fold after line insertion and intermediate invalid chord edits", () => {
  const {
    createSongEditorState,
    songContentFromEditor,
    songChordSequence
  } = require("../src/screens/song/chords");
  let content = "[C]а[Am]б[Dm]в\nAm C\nF G\nHello world";
  const state = createSongEditorState(content);
  let draft = "Header\n" + state.text;
  content = songContentFromEditor(content, draft, state);
  draft = draft.replace("C Dm", "Dma Dm");
  content = songContentFromEditor(content, draft, state);
  draft = draft.replace("Dma Dm", "D Dm");
  content = songContentFromEditor(content, draft, state);
  expect(content).toContain("[D]а[Am]б[Dm]в");
  expect(content).toContain("Am C\nF G\nHello world");
  expect(songChordSequence(content)).toEqual([
    "D",
    "Am",
    "Dm",
    "Am",
    "C",
    "F",
    "G"
  ]);
});

test.each([
  [2, ["1", "&"]],
  [3, ["1", "&", "a"]],
  [4, ["1", "e", "&", "a"]]
] as const)(
  "live rhythm counter follows division %s",
  async (division, expected) => {
    jest.useFakeTimers();
    const previousState = AppState.currentState;
    AppState.currentState = "active";
    try {
      await act(async () => {
        screen = Renderer.create(
          <SongTools
            initialTab="rhythm"
            content={"Am\nWords"}
            value={defaultSongPreferences}
            onChange={() => {}}
            onClose={() => {}}
          />
        );
      });
      const source = screen!.root.findByType(WebView).props.source.html;
      const tick = source.slice(
        source.indexOf("function tick(){"),
        source.indexOf("function prepareAudio(){")
      );
      const table = source.match(/const beatCounts=.*?;/)?.[0] ?? "";
      const counts: string[] = [];
      const count = { textContent: "" };
      const context = { currentTime: 0 };
      const vm = require("node:vm");
      const runtime = vm.createContext({
        playing: true,
        context,
        practice: false,
        start: 0,
        next: 0,
        tempo: 60,
        meter: 4,
        division,
        pattern: "-",
        step: 0,
        chords: ["Am"],
        singleStroke: false,
        activeFingering: 0,
        lastChord: -1,
        arrangements: [],
        bar: 0,
        slot: 0,
        patternStep: 0,
        planKey: "",
        scheduled: [],
        count,
        timer: 0,
        setTimeout: () => 1,
        labels: {}
      });
      vm.runInContext(table + tick + "tick();", runtime);
      for (let position = 0; position < division; position++) {
        context.currentTime = (position + 0.01) / division;
        vm.runInContext("tick();", runtime);
        counts.push(count.textContent.split(" · ")[1]);
      }
      expect(counts).toEqual(expected);
    } finally {
      AppState.currentState = previousState;
    }
  }
);

test.each([16, 32])(
  "long chord and lyric rows share horizontal scrolling at font size %s",
  async (fontSize) => {
    jest.useFakeTimers();
    const { usePreferences } = require("../src/components/preferences");
    usePreferences
      .getState()
      .updateSong(1, { fontSize, transpose: 0, capo: 0 });
    jest.mocked(crud.getAllItems).mockResolvedValue([
      {
        id: 1,
        title: "Long line",
        content:
          "[Am]Сегодня я иду домой и напеваю эту длинную строчку, чтобы [G]услышать аккорд именно над этим словом в конце песни"
      }
    ]);
    await act(async () => {
      screen = Renderer.create(<Song />);
    });
    const pairs = screen!.root
      .findAllByType(ScrollView)
      .filter((node) => node.props.horizontal);
    expect(pairs).toHaveLength(1);
    const rows = pairs[0]
      .findAllByType(Text)
      .filter((node) => node.props.numberOfLines === 1);
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          require("react-native").StyleSheet.flatten(row.props.style)
            .fontSize === fontSize
      )
    ).toBe(true);
    const text = rows.map((row) =>
      row.props.children[0]
        .map((part: string | React.ReactElement<{ children: string }>) =>
          typeof part === "string" ? part : part.props.children
        )
        .join("")
    );
    expect(text[0].indexOf("G")).toBe(text[1].indexOf("услышать"));
    expect(text[1]).toContain("аккорд именно над этим словом в конце песни");
  }
);

test("known editor-origin lyric Am remains text in song view", async () => {
  jest.useFakeTimers();
  require("../src/components/preferences")
    .usePreferences.getState()
    .updateSong(1, { transpose: 0, capo: 0 });
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValue([
      { id: 1, title: "Text", content: "[C]A[Am]m\nNext line" }
    ]);
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  expect(
    screen!.root
      .findAllByType(Text)
      .filter((node) => node.props.accessibilityLabel === "Am, Fingering")
  ).toHaveLength(1);
  expect(
    screen!.root
      .findAllByType(Text)
      .some(
        (node) =>
          node.props.numberOfLines === 1 &&
          node.props.children[0].join("") === "Am" &&
          !node.props.onPress
      )
  ).toBe(true);
});

test("known editor chord rows retain musical order when their lyric is cleared", () => {
  const {
    createSongEditorState,
    songContentFromEditor,
    songChordSequence
  } = require("../src/screens/song/chords");
  const source = "[C]а[Am]б[Dm]в";
  const state = createSongEditorState(source);
  const result = songContentFromEditor(
    source,
    state.text.replace(/абв$/, ""),
    state
  );
  expect(songChordSequence(result)).toEqual(["C", "Am", "Dm"]);
});

test.each(["[C]Am", "A[C]m", "[C]Am[Dm]", "[C]Am [G]Dm"])(
  "all explicit inline lyrics retain their identity across transpose and editor round trips: %s",
  (source) => {
    const {
      createSongEditorState,
      songContentFromEditor,
      songChordSequence,
      transposeSong,
      transposeChord
    } = require("../src/screens/song/chords");
    for (const shift of [-2, 0, 2]) {
      const content = transposeSong(source, shift);
      expect(content.replace(/\[[^\]]+\]/g, "")).toBe(
        source.replace(/\[[^\]]+\]/g, "")
      );
      const expected = songChordSequence(source).map((chord: string) =>
        transposeChord(chord, shift)
      );
      expect(songChordSequence(content)).toEqual(expected);
      const state = createSongEditorState(content);
      expect(state.groups).toHaveLength(1);
      const saved = songContentFromEditor(
        content,
        state.text + "\nWords!",
        state
      );
      expect(saved).toBe(content + "\nWords!");
      expect(songChordSequence(saved)).toEqual(expected);
      expect(transposeSong(saved, 0)).toBe(saved);
    }
  }
);

test("a delayed recording list from the previous song cannot replace current takes", async () => {
  const current = {
    path: "/performances/song-2-456.m4a",
    date: 456,
    bytes: 1000
  };
  let finish!: (takes: (typeof current)[]) => void;
  jest.mocked(performanceAudio.list).mockImplementation((id) =>
    id === 1
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve([current])
  );
  const onStart = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <SongRecorder songId={1} active open onStart={onStart} />
    );
  });
  await act(async () =>
    screen!.update(<SongRecorder songId={2} active open onStart={onStart} />)
  );
  await act(async () =>
    finish([{ ...current, path: "/performances/song-1-123.m4a" }])
  );
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.accessibilityLabel === "ListenTake")!
      .props.onPress()
  );
  expect(performanceAudio.play).toHaveBeenCalledWith(current.path);
});

test.each(["screen", "background"])(
  "leaving and returning during playback startup cannot revive a stopped take: %s",
  async (leave) => {
    const previousState = AppState.currentState;
    AppState.currentState = "active";
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest
      .mocked(AppState.addEventListener)
      .mockImplementation((_event, listener) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      });
    const take = {
      path: "/performances/song-1-123.m4a",
      date: 123,
      bytes: 1000
    };
    jest.mocked(performanceAudio.list).mockResolvedValue([take]);
    let finish!: (duration: number) => void;
    jest.mocked(performanceAudio.play).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const onStart = jest.fn();
    await act(async () => {
      screen = Renderer.create(
        <SongRecorder songId={1} active open onStart={onStart} />
      );
    });
    await act(async () => {
      screen!.root
        .findAllByType(Action)
        .find((node) => node.props.accessibilityLabel === "ListenTake")!
        .props.onPress();
    });
    if (leave === "screen") {
      await act(async () =>
        screen!.update(
          <SongRecorder songId={1} active={false} onStart={onStart} />
        )
      );
      await act(async () =>
        screen!.update(<SongRecorder songId={1} active onStart={onStart} />)
      );
    } else {
      for (const state of ["background", "active"] as const) {
        await act(async () => {
          AppState.currentState = state;
          [...listeners].forEach((listener) => listener(state));
        });
      }
    }
    // Stop is issued when ownership is lost, before the native reply. A
    // delayed reply must not stop audio that may now belong to another screen.
    expect(performanceAudio.stopPlayback).toHaveBeenCalled();
    jest.mocked(performanceAudio.stopPlayback).mockClear();
    await act(async () => finish(20000));
    expect(performanceAudio.stopPlayback).not.toHaveBeenCalled();
    await act(async () =>
      screen!.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RecordPerformance")!
        .props.onPress()
    );
    expect(
      screen!.root
        .findAllByType(Action)
        .some((node) => node.props.accessibilityLabel === "StopPlayback")
    ).toBe(false);
    AppState.currentState = previousState;
  }
);

test.each([false, true])(
  "late recording list cannot reopen after deactivation, reactivated=%s",
  async (reactivate) => {
    let finish!: (takes: []) => void;
    jest.mocked(performanceAudio.list).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const onStart = jest.fn();
    await act(async () => {
      screen = Renderer.create(
        <SongRecorder songId={1} active onStart={onStart} />
      );
    });
    await act(async () =>
      screen!.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RecordPerformance")!
        .props.onPress()
    );
    await act(async () =>
      screen!.update(
        <SongRecorder songId={1} active={false} onStart={onStart} />
      )
    );
    if (reactivate)
      await act(async () =>
        screen!.update(<SongRecorder songId={1} active onStart={onStart} />)
      );
    await act(async () => finish([]));
    expect(
      screen!.root.findAllByType(require("../src/screens/song/tools").Sheet)
    ).toHaveLength(0);
  }
);

test("a closed fingering sheet does not prepare an audio bank or mount a WebView", async () => {
  jest.useFakeTimers();
  const previous = AppState.currentState;
  AppState.currentState = "active";
  jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
  jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
  const bank = jest.spyOn(acousticPlayer, "acousticBank");
  const onChange = jest.fn();
  const onClose = jest.fn();
  try {
    await act(async () => {
      screen = Renderer.create(
        <ChordSheet
          chord="Am"
          visible={false}
          onChange={onChange}
          onClose={onClose}
        />
      );
    });
    await act(async () => jest.advanceTimersByTime(100));
    expect(bank).not.toHaveBeenCalled();
    expect(performanceAudio.prepareFingering).not.toHaveBeenCalled();
    expect(screen!.root.findAllByType(WebView)).toHaveLength(0);
    await act(async () =>
      screen!.update(
        <ChordSheet chord="Am" onChange={onChange} onClose={onClose} />
      )
    );
    expect(screen!.root.findAllByType(WebView)).toHaveLength(1);
    await act(async () =>
      screen!.update(
        <ChordSheet
          chord="Am"
          visible={false}
          onChange={onChange}
          onClose={onClose}
        />
      )
    );
    await act(async () => jest.advanceTimersByTime(100));
    expect(bank).not.toHaveBeenCalled();
    expect(screen!.root.findAllByType(WebView)).toHaveLength(0);
  } finally {
    AppState.currentState = previous;
  }
});

test("backgrounded rhythm controls defer bank preparation until the app is active", async () => {
  jest.useFakeTimers();
  const previous = AppState.currentState;
  AppState.currentState = "background";
  const prepare = jest.spyOn(acousticInstrument, "prepareAcousticInstrument");
  try {
    await act(async () => {
      screen = Renderer.create(
        <ChordSheet chord="Am" onChange={() => {}} onClose={() => {}} />
      );
    });
    await act(async () => jest.advanceTimersByTime(100));
    expect(prepare).not.toHaveBeenCalled();
    expect(screen!.root.findAllByType(WebView)).toHaveLength(0);
    await act(async () => {
      AppState.currentState = "active";
      jest
        .mocked(AppState.addEventListener)
        .mock.calls.forEach(([, listener]) => listener("active"));
    });
    await act(async () => jest.runAllTimersAsync());
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(screen!.root.findAllByType(WebView)).toHaveLength(1);
  } finally {
    AppState.currentState = previous;
  }
});

test("a large recording library mounts a bounded visible list and retains all takes", async () => {
  const takes = Array.from({ length: 500 }, (_, index) => ({
    path: `/performances/song-1-${index}.m4a`,
    date: index,
    bytes: 1000
  }));
  jest.mocked(performanceAudio.list).mockResolvedValue(takes);
  await act(async () => {
    screen = Renderer.create(
      <SongRecorder songId={1} active open browseOnly onStart={() => {}} />
    );
  });
  const list = screen!.root.findByType(FlatList);
  expect(list.props.data).toEqual(takes);
  const visible = screen!.root
    .findAllByType(Action)
    .filter((node) => node.props.accessibilityLabel === "ListenTake");
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.length).toBeLessThanOrEqual(12);
  expect(
    screen!.root.findByType(require("../src/screens/song/tools").Sheet).props
      .scrollable
  ).toBe(false);
});

test.each(["close", "background", "change"] as const)(
  "obsolete rhythm preparation is canceled after %s and never reaches the WebView",
  async (leave) => {
    jest.useFakeTimers();
    const previous = AppState.currentState;
    AppState.currentState = "active";
    jest.replaceProperty(performanceAudio, "preparedFingeringSupported", false);
    const requests: {
      signal: AbortSignal;
      chords: string[];
      finish: (chunks: string[]) => void;
    }[] = [];
    jest
      .spyOn(acousticInstrument, "prepareAcousticInstrument")
      .mockImplementation(
        (spec, signal) =>
          new Promise((resolve) => {
            requests.push({ signal, chords: spec.chords, finish: resolve });
          })
      );
    const injectJavaScript = jest.fn();
    const onChange = jest.fn();
    const onClose = jest.fn();
    try {
      await act(async () => {
        screen = Renderer.create(
          <ChordSheet chord="Am" onChange={onChange} onClose={onClose} />,
          { createNodeMock: () => ({ injectJavaScript }) }
        );
      });
      await act(async () =>
        screen!.root.findByType(WebView).props.onMessage({
          nativeEvent: { data: "ready" }
        })
      );
      expect(requests).toHaveLength(1);
      const first = requests[0];
      if (leave === "background") {
        await act(async () => {
          AppState.currentState = "background";
          jest
            .mocked(AppState.addEventListener)
            .mock.calls.forEach(([, listener]) => listener("background"));
        });
      } else {
        await act(async () =>
          screen!.update(
            <ChordSheet
              chord={leave === "change" ? "C" : "Am"}
              visible={leave !== "close"}
              onChange={onChange}
              onClose={onClose}
            />
          )
        );
      }
      expect(first.signal.aborted).toBe(true);
      await act(async () => first.finish(['{"chords":["obsolete"]}']));
      await act(async () => jest.runAllTimersAsync());
      expect(
        injectJavaScript.mock.calls.some(([script]) =>
          script.startsWith("window.beginInstrument(")
        )
      ).toBe(false);
      if (leave === "change") {
        const latest = requests.at(-1)!;
        expect(latest.chords).toEqual(["C"]);
        expect(latest.signal.aborted).toBe(false);
        await act(async () =>
          latest.finish([JSON.stringify({ chords: latest.chords })])
        );
        await act(async () => jest.runAllTimersAsync());
        const chunks: string[] = [];
        let received: unknown;
        const receiver = {
          beginInstrument: () => {
            chunks.length = 0;
          },
          appendInstrument: (_token: number, chunk: string) =>
            chunks.push(chunk),
          finishInstrument: () => {
            received = JSON.parse(chunks.join(""));
          }
        };
        for (const [script] of injectJavaScript.mock.calls) {
          if (
            /^window\.(beginInstrument|appendInstrument|finishInstrument)\(/.test(
              script
            )
          )
            require("node:vm").runInNewContext(script, { window: receiver });
        }
        expect(received).toEqual({ chords: ["C"] });
      }
    } finally {
      AppState.currentState = previous;
    }
  }
);
