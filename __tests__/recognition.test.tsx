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
import { lookupSongContent } from "../src/components/song-autofill/lyrics";
import RecognizeSong from "../src/screens/recognize-song";

jest.mock("../src/components/permissions", () => jest.fn());
jest.mock("../src/components/song-autofill/lyrics", () => ({
  ...jest.requireActual("../src/components/song-autofill/lyrics"),
  lookupSongContent: jest.fn(),
  lookupShazamTempo: jest.fn().mockResolvedValue(undefined)
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
const mockNavigation = { replace: jest.fn() };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let screen: Renderer.ReactTestRenderer | undefined;

test.each(["mic", "file"])(
  "abort cancels active native recognition and detaches its listener: %s",
  async (mode) => {
    const running = deferred<null>();
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, "removeEventListener");
    const recognizer = NativeModules.SongRecognition;
    recognizer.recognizeMicrophone.mockReturnValue(running.promise);
    recognizer.recognizeFile.mockReturnValue(running.promise);
    jest
      .mocked(pick)
      .mockResolvedValue([
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
test("backgrounding during enrichment keeps an editable metadata draft and ignores late lyrics", async () => {
  const lyrics = deferred<Awaited<ReturnType<typeof lookupSongContent>>>();
  jest.mocked(lookupSongContent).mockReturnValue(lyrics.promise);
  NativeModules.SongRecognition.recognizeMicrophone.mockResolvedValue({
    title: "Track",
    artist: "Artist",
    source: "Shazam",
    lyrics: "Recognized words",
    url: "https://www.shazam.com/track/123",
    lyricsCredit: "Text attribution"
  });
  let background!: (state: "background") => void;
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
        (x) =>
          x.props.accessibilityLabel === "AddSongStart" &&
          typeof x.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () => background("background"));
  const card = () =>
    screen!.root.find(
      (x) =>
        x.props.accessibilityLabel === "AddSongEditResult" &&
        typeof x.props.onPress === "function"
    );
  expect(card().props.disabled).toBe(false);
  await act(async () => card().props.onPress());
  expect(mockNavigation.replace).toHaveBeenCalledWith(
    "createSong",
    expect.objectContaining({
      draft: expect.objectContaining({
        title: "Track",
        content: "Recognized words",
        contentSource: {
          name: "Shazam",
          url: "https://www.shazam.com/track/123",
          credit: "Text attribution"
        },
        fk_band: expect.objectContaining({ name: "Artist" })
      })
    })
  );
  await act(async () =>
    lyrics.resolve([
      {
        id: 1,
        title: "Track",
        artist: "Artist",
        content: "Late words",
        source: "LRCLIB",
        album: "",
        duration: null
      }
    ])
  );
  expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
});

test("recognition selects lyrics from the known album instead of the first version", async () => {
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
      content: "Live words",
      source: "LRCLIB"
    },
    {
      id: 2,
      title: "Track",
      artist: "Artist",
      album: "Studio",
      duration: 200,
      content: "Studio words",
      source: "LRCLIB"
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
      draft: expect.objectContaining({ content: "Studio words" })
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
      content: "Live words",
      source: "LRCLIB"
    },
    {
      id: 2,
      title: "Track",
      artist: "Artist",
      album: "Studio",
      duration: 200,
      content: "Studio words",
      source: "LRCLIB"
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
      draft: expect.objectContaining({ content: "Studio words" })
    })
  );
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

test("ready recognition can open immediately and cancels late enrichment", async () => {
  const lyrics = deferred<Awaited<ReturnType<typeof lookupSongContent>>>();
  jest.mocked(lookupSongContent).mockReturnValue(lyrics.promise);
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
  const card = screen!.root.find(
    (x) =>
      x.props.accessibilityLabel === "AddSongEditResult" &&
      typeof x.props.onPress === "function"
  );
  expect(card.props.disabled).toBe(false);
  await act(async () => card.props.onPress());
  expect(mockNavigation.replace).toHaveBeenCalledWith(
    "createSong",
    expect.objectContaining({
      draft: expect.objectContaining({ title: "Track" })
    })
  );
  expect(jest.mocked(lookupSongContent).mock.calls.at(-1)![2]!.aborted).toBe(
    true
  );
  await act(async () => lyrics.resolve([]));
  expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
});

test("additional enrichment can be cancelled without losing the recognized draft", async () => {
  const lyrics = deferred<Awaited<ReturnType<typeof lookupSongContent>>>();
  jest.mocked(lookupSongContent).mockReturnValue(lyrics.promise);
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
  const cancel = screen!.root.findAll(
    (x) => x.props.label === "Cancel" && typeof x.props.onPress === "function"
  );
  expect(cancel.length).toBeGreaterThan(0);
  await act(async () => cancel[0].props.onPress());
  expect(
    screen!.root.find(
      (x) =>
        x.props.accessibilityLabel === "AddSongEditResult" &&
        typeof x.props.onPress === "function"
    ).props.disabled
  ).toBe(false);
  await act(async () => lyrics.resolve([]));
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
