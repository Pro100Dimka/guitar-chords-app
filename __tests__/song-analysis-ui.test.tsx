import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  TextInput
} from "react-native";
import { pick } from "@react-native-documents/picker";
import { FileSystem } from "react-native-file-access";
import { db } from "../src/components/database";
import bundledService from "../src/config/analysis-service.json";
import {
  AudioSong,
  createAudioSong,
  getAnalysisJob,
  getAudioSong,
  listAudioFileNames,
  saveManualAnalysis
} from "../src/components/database/audio-analysis";
import {
  defaultSongPreferences,
  usePreferences
} from "../src/components/preferences";
import { songAudio, SongAudioState } from "../src/components/song-audio";
import {
  loadAnalysisSettings,
  inspectAnalysisService,
  analysisIsRunning,
  analysisNetworkStatus,
  startSongAnalysis
} from "../src/components/song-analysis/client";
import AnalysisSettingsSheet from "../src/screens/song/analysis-settings";
import AnalysisEditor from "../src/screens/song/analysis-editor";
import AudioSongScreen from "../src/screens/song/audio-song";
import AudioImport from "../src/screens/library/audio-import";
import { Action } from "../src/screens/song/tools";
import Text from "../src/components/styled-text";
import styles from "../src/screens/song/audio-styles";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  deleteItem: jest.fn(),
  getAllItems: jest.fn()
}));
jest.mock("../src/components/database/audio-analysis", () => ({
  getAudioSong: jest.fn(),
  getAnalysisJob: jest.fn(),
  acceptGeneratedAnalysis: jest.fn(),
  createAudioSong: jest.fn(),
  listAudioFileNames: jest.fn(),
  saveManualAnalysis: jest.fn()
}));
jest.mock("../src/components/song-analysis/client", () => ({
  ...jest.requireActual("../src/components/song-analysis/client"),
  analysisIsRunning: jest.fn(() => false),
  subscribeAnalysis: jest.fn(() => () => {}),
  cancelSongAnalysis: jest.fn(async () => {}),
  loadAnalysisSettings: jest.fn(),
  inspectAnalysisService: jest.fn(),
  analysisNetworkStatus: jest.fn(() => ({})),
  startSongAnalysis: jest.fn(async () => {})
}));
jest.mock("../src/components/song-audio", () => ({
  songAudio: {
    isSupported: true,
    load: jest.fn(),
    seek: jest.fn(),
    pause: jest.fn(),
    play: jest.fn(),
    getState: jest.fn(),
    setLoop: jest.fn(),
    unload: jest.fn(),
    listen: jest.fn(),
    importAudio: jest.fn(),
    cancelImport: jest.fn()
  }
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { server?: string }) =>
      options?.server ? `${key}: ${options.server}` : key
  })
}));
jest.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
  useNavigation: () => ({ navigate: jest.fn() })
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock(
  "../src/components/header",
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children
);
jest.mock("../src/screens/song/tools", () => {
  const React = require("react");
  const { View, Pressable, Text } = require("react-native");
  return {
    Action: (props: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        Pressable,
        props,
        React.createElement(Text, null, props.label)
      ),
    Sheet: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    ChordSheet: () => null,
    styles: { description: {} }
  };
});

const hash = "a".repeat(64);
const audio = (): AudioSong => ({
  songId: 7,
  sha256: hash,
  fileName: `${hash}.wav`,
  originalName: "Original.wav",
  mimeType: "audio/wav",
  bytes: 10000,
  duration: 30,
  revision: 5,
  manuallyEdited: false,
  generatedAnalysis: null,
  updatedAt: 1,
  analysis: {
    version: 1,
    duration: 30,
    language: "en",
    lyrics: [
      {
        start: 5,
        end: 12,
        text: "Stay here",
        words: [
          { start: 5, end: 8, text: "Stay" },
          { start: 9, end: 12, text: "here" }
        ]
      }
    ],
    chords: [
      { start: 0, end: 10, label: "C" },
      { start: 10, end: 30, label: "Am" }
    ],
    warnings: [],
    model: { lyrics: "test", alignment: "test", chords: "test" }
  }
});
const nativeState = (
  positionMs = 0,
  state: SongAudioState["state"] = "paused"
): SongAudioState => ({
  path: `/documents/FreeTuneAudio/${hash}.wav`,
  state,
  positionMs,
  durationMs: 30000,
  seeking: false,
  loopStartMs: null,
  loopEndMs: null
});
let screen: Renderer.ReactTestRenderer | undefined;
let nativeListener: (state: SongAudioState) => void;
let appListener: (state: AppStateStatus) => void;
const action = (label: string) =>
  screen!.root
    .findAllByType(Action)
    .find((node) => node.props.label === label)!;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  bundledService.url = "";
  jest.mocked(analysisNetworkStatus).mockReturnValue({});
  jest.mocked(inspectAnalysisService).mockResolvedValue({ ready: true });
  songAudio.isSupported = true;
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, callback) => {
      appListener = callback;
      return { remove: jest.fn() };
    });
  jest.mocked(db.transaction).mockImplementation((body, _failure, success) => {
    body({ executeSql: jest.fn() });
    success?.();
  });
  jest.mocked(getAudioSong).mockResolvedValue(audio());
  jest.mocked(getAnalysisJob).mockResolvedValue(null);
  jest.mocked(listAudioFileNames).mockResolvedValue([]);
  jest.mocked(saveManualAnalysis).mockResolvedValue(6);
  jest.mocked(songAudio.listen).mockImplementation((listener) => {
    nativeListener = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(songAudio.load).mockResolvedValue(nativeState());
  jest
    .mocked(songAudio.seek)
    .mockImplementation(async (position) => nativeState(position));
  jest.mocked(songAudio.pause).mockResolvedValue(nativeState(8500));
  jest.mocked(songAudio.play).mockResolvedValue(nativeState(3000, "playing"));
  jest.mocked(songAudio.getState).mockResolvedValue(nativeState(19000));
  jest.mocked(songAudio.setLoop).mockImplementation(async (start, end) => ({
    ...nativeState(12000),
    loopStartMs: start,
    loopEndMs: end
  }));
  jest
    .mocked(songAudio.unload)
    .mockResolvedValue({ ...nativeState(), path: null, state: "idle" });
  jest.mocked(loadAnalysisSettings).mockResolvedValue({
    url: "http://192.168.1.10:8765",
    token: "local-token",
    language: "uk"
  });
  jest.mocked(startSongAnalysis).mockResolvedValue(undefined);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  usePreferences.setState({
    songs: {
      7: { ...defaultSongPreferences, audioPosition: 3, capo: 2, transpose: 2 }
    },
    saveError: false
  });
});
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("audio stays local until the user confirms the exact destination", async () => {
  const close = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <AnalysisSettingsSheet songId={7} onClose={close} />
    );
  });
  await act(async () => action("AnalysisStart").props.onPress());
  expect(startSongAnalysis).not.toHaveBeenCalled();
  const consent = jest
    .mocked(Alert.alert)
    .mock.calls.find(([title]) => title === "AnalysisUploadTitle")!;
  expect(consent[1]).toContain("http://192.168.1.10:8765");
  expect(close).not.toHaveBeenCalled();
  await act(async () =>
    consent[2]!.find((button) => button.text === "AnalysisSend")!.onPress!()
  );
  expect(startSongAnalysis).toHaveBeenCalledWith(7, {
    url: "http://192.168.1.10:8765",
    token: "local-token",
    language: "uk"
  });
});

test("manual line rewrite uses the revision seen when editor opened and explicitly drops old word timing", async () => {
  const initial = audio();
  await act(async () => {
    screen = Renderer.create(
      <AnalysisEditor
        audio={initial}
        selection={{ kind: "lyric", index: 0, position: 5 }}
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />
    );
  });
  await act(async () =>
    screen!.root
      .findAllByType(TextInput)[0]
      .props.onChangeText("New manual lyrics")
  );
  const newer = audio();
  newer.revision = 6;
  newer.analysis!.chords[0].label = "D";
  await act(async () =>
    screen!.update(
      <AnalysisEditor
        audio={newer}
        selection={{ kind: "lyric", index: 0, position: 5 }}
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />
    )
  );
  await act(async () => action("Save").props.onPress());
  expect(saveManualAnalysis).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      lyrics: [
        {
          start: 5,
          end: 12,
          text: "New manual lyrics",
          words: [],
          uncertain: false
        }
      ],
      chords: initial.analysis!.chords
    }),
    5
  );
});

test("word editing keeps neighboring original timings and refuses overlap", async () => {
  await act(async () => {
    screen = Renderer.create(
      <AnalysisEditor
        audio={audio()}
        selection={{ kind: "word", line: 0, index: 0, position: 5 }}
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />
    );
  });
  const fields = screen!.root.findAllByType(TextInput);
  await act(async () => {
    fields[0].props.onChangeText("Remain");
    fields[2].props.onChangeText("9.5");
  });
  await act(async () => action("Save").props.onPress());
  expect(saveManualAnalysis).not.toHaveBeenCalled();
  await act(async () => fields[2].props.onChangeText("8"));
  await act(async () => action("Save").props.onPress());
  const updated = jest.mocked(saveManualAnalysis).mock.calls[0][1];
  expect(updated.lyrics[0].words[1]).toEqual({
    start: 9,
    end: 12,
    text: "here"
  });
  expect(updated.lyrics[0].text).toBe("Remain here");
});

test("moving a line beyond old word timestamps requires explicit confirmation to remove them", async () => {
  const initial = audio();
  await act(async () => {
    screen = Renderer.create(
      <AnalysisEditor
        audio={initial}
        selection={{ kind: "lyric", index: 0, position: 5 }}
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />
    );
  });
  await act(async () =>
    screen!.root.findAllByType(TextInput)[1].props.onChangeText("6")
  );
  await act(async () => action("Save").props.onPress());
  expect(saveManualAnalysis).not.toHaveBeenCalled();
  const warning = jest
    .mocked(Alert.alert)
    .mock.calls.find(([title]) => title === "AnalysisLineTimingTitle")!;
  expect(warning[1]).toBe("AnalysisLineTimingHint");
  expect(warning[2]!.find((button) => button.text === "Cancel")).toBeDefined();
  await act(async () =>
    warning[2]!.find((button) => button.text === "AnalysisDropWordTiming")!
      .onPress!()
  );
  const saved = jest.mocked(saveManualAnalysis).mock.calls[0][1];
  expect(saved.lyrics[0]).toEqual({
    start: 6,
    end: 12,
    text: "Stay here",
    words: [],
    uncertain: false
  });
  expect(saved.chords).toEqual(initial.analysis!.chords);
  expect(initial.analysis!.lyrics[0].words).toHaveLength(2);
});

test("expanding a line interval preserves all original word timing", async () => {
  const initial = audio();
  await act(async () => {
    screen = Renderer.create(
      <AnalysisEditor
        audio={initial}
        selection={{ kind: "lyric", index: 0, position: 5 }}
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />
    );
  });
  await act(async () =>
    screen!.root.findAllByType(TextInput)[1].props.onChangeText("4")
  );
  await act(async () => action("Save").props.onPress());
  expect(Alert.alert).not.toHaveBeenCalled();
  const saved = jest.mocked(saveManualAnalysis).mock.calls[0][1];
  expect(saved.lyrics[0].start).toBe(4);
  expect(saved.lyrics[0].words).toEqual(initial.analysis!.lyrics[0].words);
});

test("an unchanged recognized complex chord permits timing edits but newly unsupported labels are rejected", async () => {
  const initial = audio();
  initial.analysis!.chords[0].label = "C11";
  await act(async () => {
    screen = Renderer.create(
      <AnalysisEditor
        audio={initial}
        selection={{ kind: "chord", index: 0, position: 0 }}
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />
    );
  });
  const fields = screen!.root.findAllByType(TextInput);
  await act(async () => {
    fields[0].props.onChangeText("C:arbitrary-new-quality");
    fields[2].props.onChangeText("9");
  });
  await act(async () => action("Save").props.onPress());
  expect(saveManualAnalysis).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith("AnalysisChordInvalid");
  await act(async () => fields[0].props.onChangeText("C11"));
  await act(async () => action("Save").props.onPress());
  expect(jest.mocked(saveManualAnalysis).mock.calls[0][1].chords).toEqual([
    { start: 0, end: 9, label: "C11", uncertain: false },
    initial.analysis!.chords[1]
  ]);
});

test("complex harmony displays its transposed target without promising an unavailable guitar shape", async () => {
  const initial = audio();
  initial.analysis!.chords[0].label = "C11";
  jest.mocked(getAudioSong).mockResolvedValue(initial);
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Song", content: "" }}
        initialAudio={initial}
      />
    );
  });
  const text = screen!.root
    .findAllByType(Text)
    .map((node) => React.Children.toArray(node.props.children).join(""));
  expect(text).toContain("AnalysisTargetChord: D11");
  expect(text).toContain("AnalysisNoFingering");
  expect(action("AnalysisFingering: C11")).toBeUndefined();
});

test("reopening restores native playback position, highlights only reported words, and keeps capo forms separate", async () => {
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Song", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  expect(songAudio.seek).toHaveBeenCalledWith(3000);
  const styledWords = () =>
    screen!.root
      .findAllByType(Text)
      .filter(
        (node) =>
          Array.isArray(node.props.style) &&
          node.props.style.includes(styles.wordActive)
      );
  await act(async () => nativeListener(nativeState(6500, "playing")));
  expect(
    styledWords().map((node) =>
      React.Children.toArray(node.props.children).join("")
    )
  ).toEqual(["Stay "]);
  await act(async () => nativeListener(nativeState(8500, "paused")));
  expect(styledWords()).toHaveLength(0);
  expect(usePreferences.getState().songs[7].audioPosition).toBe(8.5);
  expect(action("AnalysisFingering: C")).toBeDefined();
  expect(
    screen!.root
      .findAllByType(Text)
      .some(
        (node) =>
          React.Children.toArray(node.props.children).join("") ===
          "AnalysisTargetChord: D"
      )
  ).toBe(true);
  await act(async () => appListener("active"));
  expect(songAudio.getState).toHaveBeenCalled();
  expect(styledWords()).toHaveLength(0);
  const lyricList = screen!.root
    .findAllByType(FlatList)
    .find((node) => !node.props.horizontal)!;
  expect(lyricList.props.data).toHaveLength(1);
});

test("same-file relink actually reloads the decoder instead of leaving a failed native player", async () => {
  jest
    .mocked(songAudio.load)
    .mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "AUDIO_MISSING" })
    )
    .mockResolvedValue(nativeState());
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Song", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  expect(screen!.root.findAllByType(AudioImport)).toHaveLength(1);
  await act(async () =>
    screen!.root.findByType(AudioImport).props.onImported(7)
  );
  expect(songAudio.load).toHaveBeenCalledTimes(2);
  expect(action("Play").props.disabled).toBe(false);
});

test("transient playback errors offer retry without asking to replace the recording", async () => {
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Song", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  await act(async () =>
    nativeListener({ ...nativeState(5000, "error"), error: "AUDIO_PLAYBACK" })
  );
  expect(screen!.root.findAllByType(AudioImport)).toHaveLength(0);
  await act(async () => action("Retry").props.onPress());
  expect(songAudio.load).toHaveBeenCalledTimes(2);
});

test("other platforms can view annotations without calling unsupported native playback", async () => {
  songAudio.isSupported = false;
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Song", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  expect(songAudio.load).not.toHaveBeenCalled();
  expect(action("Play").props.disabled).toBe(true);
  const word = screen!.root
    .findAllByType(Text)
    .find(
      (node) => React.Children.toArray(node.props.children).join("") === "Stay "
    )!;
  expect(word.props.onPress).toBeUndefined();
  expect(songAudio.seek).not.toHaveBeenCalled();
});

test("cancel after native copy prevents navigation and defers stable file cleanup", async () => {
  jest
    .mocked(pick)
    .mockResolvedValue([
      { uri: "content://provider/audio", name: "Original.wav" }
    ] as unknown as Awaited<ReturnType<typeof pick>>);
  let finish!: (
    value: Awaited<ReturnType<typeof songAudio.importAudio>>
  ) => void;
  jest.mocked(songAudio.importAudio).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const imported = jest.fn();
  await act(async () => {
    screen = Renderer.create(<AudioImport onImported={imported} />);
  });
  await act(async () => action("AddAudio").props.onPress());
  await act(async () => action("Cancel").props.onPress());
  await act(async () =>
    finish({
      path: `/documents/FreeTuneAudio/${hash}.wav`,
      uri: `file:///documents/FreeTuneAudio/${hash}.wav`,
      fileName: `${hash}.wav`,
      originalName: "Original.wav",
      mimeType: "audio/wav",
      sha256: hash,
      bytes: 10000,
      durationMs: 30000
    })
  );
  expect(createAudioSong).not.toHaveBeenCalled();
  expect(imported).not.toHaveBeenCalled();
  expect(FileSystem.unlink).not.toHaveBeenCalled();
});

test("cancel while the SQLite commit is in flight preserves committed audio without navigating", async () => {
  jest
    .mocked(pick)
    .mockResolvedValue([
      { uri: "content://provider/audio", name: "Original.wav" }
    ] as unknown as Awaited<ReturnType<typeof pick>>);
  jest.mocked(songAudio.importAudio).mockResolvedValue({
    path: `/documents/FreeTuneAudio/${hash}.wav`,
    uri: `file:///documents/FreeTuneAudio/${hash}.wav`,
    fileName: `${hash}.wav`,
    originalName: "Original.wav",
    mimeType: "audio/wav",
    sha256: hash,
    bytes: 10000,
    durationMs: 30000
  });
  let finish!: (value: { songId: number; created: boolean }) => void;
  jest.mocked(createAudioSong).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const imported = jest.fn();
  await act(async () => {
    screen = Renderer.create(<AudioImport onImported={imported} />);
  });
  await act(async () => action("AddAudio").props.onPress());
  expect(createAudioSong).toHaveBeenCalledTimes(1);
  await act(async () => action("Cancel").props.onPress());
  await act(async () => finish({ songId: 7, created: true }));
  expect(imported).not.toHaveBeenCalled();
  expect(FileSystem.unlink).not.toHaveBeenCalled();
});

test("cancelled import cleanup cannot delete the same file committed by an immediate retry", async () => {
  jest
    .mocked(pick)
    .mockResolvedValue([
      { uri: "content://provider/audio", name: "Original.wav" }
    ] as unknown as Awaited<ReturnType<typeof pick>>);
  const metadata = {
    path: `/documents/FreeTuneAudio/${hash}.wav`,
    uri: `file:///documents/FreeTuneAudio/${hash}.wav`,
    fileName: `${hash}.wav`,
    originalName: "Original.wav",
    mimeType: "audio/wav",
    sha256: hash,
    bytes: 10000,
    durationMs: 30000
  };
  let firstCopy!: (value: typeof metadata) => void;
  let secondCopy!: (value: typeof metadata) => void;
  let oldSnapshot!: (value: string[]) => void;
  jest
    .mocked(songAudio.importAudio)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        firstCopy = resolve;
      })
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        secondCopy = resolve;
      })
    );
  jest.mocked(listAudioFileNames).mockReturnValue(
    new Promise((resolve) => {
      oldSnapshot = resolve;
    })
  );
  jest.mocked(createAudioSong).mockResolvedValue({ songId: 7, created: true });
  const imported = jest.fn();
  await act(async () => {
    screen = Renderer.create(<AudioImport onImported={imported} />);
  });
  await act(async () => action("AddAudio").props.onPress());
  await act(async () => action("Cancel").props.onPress());
  await act(async () => action("AddAudio").props.onPress());
  // The cancelled native request already finished its copy before cancellation.
  await act(async () => firstCopy(metadata));
  // A retry commits the same content-addressed file while old cleanup is waiting.
  await act(async () => secondCopy(metadata));
  expect(imported).toHaveBeenCalledWith(7);
  await act(async () => oldSnapshot([]));
  expect(FileSystem.unlink).not.toHaveBeenCalled();
});

test("loading and background events cannot overwrite the saved position with an initial zero", async () => {
  let finish!: (value: SongAudioState) => void;
  jest.mocked(songAudio.load).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Song", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  await act(async () => {
    nativeListener(nativeState(0));
    appListener("background");
    jest.advanceTimersByTime(6000);
  });
  expect(usePreferences.getState().songs[7].audioPosition).toBe(3);
  expect(songAudio.pause).not.toHaveBeenCalled();
  await act(async () => finish(nativeState()));
  expect(songAudio.seek).toHaveBeenCalledWith(3000);
});

test("an undeployed shared service shows unavailable and disables analysis without ordinary connection inputs", async () => {
  jest
    .mocked(loadAnalysisSettings)
    .mockResolvedValue({
      mode: "shared",
      url: "",
      token: "",
      language: "auto"
    });
  await act(async () => {
    screen = Renderer.create(
      <AnalysisSettingsSheet songId={7} onClose={jest.fn()} />
    );
  });
  expect(screen!.root.findAllByType(TextInput)).toHaveLength(0);
  expect(
    screen!.root
      .findAllByType(Text)
      .some((node) => node.props.children === "AnalysisServiceUnavailable")
  ).toBe(true);
  expect(action("AnalysisStart").props.disabled).toBe(true);
  expect(inspectAnalysisService).not.toHaveBeenCalled();
  await act(async () => action("AnalysisStart").props.onPress());
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(startSongAnalysis).not.toHaveBeenCalled();
});

test("shared setup displays verified destination, limits and privacy and requires explicit complete-recording consent", async () => {
  bundledService.url = "https://freetune.test";
  jest
    .mocked(loadAnalysisSettings)
    .mockResolvedValue({ mode: "shared", url: "", token: "", language: "en" });
  jest.mocked(inspectAnalysisService).mockResolvedValue({
    ready: true,
    serviceMode: "shared",
    authentication: "installation",
    limits: {
      uploadBytes: 268435456,
      durationSeconds: 1800,
      activeJobsPerInstallation: 2,
      jobsPerDay: 20
    },
    privacy: { audioDeletion: "after_processing", resultRetentionHours: 24 }
  });
  await act(async () => {
    screen = Renderer.create(
      <AnalysisSettingsSheet songId={7} onClose={jest.fn()} />
    );
  });
  const text = screen!.root
    .findAllByType(Text)
    .map((node) => node.props.children);
  expect(text).toEqual(
    expect.arrayContaining([
      "https://freetune.test",
      "AnalysisServiceLimits",
      "AnalysisSharedPrivacy"
    ])
  );
  expect(screen!.root.findAllByType(TextInput)).toHaveLength(0);
  expect(action("AnalysisStart").props.disabled).toBe(false);
  await act(async () => action("AnalysisStart").props.onPress());
  expect(startSongAnalysis).not.toHaveBeenCalled();
  const consent = jest
    .mocked(Alert.alert)
    .mock.calls.find(([title]) => title === "AnalysisUploadTitle")!;
  expect(consent[1]).toBe("AnalysisSharedUploadConsent: https://freetune.test");
  await act(async () =>
    consent[2]!.find((button) => button.text === "AnalysisSend")!.onPress!()
  );
  expect(startSongAnalysis).toHaveBeenCalledWith(7, {
    mode: "shared",
    url: "",
    token: "",
    language: "en"
  });
});

test("advanced mode keeps the saved private URL and token when switching service modes", async () => {
  jest
    .mocked(loadAnalysisSettings)
    .mockResolvedValue({
      mode: "shared",
      url: "http://192.168.1.10:8765",
      token: "kept-private-token",
      language: "ru"
    });
  await act(async () => {
    screen = Renderer.create(
      <AnalysisSettingsSheet songId={7} onClose={jest.fn()} />
    );
  });
  expect(screen!.root.findAllByType(TextInput)).toHaveLength(0);
  await act(async () => action("AnalysisAdvancedSettings").props.onPress());
  await act(async () => action("AnalysisPrivateService").props.onPress());
  expect(
    screen!.root.findAllByType(TextInput).map((node) => node.props.value)
  ).toEqual(["http://192.168.1.10:8765", "kept-private-token"]);
  await act(async () => action("AnalysisSharedService").props.onPress());
  expect(screen!.root.findAllByType(TextInput)).toHaveLength(0);
  await act(async () => action("AnalysisPrivateService").props.onPress());
  expect(
    screen!.root.findAllByType(TextInput).map((node) => node.props.value)
  ).toEqual(["http://192.168.1.10:8765", "kept-private-token"]);
});

test("line-only results are labelled and remain tied to actual native playback position", async () => {
  const initial = audio();
  initial.analysis!.lyrics[0].words = [];
  jest.mocked(getAudioSong).mockResolvedValue(initial);
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Test", content: "" }}
        initialAudio={initial}
      />
    );
  });
  await act(async () => nativeListener(nativeState(6000, "playing")));
  expect(
    screen!.root
      .findAllByType(Text)
      .some((node) => node.props.children === "AnalysisLineTimingOnly")
  ).toBe(true);
  expect(
    screen!.root
      .findAllByType(Text)
      .filter((node) => node.props.style?.includes?.(styles.wordActive))
  ).toHaveLength(0);
});

test("queued jobs show queue position and the same-job retry wait", async () => {
  jest.mocked(analysisIsRunning).mockReturnValue(true);
  jest
    .mocked(analysisNetworkStatus)
    .mockReturnValue({ queuePosition: 3, retryAfterSeconds: 4 });
  jest.mocked(getAnalysisJob).mockResolvedValue({
    id: "job-1",
    songId: 7,
    status: "queued",
    stage: "queued",
    progress: 0,
    serverJobId: "remote-1",
    serverUrl: "https://freetune.test",
    error: null,
    attempt: 1,
    updatedAt: 1
  });
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Test", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  const text = screen!.root
    .findAllByType(Text)
    .map((node) => node.props.children);
  expect(text).toEqual(
    expect.arrayContaining(["AnalysisQueuePosition", "AnalysisRetryAfter"])
  );
});

test("cancelled jobs keep the server-cancellation uncertainty visible after the alert", async () => {
  jest.mocked(getAnalysisJob).mockResolvedValue({
    id: "job-1",
    songId: 7,
    status: "cancelled",
    stage: "cancelled",
    progress: 0.3,
    serverJobId: "remote-1",
    serverUrl: "https://freetune.test",
    error: null,
    attempt: 1,
    updatedAt: 1
  });
  await act(async () => {
    screen = Renderer.create(
      <AudioSongScreen
        song={{ id: 7, title: "Test", content: "" }}
        initialAudio={audio()}
      />
    );
  });
  const text = screen!.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .flat();
  expect(text).toEqual(
    expect.arrayContaining([
      "AnalysisStage_cancelled",
      "AnalysisCancelledServerHint"
    ])
  );
});
