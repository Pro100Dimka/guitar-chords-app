import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  TextInput,
  TouchableOpacity,
  FlatList,
  Text,
  AppState
} from "react-native";
import Select from "../src/components/fields/api-select";
import Song from "../src/screens/song";
import Editor from "../src/screens/create-song-chords";
import Menu from "../src/screens/song/header-modal";
import SongRecorder from "../src/screens/song/recorder";
import { Action, SongTools, RhythmGrid } from "../src/screens/song/tools";
import { defaultSongPreferences } from "../src/components/preferences";
import { WebView } from "react-native-webview";
import { rhythms } from "../src/screens/song/rhythms";
import {
  performanceAudio,
  PerformanceEvent
} from "../src/components/performance-audio";
import * as crud from "../src/components/database/crud";
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
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("@react-navigation/native", () => ({
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
let screen: Renderer.ReactTestRenderer | undefined;
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
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.resetAllMocks();
  jest.restoreAllMocks();
  jest.useRealTimers();
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
      .filter(
        (node) => node.props.icon === "play" || node.props.icon === "pause"
      );
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
      `"pattern":${JSON.stringify(rhythms[index].pattern.padEnd(Math.ceil(rhythms[index].pattern.length / (rhythms[index].meter * 2)) * rhythms[index].meter * 2, "-"))}`
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
      const buffer = {};
      decoded.push(buffer);
      return Promise.resolve(buffer);
    },
    createGain: () => ({ ...connect(), gain: parameter() }),
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
  window.configurePlayer({
    pattern: "DU",
    meter: 4,
    tempo: 120,
    requested: true,
    practice: false
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  clock = 1;
  schedule();
  expect(sources.slice(0, 4).map((voice) => voice.buffer)).toEqual([
    decoded[0],
    decoded[3],
    decoded[1],
    decoded[4]
  ]);
  const previous = sources.slice();
  window.configurePlayer({
    pattern: "U-D-",
    meter: 4,
    tempo: 80,
    requested: true,
    practice: false
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(AudioContext).toHaveBeenCalledTimes(1);
  expect(decoded).toHaveLength(6);
  expect(previous.every((voice) => voice.stop.mock.calls.length)).toBe(true);
  expect(sources[previous.length].buffer).toBe(decoded[3]);
  window.configurePlayer({
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
