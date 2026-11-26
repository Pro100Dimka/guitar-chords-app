import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, AppState, FlatList, Text, type AppStateStatus } from "react-native";
import { Action, ChordSheet, SongTools } from "../src/screens/song/tools";
import { WebView } from "react-native-webview";
import SongRecorder from "../src/screens/song/recorder";
import { defaultSongPreferences } from "../src/components/preferences";
import * as acousticPlayer from "../src/components/acoustic-player";
import * as acousticInstrument from "../src/components/acoustic-instrument";
import * as chordTools from "../src/screens/song/chords";
import {
  performanceAudio,
  type PerformanceEvent
} from "../src/components/performance-audio";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: String, i18n: { language: "en" } })
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

let screen: Renderer.ReactTestRenderer | undefined;
let previousState: AppStateStatus;
const appListeners = new Set<(state: AppStateStatus) => void>();

beforeEach(() => {
  previousState = AppState.currentState;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    appListeners.add(listener);
    return { remove: () => appListeners.delete(listener) };
  });
  jest
    .spyOn(acousticInstrument, "prepareAcousticInstrument")
    .mockResolvedValue(undefined);
});

afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  AppState.currentState = previousState;
  appListeners.clear();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const content = Array.from(
  { length: 160 },
  (_, index) => `[Am]Line ${index} [C]words [G]more [Em]words`
).join("\n");
const settings = { ...defaultSongPreferences, strum: "D-D-D-D-" };
const onChange = jest.fn();
const onClose = jest.fn();

test("rhythm preparation resolves each distinct voicing once and preserves the full progression", async () => {
  const selectedShape = acousticPlayer.selectedChordShape;
  const select = jest.spyOn(acousticPlayer, "selectedChordShape");
  await act(async () => {
    screen = Renderer.create(
      <SongTools
        initialTab="rhythm"
        content={content}
        value={settings}
        onChange={onChange}
        onClose={onClose}
      />
    );
  });
  // One availability check and one frequency resolution per distinct chord.
  expect(select).toHaveBeenCalledTimes(8);
  const instrument = jest.mocked(acousticInstrument.prepareAcousticInstrument)
    .mock.calls[0][0];
  const expected = chordTools.songChordSequence(content);
  expect(instrument.chords).toEqual(expected);
  expect(instrument.frequencies).toHaveLength(expected.length);
  const voicings = new Map(
    [...new Set(expected)].map((chord) => [
      chord,
      selectedShape(chord)!.frets.flatMap((fret, string) =>
        fret === null
          ? []
          : [
              {
                string,
                frequency:
                  440 * 2 ** ((chordTools.guitarMidi[string] + fret - 69) / 12)
              }
            ]
      )
    ])
  );
  expect(instrument.frequencies).toEqual(
    expected.map((chord) => voicings.get(chord))
  );
});

test("tempo and rhythm editor controls reuse score parsing and voicing checks", async () => {
  const parse = jest.spyOn(chordTools, "songChordSequence");
  const transpose = jest.spyOn(chordTools, "transposeChord");
  const select = jest.spyOn(acousticPlayer, "selectedChordShape");
  const render = (value = settings, source = content) => (
    <SongTools
      initialTab="rhythm"
      content={source}
      value={value}
      onChange={onChange}
      onClose={onClose}
    />
  );
  await act(async () => {
    screen = Renderer.create(render());
  });
  expect(parse).toHaveBeenCalled();
  parse.mockClear();
  transpose.mockClear();
  select.mockClear();
  jest.mocked(acousticInstrument.prepareAcousticInstrument).mockClear();
  await act(async () => screen!.update(render({ ...settings, tempo: 120 })));
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "EditRhythm")!
      .props.onPress()
  );
  expect(parse.mock.calls.length).toBe(0);
  expect(transpose.mock.calls.length).toBe(0);
  expect(select.mock.calls.length).toBe(0);
  expect(acousticInstrument.prepareAcousticInstrument).not.toHaveBeenCalled();
  await act(async () =>
    screen!.update(render({ ...settings, shapes: { Fm: 3 } }))
  );
  expect(acousticInstrument.prepareAcousticInstrument).not.toHaveBeenCalled();
  await act(async () => screen!.update(render(settings, "[Dm]New [G]words")));
  expect(parse).toHaveBeenCalled();
  expect(
    jest
      .mocked(acousticInstrument.prepareAcousticInstrument)
      .mock.calls.at(-1)![0].chords
  ).toEqual(["Dm", "G"]);
});

test("practice tempo and start-chord controls reuse parsed section progressions", async () => {
  const parse = jest.spyOn(chordTools, "songChordSequence");
  const sections = jest.spyOn(chordTools, "songSections");
  const render = (tempo: number) => (
    <SongTools
      content={content}
      value={{ ...settings, tempo }}
      onChange={onChange}
      onClose={onClose}
    />
  );
  await act(async () => {
    screen = Renderer.create(render(80));
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
  expect(parse).toHaveBeenCalled();
  parse.mockClear();
  sections.mockClear();
  await act(async () => screen!.update(render(120)));
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "C")!
      .props.onPress()
  );
  expect(parse.mock.calls.length).toBe(0);
  expect(sections.mock.calls.length).toBe(0);
  const instrument = jest
    .mocked(acousticInstrument.prepareAcousticInstrument)
    .mock.calls.at(-1)![0];
  expect(instrument.chords.slice(0, 5)).toEqual(["C", "G", "Em", "Am", "C"]);
});

test("inactive recorders never stop audio owned by another screen", async () => {
  await act(async () => {
    screen = Renderer.create(
      <SongRecorder songId={1} active={false} onStart={() => {}} />
    );
  });
  await act(async () => {
    AppState.currentState = "background";
    appListeners.forEach((callback) => callback("background"));
  });
  await act(async () => screen!.unmount());
  screen = undefined;
  expect(performanceAudio.stopPlayback).not.toHaveBeenCalled();
});

test("recording events are scoped to the active song without duplicate alerts", async () => {
  const listeners = new Set<(event: PerformanceEvent) => void>();
  jest.spyOn(performanceAudio, "listen").mockImplementation((listener) => {
    listeners.add(listener);
    return {
      remove: () => { listeners.delete(listener); }
    } as unknown as ReturnType<typeof performanceAudio.listen>;
  });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await act(async () => {
    screen = Renderer.create(
      <>
        <SongRecorder songId={1} active onStart={() => {}} />
        <SongRecorder songId={2} active={false} onStart={() => {}} />
      </>
    );
  });
  await act(async () => {
    listeners.forEach((listener) =>
      listener({ state: "processingFailed", uri: "/song-2-10.m4a" })
    );
  });
  expect(alert).not.toHaveBeenCalled();
  await act(async () => {
    listeners.forEach((listener) =>
      listener({ state: "processingFailed", uri: "/song-1-10.m4a" })
    );
  });
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith("RecordingPolishFailed");
});

test("a stale recording-list failure never displays an error for the next song", async () => {
  let fail!: (error: Error) => void;
  const take = { path: "/song-2-10.m4a", date: 10, bytes: 100 };
  jest
    .mocked(performanceAudio.list)
    .mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }))
    .mockResolvedValue([take]);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const render = (songId: number) => (
    <SongRecorder songId={songId} active open onStart={() => {}} />
  );
  await act(async () => {
    screen = Renderer.create(render(1));
  });
  await act(async () => screen!.update(render(2)));
  await act(async () => fail(new Error("Old request failed")));
  expect(alert).not.toHaveBeenCalled();
  expect(screen!.root.findByType(FlatList).props.data).toEqual([take]);
});

test("hidden recording lists do not rescan files for global processing events", async () => {
  const listeners = new Set<(event: PerformanceEvent) => void>();
  const subscription = performanceAudio.listen(() => {});
  jest.spyOn(performanceAudio, "listen").mockImplementation((listener) => {
    listeners.add(listener);
    return subscription;
  });
  const take = { path: "/song-1-10.m4a", date: 10, bytes: 100 };
  jest.mocked(performanceAudio.list).mockResolvedValue([take]);
  await act(async () => {
    screen = Renderer.create(
      <>
        <SongRecorder songId={1} active onStart={() => {}} />
        <SongRecorder songId={2} active={false} onStart={() => {}} />
      </>
    );
  });
  await act(async () => {
    for (const state of ["processing", "saved"] as const)
      listeners.forEach((listener) => listener({ state, uri: take.path }));
  });
  expect(performanceAudio.list).not.toHaveBeenCalled();
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find(
        (node) =>
          node.props.label === "RecordPerformance" && !node.props.disabled
      )!
      .props.onPress()
  );
  expect(performanceAudio.list).toHaveBeenCalledTimes(1);
  expect(screen!.root.findByType(FlatList).props.data).toEqual([take]);
});

test("backgrounded recording lists refresh once with the latest files on return", async () => {
  let listener!: (event: PerformanceEvent) => void;
  const subscription = performanceAudio.listen(() => {});
  jest.spyOn(performanceAudio, "listen").mockImplementation((callback) => {
    listener = callback;
    return subscription;
  });
  const take = {
    path: "/song-1-10.m4a",
    date: 10,
    bytes: 100,
    processing: true
  };
  jest.mocked(performanceAudio.list).mockResolvedValue([take]);
  await act(async () => {
    screen = Renderer.create(
      <SongRecorder songId={1} active open onStart={() => {}} />
    );
  });
  jest.mocked(performanceAudio.list).mockClear();
  await act(async () => {
    AppState.currentState = "background";
    appListeners.forEach((callback) => callback("background"));
  });
  const saved = { ...take, processing: false };
  jest.mocked(performanceAudio.list).mockResolvedValue([saved]);
  await act(async () => {
    listener({ state: "processing", uri: take.path });
    listener({ state: "saved", uri: take.path });
  });
  expect(performanceAudio.list).not.toHaveBeenCalled();
  await act(async () => {
    AppState.currentState = "active";
    appListeners.forEach((callback) => callback("active"));
  });
  expect(performanceAudio.list).toHaveBeenCalledTimes(1);
  expect(screen!.root.findByType(FlatList).props.data).toEqual([saved]);
});

test("a recording finalized while its list is opening refreshes after the sheet becomes visible", async () => {
  let listener!: (event: PerformanceEvent) => void;
  const subscription = performanceAudio.listen(() => {});
  jest.spyOn(performanceAudio, "listen").mockImplementation((callback) => {
    listener = callback;
    return subscription;
  });
  const take = {
    path: "/song-1-10.m4a",
    date: 10,
    bytes: 100,
    processing: true
  };
  const saved = { ...take, processing: false };
  let finish!: (takes: (typeof take)[]) => void;
  jest
    .mocked(performanceAudio.list)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue([saved]);
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
  await act(async () => listener({ state: "saved", uri: take.path }));
  expect(performanceAudio.list).toHaveBeenCalledTimes(1);
  await act(async () => finish([take]));
  expect(performanceAudio.list).toHaveBeenCalledTimes(2);
  expect(screen!.root.findByType(FlatList).props.data).toEqual([saved]);
});

test.each([false, true])(
  "fingering taps upload the retained waveform only after native eviction: %s",
  async (evicted) => {
    jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
    const cached = new Set<string>();
    jest
      .mocked(performanceAudio.prepareFingering)
      .mockImplementation(async (key, wave) => {
        if (wave) cached.add(key);
        return cached.has(key);
      });
    await act(async () => {
      screen = Renderer.create(
        <ChordSheet chord="Am" onChange={onChange} onClose={onClose} />
      );
    });
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
    const wave = "A".repeat(512000);
    await act(async () =>
      screen!.root.findByType(WebView).props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: "fingering", key, wave }) }
      })
    );
    if (evicted) cached.clear();
    jest.mocked(performanceAudio.prepareFingering).mockClear();
    await act(async () => card.props.onPressIn());
    expect(
      jest
        .mocked(performanceAudio.prepareFingering)
        .mock.calls.map(([, payload]) => payload.length)
    ).toEqual(evicted ? [0, wave.length] : [0]);
    expect(performanceAudio.playPreparedGuitar).toHaveBeenCalledTimes(1);
    expect(performanceAudio.playPreparedGuitar).toHaveBeenCalledWith(key);
  }
);

test("a closed fingering sheet does not upload a waveform after its cache probe completes", async () => {
  jest.replaceProperty(performanceAudio, "preparedFingeringSupported", true);
  jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(true);
  const render = (visible: boolean) => (
    <ChordSheet
      chord="Am"
      visible={visible}
      onChange={onChange}
      onClose={onClose}
    />
  );
  await act(async () => {
    screen = Renderer.create(render(true));
  });
  const card = screen!.root.findAll(
    (node) =>
      typeof node.props.onPressIn === "function" &&
      String(node.props.accessibilityLabel).startsWith("Fingering ")
  )[0];
  const key = jest.mocked(performanceAudio.prepareFingering).mock.calls[0][0];
  await act(async () =>
    screen!.root.findByType(WebView).props.onMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: "fingering",
          key,
          wave: "A".repeat(512000)
        })
      }
    })
  );
  let finish!: (ready: boolean) => void;
  jest
    .mocked(performanceAudio.prepareFingering)
    .mockReset()
    .mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
  await act(async () => card.props.onPressIn());
  await act(async () => screen!.update(render(false)));
  await act(async () => finish(false));
  expect(
    jest
      .mocked(performanceAudio.prepareFingering)
      .mock.calls.map(([, payload]) => payload.length)
  ).toEqual([0]);
  expect(performanceAudio.playPreparedGuitar).not.toHaveBeenCalled();
});
