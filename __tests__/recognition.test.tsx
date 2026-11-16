jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  AppState,
  type AppStateStatus,
  AccessibilityInfo,
  NativeModules,
  Platform
} from "react-native";
import { pick } from "@react-native-documents/picker";
import checkMicPermission from "../src/components/permissions";
import {
  recognizeMicrophone,
  recognizeAudioFile,
  cancelRecognition
} from "../src/components/song-autofill/recognition";
import {
  lookupSongContent,
  lookupSongTempo
} from "../src/components/song-autofill/lyrics";
import RecognizeSong from "../src/screens/recognize-song";

jest.mock("../src/components/permissions", () => jest.fn());
jest.mock("../src/components/song-autofill/lyrics", () => ({
  ...jest.requireActual("../src/components/song-autofill/lyrics"),
  lookupSongContent: jest.fn(),
  lookupSongTempo: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../src/components/library-files", () => ({
  readRemoteSongCover: jest.fn().mockResolvedValue(""),
  fileCanceled: () => false,
  importedSong: jest.fn(),
  readLibraryFile: jest.fn()
}));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: { mode: mockMode } }),
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
let mockMode: "mic" | "file" = "mic";
const mockNavigate = jest.fn();
const mockNavigation = { replace: mockNavigate, navigate: mockNavigate };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let screen: Renderer.ReactTestRenderer | undefined;

test("a standalone letter in plain lyrics is not accepted as a chord chart", async () => {
  jest.mocked(lookupSongContent).mockResolvedValue([
    {
      id: 1,
      title: "Track",
      artist: "Artist",
      album: "",
      duration: null,
      source: "LRCLIB",
      content: "A\nOnly example words"
    }
  ]);
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  expect(
    screen!.root.findAll(
      (node) => node.props.accessibilityLabel === "AddSongEditResult"
    ).length
  ).toBe(0);
  expect(JSON.stringify(screen!.toJSON())).toContain("AddSongNoLyrics");
});

test("iOS recognition uses the native microphone and cancellation contract", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  await expect(recognizeMicrophone()).resolves.toMatchObject({
    title: "Track"
  });
  await cancelRecognition();
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).toHaveBeenCalledTimes(1);
  expect(NativeModules.SongRecognition.cancel).toHaveBeenCalledTimes(1);
});

test.each(["mic", "file"])(
  "recognition refuses plain lyrics without chords: %s",
  async (mode) => {
    mockMode = mode as typeof mockMode;
    NativeModules.SongRecognition.recognizeFile.mockResolvedValue({
      title: "Track",
      artist: "Artist",
      source: "Shazam",
      lyrics: "Only words"
    });
    NativeModules.SongRecognition.recognizeMicrophone.mockResolvedValue({
      title: "Track",
      artist: "Artist",
      source: "Shazam",
      lyrics: "Only words"
    });
    jest.mocked(pick).mockResolvedValue([{ uri: "file:///song.wav" } as never]);
    jest.mocked(lookupSongContent).mockResolvedValue([
      {
        id: 1,
        title: "Track",
        artist: "Artist",
        album: "",
        duration: null,
        source: "LRCLIB",
        content: "Only words",
        hasChords: true
      }
    ]);
    await act(async () => {
      screen = Renderer.create(<RecognizeSong />);
    });
    if (mode === "mic")
      await act(async () =>
        screen!.root
          .find(
            (node) =>
              node.props.accessibilityLabel === "AddSongStart" &&
              typeof node.props.onPress === "function"
          )
          .props.onPress()
      );
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(
      screen!.root.findAll(
        (node) => node.props.accessibilityLabel === "AddSongEditResult"
      )
    ).toHaveLength(0);
    expect(JSON.stringify(screen!.toJSON())).toContain("AddSongNoLyrics");
  }
);

test.each(["mic", "file"])(
  "abort cancels active native recognition and detaches its listener: %s",
  async (mode) => {
    const running = deferred<null>();
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, "removeEventListener");
    const recognizer = NativeModules.SongRecognition;
    recognizer.recognizeMicrophone.mockReturnValue(running.promise);
    recognizer.recognizeFile.mockReturnValue(running.promise);
    jest.mocked(pick).mockResolvedValue([
      {
        uri: "content://song",
        name: "song.wav",
        type: "audio/wav",
        size: 100,
        error: null,
        nativeType: "audio/wav",
        isVirtual: false,
        hasRequestedType: true,
        convertibleToMimeTypes: null
      }
    ]);
    const pending = (mode === "mic" ? recognizeMicrophone : recognizeAudioFile)(
      controller.signal
    ).catch((error) => error);
    for (let i = 0; i < 15; i++) await Promise.resolve();
    controller.abort();
    running.resolve(null);
    expect(await pending).toEqual(new Error("Cancelled"));
    expect(recognizer.cancel).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  }
);
const previousNative = NativeModules.SongRecognition;

test("a rejected concurrent caller cannot cancel the active owner", async () => {
  const running = deferred<null>();
  NativeModules.SongRecognition.recognizeMicrophone.mockReturnValue(
    running.promise
  );
  const owner = new AbortController();
  const first = recognizeMicrophone(owner.signal);
  for (let i = 0; i < 15; i++) await Promise.resolve();
  const other = new AbortController();
  await expect(recognizeMicrophone(other.signal)).rejects.toThrow(
    "RecognitionBusy"
  );
  other.abort();
  expect(NativeModules.SongRecognition.cancel).not.toHaveBeenCalled();
  running.resolve(null);
  await expect(first).resolves.toBeNull();
  owner.abort();
  expect(NativeModules.SongRecognition.cancel).not.toHaveBeenCalled();
});

test("a new recognition waits until native cancellation has completed", async () => {
  const stopping = deferred<void>();
  NativeModules.SongRecognition.cancel.mockReturnValue(stopping.promise);
  const stop = cancelRecognition();
  const next = recognizeMicrophone();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
  stopping.resolve();
  await stop;
  await next;
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).toHaveBeenCalledTimes(1);
});

test("aborting from the capture-ready callback never starts capture or leaks a rejection", async () => {
  const controller = new AbortController();
  await expect(
    recognizeMicrophone(controller.signal, () => controller.abort())
  ).rejects.toThrow("Cancelled");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
  expect(NativeModules.SongRecognition.cancel).toHaveBeenCalledTimes(1);
});
const previousAppState = AppState.currentState;
beforeEach(() => {
  jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected unit-test network request"));
  mockMode = "mic";
  AppState.currentState = "active";
  jest.replaceProperty(Platform, "OS", "android");
  NativeModules.SongRecognition = {
    recognizeMicrophone: jest.fn().mockResolvedValue({
      title: "Track",
      artist: "Artist",
      source: "Shazam"
    }),
    recognizeFile: jest.fn(),
    cancel: jest.fn().mockResolvedValue(undefined)
  };
  jest.mocked(checkMicPermission).mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(true);
});
afterEach(async () => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  NativeModules.SongRecognition = previousNative;
  AppState.currentState = previousAppState;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
test("cancelling while microphone permission is pending prevents native capture", async () => {
  const permission = deferred<boolean>();
  jest.mocked(checkMicPermission).mockReturnValue(permission.promise);
  const abort = new AbortController();
  const result = recognizeMicrophone(abort.signal).catch((error) => error);
  abort.abort();
  permission.resolve(true);
  expect(await result).toEqual(new Error("Cancelled"));
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
});
test("cancelling while the file picker is pending prevents native recognition", async () => {
  const file = deferred<Awaited<ReturnType<typeof pick>>>();
  jest.mocked(pick).mockReturnValue(file.promise);
  const abort = new AbortController();
  const result = recognizeAudioFile(abort.signal).catch((error) => error);
  abort.abort();
  file.resolve([
    {
      uri: "content://recording",
      name: "track.wav",
      type: "audio/wav",
      size: 1234,
      isVirtual: false,
      hasRequestedType: true,
      nativeType: "audio/wav",
      convertibleToMimeTypes: null,
      error: null
    }
  ]);
  expect(await result).toEqual(new Error("Cancelled"));
  expect(NativeModules.SongRecognition.recognizeFile).not.toHaveBeenCalled();
});
test("an already cancelled operation never opens permission or file dialogs", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(recognizeMicrophone(abort.signal)).rejects.toThrow("Cancelled");
  await expect(recognizeAudioFile(abort.signal)).rejects.toThrow("Cancelled");
  expect(checkMicPermission).not.toHaveBeenCalled();
  expect(pick).not.toHaveBeenCalled();
});
test("recognition selects lyrics from the known album instead of the first version", async () => {
  jest.mocked(lookupSongTempo).mockResolvedValueOnce(188);
  NativeModules.SongRecognition.recognizeMicrophone.mockResolvedValue({
    title: "Track",
    artist: "Artist",
    album: "Studio",
    source: "Shazam"
  });
  jest.mocked(lookupSongContent).mockResolvedValue([
    {
      id: 1,
      title: "Track",
      artist: "Artist",
      album: "Live",
      duration: 300,
      content: "Am C\nLive words",
      source: "Cifra Club",
      hasChords: true
    },
    {
      id: 2,
      title: "Track",
      artist: "Artist",
      album: "Studio",
      duration: 200,
      content: "Em G\nStudio words",
      source: "Cifra Club",
      hasChords: true
    }
  ]);
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (x) =>
          x.props.accessibilityLabel === "AddSongStart" &&
          typeof x.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () =>
    screen!.root
      .find(
        (x) =>
          x.props.accessibilityLabel === "AddSongEditResult" &&
          typeof x.props.onPress === "function"
      )
      .props.onPress()
  );
  expect(mockNavigation.replace).toHaveBeenLastCalledWith(
    "createSong",
    expect.objectContaining({
      draft: expect.objectContaining({
        content: "Em G\nStudio words",
        tempo: 188
      })
    })
  );
});

test("ambiguous lyric versions wait for an explicit choice", async () => {
  jest.mocked(lookupSongContent).mockResolvedValue([
    {
      id: 1,
      title: "Track",
      artist: "Artist",
      album: "Live",
      duration: 300,
      content: "Am C\nLive words",
      source: "Cifra Club",
      hasChords: true
    },
    {
      id: 2,
      title: "Track",
      artist: "Artist",
      album: "Studio",
      duration: 200,
      content: "Em G\nStudio words",
      source: "Cifra Club",
      hasChords: true
    }
  ]);
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () => {
    void screen!.root
      .find(
        (x) =>
          x.props.accessibilityLabel === "AddSongStart" &&
          typeof x.props.onPress === "function"
      )
      .props.onPress();
  });
  expect(mockNavigation.replace).not.toHaveBeenCalled();
  const { Action } = require("../src/screens/song/tools");
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((x) => String(x.props.label).startsWith("Studio ·"))!
      .props.onPress()
  );
  await act(async () =>
    screen!.root
      .find(
        (x) =>
          x.props.accessibilityLabel === "AddSongEditResult" &&
          typeof x.props.onPress === "function"
      )
      .props.onPress()
  );
  expect(mockNavigation.replace).toHaveBeenLastCalledWith(
    "createSong",
    expect.objectContaining({
      draft: expect.objectContaining({ content: "Em G\nStudio words" })
    })
  );
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "ChooseLyricsVersion")!
      .props.onPress()
  );
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => String(node.props.label).startsWith("Live ·"))!
      .props.onPress()
  );
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongEditResult" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith(
    "createSong",
    expect.objectContaining({
      draft: expect.objectContaining({ content: "Am C\nLive words" })
    })
  );
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).toHaveBeenCalledTimes(1);
  expect(lookupSongContent).toHaveBeenCalledTimes(1);
});

test("identical text from another album cannot hide the known album match", () => {
  const { preferredSongContent } = jest.requireActual(
    "../src/components/song-autofill/lyrics"
  );
  const base = {
    title: "Track",
    artist: "Artist",
    duration: 200,
    content: "Same words",
    source: "LRCLIB"
  };
  expect(
    preferredSongContent(
      [
        { ...base, id: 1, album: "Live" },
        { ...base, id: 2, album: "Studio" }
      ],
      "Studio"
    )
  ).toEqual([expect.objectContaining({ id: 2 })]);
});

test("immediate retry waits until native cancellation finishes", async () => {
  const native = NativeModules.SongRecognition;
  const first = deferred<null>(),
    stopped = deferred<void>();
  let pending = true;
  native.recognizeMicrophone.mockImplementation(() =>
    native.recognizeMicrophone.mock.calls.length === 1
      ? first.promise
      : pending
        ? Promise.reject(new Error("Busy"))
        : Promise.resolve(null)
  );
  native.cancel.mockImplementation(() => stopped.promise);
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  const button = () =>
    screen!.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        ["AddSongStart", "AutofillCancelSearch"].includes(
          node.props.accessibilityLabel
        )
    );
  await act(async () => {
    void button().props.onPress();
  });
  await act(async () => {
    void button().props.onPress();
  });
  await act(async () => {
    void button().props.onPress();
  });
  expect(native.recognizeMicrophone).toHaveBeenCalledTimes(1);
  pending = false;
  await act(async () => {
    first.resolve(null);
    stopped.resolve();
  });
  await act(async () => button().props.onPress());
  expect(native.recognizeMicrophone).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(screen!.toJSON())).not.toContain(
    "AutofillRecognitionError"
  );
});

test.each([
  ["AudioTooShort", "AutofillAudioTooShort"],
  ["FileUnavailable", "AutofillFileUnavailable"],
  ["FileReadTimeout", "AutofillFileReadTimeout"],
  ["Busy", "AutofillBusy"],
  ["NoAudioTrack", "AutofillNoAudioTrack"],
  ["UnsupportedPcmFormat", "AutofillUnsupportedAudio"]
])("local file error %s has a specific explanation", async (code, message) => {
  mockMode = "file";
  jest.mocked(pick).mockResolvedValue([
    {
      uri: "content://clip",
      name: "clip.wav",
      type: "audio/wav",
      size: 44100,
      isVirtual: false,
      hasRequestedType: true,
      nativeType: "audio/wav",
      convertibleToMimeTypes: null,
      error: null
    }
  ]);
  NativeModules.SongRecognition.recognizeFile.mockRejectedValue(
    Object.assign(new Error(code), { code: "RecognitionFailed" })
  );
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  expect(JSON.stringify(screen!.toJSON())).toContain(message);
  expect(JSON.stringify(screen!.toJSON())).not.toContain(
    "AutofillRecognitionError"
  );
});

test("metadata stays unavailable until real chords have been checked", async () => {
  const lyrics = deferred<Awaited<ReturnType<typeof lookupSongContent>>>();
  jest.mocked(lookupSongContent).mockReturnValue(lyrics.promise);
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  const card = () =>
    screen!.root.find(
      (node) =>
        node.props.accessibilityLabel === "AddSongEditResult" &&
        typeof node.props.onPress === "function"
    );
  expect(card().props.disabled).toBe(true);
  await act(async () => card().props.onPress());
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  await act(async () =>
    lyrics.resolve([
      {
        id: 1,
        title: "Track",
        artist: "Artist",
        album: "",
        duration: null,
        content: "Am C\nExample words",
        source: "Cifra Club",
        hasChords: true
      }
    ])
  );
  expect(card().props.disabled).toBe(false);
  await act(async () => card().props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith(
    "createSong",
    expect.objectContaining({
      draft: expect.objectContaining({ content: "Am C\nExample words" })
    })
  );
});

test("cancelling an unchecked chart restores the microphone button and ignores late results", async () => {
  const lyrics = deferred<Awaited<ReturnType<typeof lookupSongContent>>>();
  jest.mocked(lookupSongContent).mockReturnValue(lyrics.promise);
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  const { Action } = require("../src/screens/song/tools");
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Cancel")!
      .props.onPress()
  );
  expect(
    screen!.root.findAll(
      (node) => node.props.accessibilityLabel === "AddSongEditResult"
    )
  ).toHaveLength(0);
  expect(
    screen!.root.findAll(
      (node) => node.props.accessibilityLabel === "AddSongStart"
    ).length
  ).toBeGreaterThan(0);
  await act(async () =>
    lyrics.resolve([
      {
        id: 1,
        title: "Track",
        artist: "Artist",
        album: "",
        duration: null,
        content: "Am C\nLate words",
        source: "Cifra Club",
        hasChords: true
      }
    ])
  );
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  expect(
    screen!.root.findAll(
      (node) => node.props.accessibilityLabel === "AddSongEditResult"
    )
  ).toHaveLength(0);
});
test("granting microphone permission after Activity pause resumes recognition once active", async () => {
  const permission = deferred<boolean>();
  jest.mocked(checkMicPermission).mockReturnValue(permission.promise);
  jest.mocked(lookupSongContent).mockResolvedValue([]);
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  const state = (value: "active" | "background") => {
    AppState.currentState = value;
    for (const listener of [...listeners]) listener(value);
  };
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () => state("background"));
  await act(async () => permission.resolve(true));
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
  await act(async () => state("active"));
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(screen!.toJSON())).not.toContain(
    "AutofillSearchCancelled"
  );
});

test("leaving the recognition screen while a granted permission awaits foreground prevents capture", async () => {
  const permission = deferred<boolean>();
  jest.mocked(checkMicPermission).mockReturnValue(permission.promise);
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () => {
    AppState.currentState = "background";
    for (const listener of [...listeners]) listener("background");
  });
  await act(async () => permission.resolve(true));
  await act(async () => screen!.unmount());
  screen = undefined;
  await act(async () => {
    AppState.currentState = "active";
    for (const listener of [...listeners]) listener("active");
  });
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
});

test("real backgrounding after capture starts still cancels recognition", async () => {
  const capture = deferred<null>();
  NativeModules.SongRecognition.recognizeMicrophone.mockReturnValue(
    capture.promise
  );
  let background!: (state: AppStateStatus) => void;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      background = listener;
      return { remove: jest.fn() };
    });
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).toHaveBeenCalledTimes(1);
  await act(async () => {
    AppState.currentState = "background";
    background("background");
  });
  expect(NativeModules.SongRecognition.cancel).toHaveBeenCalledTimes(1);
  await act(async () => capture.resolve(null));
  expect(JSON.stringify(screen!.toJSON())).toContain("AutofillSearchCancelled");
  expect(JSON.stringify(screen!.toJSON())).not.toContain(
    "AutofillNoAudioMatch"
  );
});

test("permission denial after the system dialog pause remains a permission error", async () => {
  const permission = deferred<boolean>();
  jest.mocked(checkMicPermission).mockReturnValue(permission.promise);
  let background!: (state: AppStateStatus) => void;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      background = listener;
      return { remove: jest.fn() };
    });
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () => {
    AppState.currentState = "background";
    background("background");
  });
  await act(async () => permission.resolve(false));
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
  expect(JSON.stringify(screen!.toJSON())).toContain("AutofillMicDenied");
  expect(JSON.stringify(screen!.toJSON())).not.toContain(
    "AutofillSearchCancelled"
  );
});

test("a brief resume followed by backgrounding during permission completion cannot start capture", async () => {
  const permission = deferred<boolean>();
  jest.mocked(checkMicPermission).mockReturnValue(permission.promise);
  jest.mocked(lookupSongContent).mockResolvedValue([]);
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  const state = (value: AppStateStatus) => {
    AppState.currentState = value;
    for (const listener of [...listeners]) listener(value);
  };
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "AddSongStart" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () => state("background"));
  await act(async () => permission.resolve(true));
  await act(async () => {
    state("active");
    state("background");
  });
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).not.toHaveBeenCalled();
  await act(async () => state("active"));
  expect(
    NativeModules.SongRecognition.recognizeMicrophone
  ).toHaveBeenCalledTimes(1);
});
