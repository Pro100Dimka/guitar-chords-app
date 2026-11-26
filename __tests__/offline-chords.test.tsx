import React from "react";
import Renderer, { act } from "react-test-renderer";
import { NativeModules, Platform, Text as NativeText } from "react-native";
import {
  pick,
  types,
  type DocumentPickerResponse
} from "@react-native-documents/picker";
import {
  analyzeAudioFile,
  chordTime,
  offlineChordDraft
} from "../src/components/offline-chords";
import AnalyzeAudio from "../src/screens/analyze-audio";
import { validationSchema } from "../src/screens/create-song-chords/formik/validation-schema";
import {
  chordShapes,
  createSongEditorState,
  songChords,
  songContentFromEditor,
  transposeSong
} from "../src/screens/song/chords";
import { sourceSong } from "../src/components/song-autofill/source-metadata";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "OfflineChordsUnknown"
        ? require("../src/locales/ru.json")[key]
        : key
  })
}));
jest.mock("../src/screens/song/tools", () => ({
  Action: (props: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityLabel={props.label}
        disabled={props.disabled}
        onPress={props.onPress}
      >
        <Text>{props.label}</Text>
      </Pressable>
    );
  }
}));

const mockNavigate = jest.fn();
const nativeResult = () => ({
  engine: "chroma-v1",
  duration: 6,
  elapsedMs: 120,
  key: "C",
  tempo: 120,
  segments: [
    { start: 0, end: 1, chord: "N", confidence: 0 },
    { start: 1, end: 3.5, chord: "C", confidence: 0.8 },
    { start: 3.5, end: 6, chord: "Am", confidence: 0.7 }
  ]
});
const native = {
  analyzeFile: jest.fn(),
  cancel: jest.fn()
};
const selected = (
  uri = "file:///music/song.mp3",
  name = "Song.mp3"
): [DocumentPickerResponse] => [
  {
    uri,
    name,
    error: null,
    type: "audio/mpeg",
    nativeType: "audio/mpeg",
    size: 12000,
    isVirtual: false,
    convertibleToMimeTypes: null,
    hasRequestedType: true
  }
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let step = 0; step < 8; step++) await Promise.resolve();
};
let screen: Renderer.ReactTestRenderer | undefined;
const visibleText = () =>
  screen!.root
    .findAllByType(NativeText)
    .flatMap((node) => node.props.children)
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join(" ");
const press = async (label: string) => {
  await act(async () => {
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === "function"
      )
      .props.onPress();
    await flush();
  });
};

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "ios");
  NativeModules.OfflineChordAnalysis = native;
  Object.assign(types, { audio: "audio/*" });
  jest.mocked(pick).mockResolvedValue(selected());
  native.analyzeFile.mockResolvedValue(nativeResult());
  native.cancel.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (screen) {
    await act(async () => screen?.unmount());
    screen = undefined;
  }
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test.each(["ios", "android"] as const)(
  "%s imports an audio URI without network or microphone access",
  async (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    const uri =
      platform === "ios" ? "file:///music/song.mp3" : "content://music/12";
    jest.mocked(pick).mockResolvedValueOnce(selected(uri));
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Offline"));
    const result = await analyzeAudioFile();
    expect(result).toMatchObject({ ...nativeResult(), fileName: "Song.mp3" });
    expect(native.analyzeFile).toHaveBeenCalledWith(uri);
    expect(pick).toHaveBeenCalledWith({
      type: ["audio/*"],
      allowMultiSelection: false
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  }
);

test("cancellation holds ownership until native cleanup finishes", async () => {
  const analysis = deferred<unknown>();
  const stopped = deferred<void>();
  native.analyzeFile.mockReturnValueOnce(analysis.promise);
  native.cancel.mockReturnValueOnce(stopped.promise);
  const abort = new AbortController();
  const pending = analyzeAudioFile(abort.signal);
  const failed = expect(pending).rejects.toThrow("Cancelled");
  await flush();
  abort.abort();
  await flush();
  analysis.resolve(nativeResult());
  await flush();
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await expect(analyzeAudioFile()).rejects.toThrow("Busy");
  stopped.resolve();
  await failed;
  await expect(analyzeAudioFile()).resolves.toMatchObject({
    fileName: "Song.mp3"
  });
});

test("an aborted file picker never starts native analysis", async () => {
  const selection = deferred<Awaited<ReturnType<typeof pick>>>();
  jest.mocked(pick).mockReturnValueOnce(selection.promise);
  const abort = new AbortController();
  const pending = analyzeAudioFile(abort.signal);
  abort.abort();
  await expect(analyzeAudioFile()).rejects.toThrow("Busy");
  const failure = expect(pending).rejects.toThrow("Cancelled");
  selection.resolve(selected("file:///music/late.wav", "Late.wav"));
  await failure;
  expect(native.analyzeFile).not.toHaveBeenCalled();
  expect(native.cancel).not.toHaveBeenCalled();
});

test("a pre-aborted request and a missing native module never open the picker", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(analyzeAudioFile(abort.signal)).rejects.toThrow("Cancelled");
  delete NativeModules.OfflineChordAnalysis;
  await expect(analyzeAudioFile()).rejects.toThrow("ChordAnalysisUnsupported");
  expect(pick).not.toHaveBeenCalled();
});

test("picker cancellation releases ownership and a stale signal cannot cancel the next analysis", async () => {
  jest.mocked(pick).mockRejectedValueOnce({ code: "cancelled" });
  await expect(analyzeAudioFile()).rejects.toEqual({ code: "cancelled" });
  const old = new AbortController();
  await analyzeAudioFile(old.signal);
  const pending = deferred<unknown>();
  native.analyzeFile.mockReturnValueOnce(pending.promise);
  const next = analyzeAudioFile();
  await flush();
  old.abort();
  expect(native.cancel).not.toHaveBeenCalled();
  pending.resolve(nativeResult());
  await next;
});

test.each([
  { engine: "chroma-v3" },
  { duration: Infinity },
  { duration: 900.5 },
  { key: "C<script>" },
  { tempo: NaN },
  { elapsedMs: -1 },
  { segments: [{ start: 1, end: 2, chord: "x", confidence: 0.9 }] },
  { segments: [{ start: 1, end: 7, chord: "C", confidence: 0.9 }] },
  { segments: [{ start: 1, end: 2, chord: "C", confidence: NaN }] },
  {
    segments: [
      { start: 0, end: 4, chord: "C", confidence: 1 },
      { start: 3, end: 6, chord: "G", confidence: 1 }
    ]
  }
])("rejects malformed native results %j", async (invalid) => {
  native.analyzeFile.mockResolvedValueOnce({ ...nativeResult(), ...invalid });
  await expect(analyzeAudioFile()).rejects.toThrow("InvalidChordAnalysis");
});

test.each([
  "C9",
  "Cm9",
  "Cmaj9",
  "D5(9)",
  "A5(9)",
  "C/G",
  "Cdim7",
  "Cadd11",
  "Csus",
  "C\n",
  "[C]"
])("v2 rejects a chord outside its canonical vocabulary: %s", async (chord) => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    engine: "chroma-v2",
    segments: [{ start: 0, end: 6, chord, confidence: 0.8 }]
  });
  await expect(analyzeAudioFile()).rejects.toThrow("InvalidChordAnalysis");
});

test.each(["Cmaj7", "G6", "Asus2", "N"])(
  "v2 keeps a key separate from an extended chord: %s",
  async (key) => {
    native.analyzeFile.mockResolvedValueOnce({
      ...nativeResult(),
      engine: "chroma-v2",
      key
    });
    await expect(analyzeAudioFile()).rejects.toThrow("InvalidChordAnalysis");
  }
);

test("v1 retains its original triad-only contract", async () => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    segments: [{ start: 0, end: 6, chord: "G6", confidence: 0.8 }]
  });
  await expect(analyzeAudioFile()).rejects.toThrow("InvalidChordAnalysis");
});

test("v2 canonical chord qualities survive editor, save normalization and transposition", async () => {
  const qualities = [
    "",
    "m",
    "5",
    "sus2",
    "sus4",
    "6",
    "m6",
    "7",
    "maj7",
    "m7",
    "dim",
    "aug",
    "add9",
    "madd9"
  ];
  const labels = qualities.map((quality) => `C${quality}`);
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    engine: "chroma-v2",
    duration: labels.length,
    key: "Bbm",
    segments: labels.map((chord, start) => ({
      start,
      end: start + 1,
      chord,
      confidence: 0.8
    }))
  });
  const result = await analyzeAudioFile();
  expect(result.engine).toBe("chroma-v2");
  expect(result.key).toBe("Bbm");
  expect(result.segments.map((segment) => segment.chord)).toEqual(labels);
  const draft = offlineChordDraft(
    result,
    "Audio",
    "Automatic estimate",
    "Undetermined"
  );
  await expect(
    validationSchema(String as never).validate(draft)
  ).resolves.toMatchObject({
    title: "Song"
  });
  const editor = createSongEditorState(draft.content!);
  const edited = songContentFromEditor(draft.content!, editor.text, editor);
  const saved = sourceSong(edited, draft.tempo).content;
  expect(saved).toBe(draft.content);
  expect(songChords(saved)).toEqual(labels);
  expect(songChords(transposeSong(saved, 2))).toEqual(
    qualities.map((quality) => `D${quality}`)
  );
  for (const label of labels)
    expect(chordShapes(label).length).toBeGreaterThan(0);
  // Imported user charts retain dominant ninths; they are not add9 aliases.
  expect(songChords(transposeSong("[C9] 0:00.00–0:01.00", 2))).toEqual(["D9"]);
});

test("an imported chart preserves timings and can be saved without inventing an artist or lyrics", async () => {
  const result = await analyzeAudioFile();
  const draft = offlineChordDraft(
    result,
    "Audio",
    "Automatic estimate",
    "Undetermined"
  );
  expect(draft.title).toBe("Song");
  expect(draft.fk_band?.name).toBe("");
  expect(draft.content).toBe(
    "Automatic estimate\n\nUndetermined 0:00.00–0:01.00\n[C] 0:01.00–0:03.50\n[Am] 0:03.50–0:06.00"
  );
  expect(draft.content).not.toContain("[N]");
  expect(songChords(draft.content!)).toEqual(["C", "Am"]);
  await expect(
    validationSchema(String as never).validate(draft)
  ).resolves.toMatchObject({
    title: "Song"
  });
  expect(chordTime(59.999)).toBe("1:00.00");
});

test("short native segments retain distinct displayed and exported boundaries", async () => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    segments: [
      { start: 0, end: 0.032, chord: "N", confidence: 0 },
      { start: 0.032, end: 0.16, chord: "C", confidence: 0.8 },
      { start: 0.16, end: 0.224, chord: "G", confidence: 0.8 },
      { start: 0.224, end: 6, chord: "C", confidence: 0.8 }
    ]
  });
  const result = await analyzeAudioFile();
  const draft = offlineChordDraft(
    result,
    "Audio",
    "Automatic estimate",
    "Undetermined"
  );
  expect(chordTime(0.16)).toBe("0:00.16");
  expect(chordTime(0.224)).toBe("0:00.22");
  expect(draft.content).toContain("Undetermined 0:00.00–0:00.03");
  expect(draft.content).toContain("[G] 0:00.16–0:00.22");
});

test("the result screen shows estimates and opens an editable timestamped chart", async () => {
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  const display = visibleText();
  expect(display).toContain("Song.mp3");
  expect(display).toContain("OfflineChordsNotice");
  expect(display).toContain("0:01.0");
  expect(display).toContain("Am");
  expect(display).toContain("Не определён");
  await press("OfflineChordsEdit");
  expect(mockNavigate).toHaveBeenCalledWith("createSong", {
    draft: expect.objectContaining({
      title: "Song",
      content: expect.stringContaining("[Am] 0:03.50–0:06.00")
    }),
    notice: "OfflineChordsNotice"
  });
});

test("the result screen imports extended labels and localized unknown passages without simplification", async () => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    engine: "chroma-v2",
    segments: [
      { start: 0, end: 1, chord: "N", confidence: 0 },
      { start: 1, end: 2, chord: "G6", confidence: 0.8 },
      { start: 2, end: 3, chord: "Dsus2", confidence: 0.8 },
      { start: 3, end: 4, chord: "Cadd9", confidence: 0.8 },
      { start: 4, end: 6, chord: "Asus2", confidence: 0.8 }
    ]
  });
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  for (const label of ["Не определён", "G6", "Dsus2", "Cadd9", "Asus2"])
    expect(visibleText()).toContain(label);
  await press("OfflineChordsEdit");
  const content = mockNavigate.mock.calls[0][1].draft.content as string;
  expect(content).toContain("Не определён 0:00.00–0:01.00");
  expect(content).not.toContain("[N]");
  expect(songChords(content)).toEqual(["G6", "Dsus2", "Cadd9", "Asus2"]);
});

test("silence does not offer to save a fake chord chart", async () => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    key: null,
    tempo: null,
    segments: [{ start: 0, end: 6, chord: "N", confidence: 0 }]
  });
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  expect(visibleText()).toContain("OfflineChordsNoChords");
  expect(
    screen!.root.findAll(
      (node) => node.props.accessibilityLabel === "OfflineChordsEdit"
    )
  ).toHaveLength(0);
});

test("unmount cancels native work and a late result never navigates", async () => {
  const pending = deferred<unknown>();
  native.analyzeFile.mockReturnValueOnce(pending.promise);
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await act(async () => {
    screen!.unmount();
    screen = undefined;
    await flush();
  });
  expect(native.cancel).toHaveBeenCalledTimes(1);
  pending.resolve(nativeResult());
  await flush();
  expect(mockNavigate).not.toHaveBeenCalled();
});
