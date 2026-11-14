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
  Platform
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

test("long chord labels keep subsequent chords aligned with their lyric words", () => {
  const output = chordsAboveLyrics("[Cmaj7]I [D]go");
  const [chords, words] = output.split("\n");
  expect(chords.indexOf("D")).toBe(words.indexOf("go"));
  expect(words.replace(/ +/g, " ")).toBe("I go");
  expect(chordsAboveLyrics(output)).toBe(output);
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
    jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]("active")
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

test("opening song tools mounts the controls before preparing the audio bank", async () => {
  jest.useFakeTimers();
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
  await act(async () => jest.advanceTimersByTime(32));
  expect(bank).toHaveBeenCalledTimes(1);
});
test("each rhythm can be selected once through its full pattern and applied", async () => {
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
    expect(change).not.toHaveBeenCalled();
    const configuration = injectJavaScript.mock.calls.at(-1)![0];
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
  const initialization = injectJavaScript.mock.calls.find(([script]) =>
    script.startsWith("window.loadInstrument(")
  )![0];
  const load = window.loadInstrument;
  window.loadInstrument = (data: any) => {
    data.bank.recordings = [];
    return load(data);
  };
  require("node:vm").runInNewContext(initialization.split(";")[0], { window });
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
  const sampleCount = (decoded.length - 1) / 2;
  expect(sampleCount).toBeGreaterThanOrEqual(4);
  const down = sources.slice(0, sampleCount);
  const up = sources.slice(sampleCount, sampleCount + 3);
  const medium = decoded.filter((_, index) => index > 0 && index % 2 === 0);
  const soft = decoded.filter((_, index) => index % 2 === 1);
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
test("processing recordings cannot be played or exported until the saved event", async () => {
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
    .mockResolvedValue([{ ...take, processing: false }]);
  await act(async () => listener({ state: "saved", uri: take.path }));
  expect(controls().every((node) => !node.props.disabled)).toBe(true);
});
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
    jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]("active")
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
