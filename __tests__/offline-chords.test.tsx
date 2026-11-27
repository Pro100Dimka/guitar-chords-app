import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Text as NativeText,
  TextInput as NativeTextInput
} from "react-native";
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
import type { RootStackParamList } from "../src/router";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    dispatch: mockDispatch,
    getState: mockGetState
  }),
  useRoute: () => ({ key: "analysis-route", params: mockAnalysisParams }),
  useIsFocused: () => mockScreenFocused,
  usePreventRemove: (enabled: boolean, callback: unknown) =>
    mockPreventRemove(enabled, callback),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === "OfflineChordsUnknown"
        ? require("../src/locales/ru.json")[key]
        : values
          ? `${key} ${Object.entries(values)
              .map(([name, value]) => `${name}=${value}`)
              .join(" ")}`
          : key
  })
}));
jest.mock("../src/screens/song/tools", () => ({
  TempoControl: (props: unknown) =>
    require("react").createElement("TempoControl", {
      ...(props as object),
      testID: "audio-tempo"
    }),
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
jest.mock("../src/screens/analyze-audio/imported-audio-tab", () => ({
  ...jest.requireActual("../src/screens/analyze-audio/imported-audio-tab"),
  ImportedAudioTab: (props: unknown) =>
    require("react").createElement("ImportedAudioTab", {
      ...(props as object),
      testID: "imported-audio-tab"
    })
}));

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockPreventRemove = jest.fn();
let mockAnalysisParams: RootStackParamList["analyzeAudio"];
const mockGetState = jest.fn(() => ({
  routes: [
    { key: "analysis-route", name: "analyzeAudio", params: mockAnalysisParams }
  ]
}));
let mockScreenFocused = true;
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
const nativeNotesResult = () => ({
  ...nativeResult(),
  engine: "chroma-v2",
  noteEventsVersion: 1,
  noteEventsLimit: 24000,
  noteEventsTruncated: false,
  noteEventsCoverageEnd: 6,
  noteEvents: [
    { start: 0.5, end: 2, midi: 40, noteEvidence: 0.9, onsetEvidence: 0.9 },
    { start: 1, end: 1.5, midi: 100, noteEvidence: 0.9, onsetEvidence: 0.9 },
    { start: 2, end: 3, midi: 45, noteEvidence: 0.9, onsetEvidence: 0.9 },
    { start: 4, end: 6, midi: 64, noteEvidence: 0.9, onsetEvidence: 0.9 }
  ]
});
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
const actionFor = (label: string) =>
  screen!.root.find(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function"
  );
const press = async (label: string) => {
  await act(async () => {
    actionFor(label).props.onPress();
    await flush();
  });
};
const rangeInput = (field: "start" | "end") =>
  screen!.root
    .findAllByType(NativeTextInput)
    .find((node) => node.props.testID === `offline-range-${field}`)!;
const changeTime = async (field: "start" | "end", value: string) => {
  await act(async () => {
    rangeInput(field).props.onChangeText(value);
  });
};
const importedTab = () =>
  screen!.root.findByProps({ testID: "imported-audio-tab" });

beforeEach(() => {
  mockScreenFocused = true;
  mockAnalysisParams = undefined;
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

test("section inspection keeps inputs mounted and exports only clipped absolute intervals", async () => {
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  const originalInput = rangeInput("start");
  await changeTime("start", "1,5");
  await changeTime("end", "0:03.000");
  expect(rangeInput("start")).toBe(originalInput);
  expect(
    screen!.root.findByType(FlatList).props.keyboardShouldPersistTaps
  ).toBe("handled");
  expect(screen!.root.findByType(KeyboardAvoidingView).props.behavior).toBe(
    "padding"
  );
  await press("OfflineChordsRangeApply");
  expect(visibleText()).toContain("0:01.50–0:03.00 *");
  expect(visibleText()).toContain(
    "OfflineChordsOriginalInterval start=0:01.00 end=0:03.50"
  );
  expect(visibleText()).toContain("OfflineChordsFullRecording");
  expect(native.analyzeFile).toHaveBeenCalledTimes(1);
  await press("OfflineChordsSectionEdit");
  const draft = mockNavigate.mock.calls[0][1].draft;
  expect(draft.title).toBe("Song (0:01.50–0:03.00)");
  expect(draft.content).toContain("[C] 0:01.50–0:03.00 *");
  expect(draft.content).toContain("OfflineChordsBoundaryNotice");
  expect(draft.content).toContain("OfflineChordsSectionChartNotice");
  expect(songChords(draft.content)).toEqual(["C"]);
});

test("dirty or invalid time fields cannot silently export the applied range", async () => {
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await changeTime("end", "2");
  // Even the default whole-recording export is blocked before Apply.
  expect(actionFor("OfflineChordsEdit").props.disabled).toBe(true);
  await press("OfflineChordsEdit");
  expect(mockNavigate).not.toHaveBeenCalled();
  await press("OfflineChordsRangeApply");
  expect(visibleText()).toContain(
    "OfflineChordsRangeApplied start=0:00.00 end=0:02.00"
  );
  await changeTime("start", "4");
  await press("OfflineChordsRangeApply");
  expect(visibleText()).toContain("OfflineChordsRangeInvalid");
  expect(visibleText()).toContain("OfflineChordsRangePending");
  expect(visibleText()).toContain(
    "OfflineChordsRangeApplied start=0:00.00 end=0:02.00"
  );
  expect(actionFor("OfflineChordsSectionEdit").props.disabled).toBe(true);
  await press("OfflineChordsSectionEdit");
  expect(mockNavigate).not.toHaveBeenCalled();
  await press("OfflineChordsRangeAll");
  expect(rangeInput("start").props.value).toBe("0:00.00");
  expect(rangeInput("end").props.value).toBe("0:06.00");
  expect(visibleText()).not.toContain("OfflineChordsRangeInvalid");
  expect(actionFor("OfflineChordsEdit").props.disabled).toBe(false);
  await press("OfflineChordsEdit");
  expect(mockNavigate.mock.calls[0][1].draft.title).toBe("Song");
  expect(mockNavigate.mock.calls[0][1].draft.content).toContain(
    "[Am] 0:03.50–0:06.00"
  );
});

test("missing analysis and undetermined audio remain distinct in whole and section exports", async () => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeResult(),
    segments: [
      { start: 0, end: 1, chord: "N", confidence: 0 },
      { start: 2, end: 4, chord: "C", confidence: 0.8 },
      { start: 4, end: 6, chord: "Am", confidence: 0.7 }
    ]
  });
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  expect(visibleText()).toContain("Не определён");
  expect(visibleText()).toContain("OfflineChordsMissing");
  expect(visibleText()).toContain("OfflineChordsSectionUnknownDuration");
  expect(visibleText()).toContain("OfflineChordsSectionMissingDuration");
  await press("OfflineChordsEdit");
  expect(mockNavigate.mock.calls[0][1].draft.content).toContain(
    "OfflineChordsMissing 0:01.00–0:02.00"
  );
  mockNavigate.mockClear();
  await changeTime("start", "0.5");
  await changeTime("end", "3");
  await press("OfflineChordsRangeApply");
  await press("OfflineChordsSectionEdit");
  const content = mockNavigate.mock.calls[0][1].draft.content;
  expect(content).toContain("Не определён 0:00.50–0:01.00 *");
  expect(content).toContain("OfflineChordsMissing 0:01.00–0:02.00");
  expect(content).toContain("[C] 0:02.00–0:03.00 *");
  expect(content).not.toContain("[N]");
  expect(content).not.toContain("[OfflineChordsMissing]");
  expect(songChords(content)).toEqual(["C"]);
});

test.each(["picker cancellation", "decode failure"])(
  "%s preserves the section; a successful replacement resets it",
  async (failure) => {
    await act(async () => {
      screen = Renderer.create(<AnalyzeAudio />);
    });
    await press("OfflineChordsChooseFile");
    await changeTime("start", "2");
    await changeTime("end", "3");
    await press("OfflineChordsRangeApply");
    if (failure === "picker cancellation")
      jest.mocked(pick).mockRejectedValueOnce({ code: "cancelled" });
    else
      native.analyzeFile.mockRejectedValueOnce({ code: "AudioDecodeFailed" });
    await press("OfflineChordsAnotherFile");
    expect(rangeInput("start").props.value).toBe("2");
    expect(rangeInput("end").props.value).toBe("3");
    expect(visibleText()).toContain("0:02.00–0:03.00 *");
    expect(actionFor("OfflineChordsSectionEdit").props.disabled).toBe(false);
    jest
      .mocked(pick)
      .mockResolvedValueOnce(selected("file:///music/new.wav", "New.wav"));
    native.analyzeFile.mockResolvedValueOnce({
      ...nativeResult(),
      duration: 4.75,
      segments: [{ start: 0, end: 4.75, chord: "G", confidence: 0.8 }]
    });
    await press("OfflineChordsAnotherFile");
    expect(rangeInput("start").props.value).toBe("0:00.00");
    expect(rangeInput("end").props.value).toBe("0:04.75");
    expect(visibleText()).toContain("New.wav");
    expect(visibleText()).not.toContain("OfflineChordsRangeApplied");
    expect(actionFor("OfflineChordsEdit").props.disabled).toBe(false);
    await press("OfflineChordsEdit");
    expect(mockNavigate.mock.calls[0][1].draft.title).toBe("New");
  }
);

test("a replacement analysis disables range controls and export", async () => {
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  const pending = deferred<unknown>();
  native.analyzeFile.mockReturnValueOnce(pending.promise);
  await press("OfflineChordsAnotherFile");
  expect(rangeInput("start").props.editable).toBe(false);
  expect(rangeInput("end").props.editable).toBe(false);
  for (const action of [
    "OfflineChordsRangeApply",
    "OfflineChordsRangeAll",
    "OfflineChordsEdit"
  ])
    expect(actionFor(action).props.disabled).toBe(true);
  await changeTime("start", "4");
  expect(rangeInput("start").props.value).toBe("0:00.00");
  await act(async () => {
    pending.resolve(nativeResult());
    await flush();
  });
});

test("audio notes show projection losses and import an edited tab with the selected absolute chord timeline", async () => {
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await changeTime("start", "1");
  await changeTime("end", "2.5");
  expect(actionFor("OfflineAudioGenerateTabs").props.disabled).toBe(true);
  await press("OfflineAudioGenerateTabs");
  expect(
    screen!.root.findAllByProps({ testID: "imported-audio-tab" })
  ).toHaveLength(0);
  await press("OfflineChordsRangeApply");
  expect(visibleText()).toContain(
    "OfflineAudioProjectionCounts selected=3 placed=2"
  );
  expect(visibleText()).toContain(
    "outOfRange=1 unassigned=0 shortened=1 carried=1"
  );
  expect(visibleText()).toContain("OfflineAudioTabAssumptions");
  await press("OfflineAudioGenerateTabs");
  const initial = importedTab().props.initial;
  expect(initial).toMatchObject({ tempo: 120, version: 3, beatsPerBar: 4 });
  expect(initial.notes).toHaveLength(2);
  expect(initial.notes[0].tick).toBe(0);
  const edited = {
    ...initial,
    notes: initial.notes.map((note: { fret: number }, index: number) =>
      index === 0 ? { ...note, fret: note.fret + 1 } : note
    )
  };
  await act(async () => {
    importedTab().props.onChange(edited, true);
    importedTab().props.onClose();
  });
  expect(importedTab().props.visible).toBe(false);
  expect(visibleText()).toContain("OfflineAudioTabEdited");
  await press("OfflineAudioOpenTabs");
  expect(importedTab().props.visible).toBe(true);
  await act(async () => importedTab().props.onSave(edited));
  const draft = mockNavigate.mock.calls[0][1].draft;
  expect(draft.title).toBe("Song (0:01.00–0:02.50)");
  expect(draft.tablature).toEqual(edited);
  expect(draft.rhythm).toBeUndefined();
  expect(draft.content).toContain("[C] 0:01.00–0:02.50 *");
  expect(draft.content).not.toContain("[Am]");
  expect(draft.content).toContain(
    "OfflineAudioTabSource start=0:01.00 end=0:02.50 tempo=120"
  );
  expect(draft.content).toContain("OfflineAudioTabEditedNotice");
  expect(mockNavigate.mock.calls[0][1].notice).toBe("OfflineAudioTabNotice");
  expect(native.analyzeFile).toHaveBeenCalledTimes(1);
});

test("notes can become tabs without chords or a detected tempo", async () => {
  native.analyzeFile.mockResolvedValueOnce({
    ...nativeNotesResult(),
    tempo: null,
    key: null,
    segments: [{ start: 0, end: 6, chord: "N", confidence: 0 }]
  });
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  expect(visibleText()).toContain("OfflineAudioTempoUnknown tempo=80");
  expect(visibleText()).toContain("OfflineAudioNoChordsWithNotes");
  await act(async () =>
    screen!.root.findByProps({ testID: "audio-tempo" }).props.onChange(95)
  );
  await press("OfflineAudioGenerateTabs");
  expect(importedTab().props.initial.tempo).toBe(95);
  await act(async () => importedTab().props.onClose());
  await press("OfflineAudioSaveDraft");
  const draft = mockNavigate.mock.calls[0][1].draft;
  expect(draft.tempo).toBe(95);
  expect(draft.tablature.notes.length).toBeGreaterThan(0);
  expect(draft.content).not.toContain("[N]");
  expect(songChords(draft.content)).toEqual([]);
  expect(draft.rhythm).toBeUndefined();
});

test("changing notation tempo blocks stale tab export until regeneration", async () => {
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  await act(async () => importedTab().props.onClose());
  await act(async () =>
    screen!.root.findByProps({ testID: "audio-tempo" }).props.onChange(125)
  );
  expect(visibleText()).toContain("OfflineAudioTempoPending");
  expect(actionFor("OfflineAudioSaveDraft").props.disabled).toBe(true);
  await press("OfflineAudioSaveDraft");
  expect(mockNavigate).not.toHaveBeenCalled();
  await press("OfflineAudioRegenerateTabs");
  expect(importedTab().props.initial.tempo).toBe(125);
  await act(async () => importedTab().props.onClose());
  expect(actionFor("OfflineAudioSaveDraft").props.disabled).toBe(false);
});

test("edited imported tabs survive a cancelled replacement and require confirmation for range changes or leaving", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const accept = () =>
    alert.mock.calls
      .at(-1)![2]!
      .find((button) => button.text === "OfflineAudioDiscardEdits")!.onPress!();
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  const edited = { ...importedTab().props.initial, tempo: 121 };
  await act(async () => {
    importedTab().props.onChange(edited, true);
    importedTab().props.onClose();
  });
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
  jest.mocked(pick).mockRejectedValueOnce({ code: "cancelled" });
  await press("OfflineChordsAnotherFile");
  expect(pick).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls.at(-1)![0]).toBe("OfflineAudioUnsavedTitle");
  await act(async () => {
    accept();
    await flush();
  });
  expect(pick).toHaveBeenCalledTimes(2);
  expect(visibleText()).toContain("OfflineAudioTabEdited");
  await press("OfflineAudioSaveDraft");
  expect(mockNavigate.mock.calls[0][1].draft.tablature).toEqual(edited);
  const beforeLeave = mockPreventRemove.mock.calls.at(-1)![1];
  await act(async () => beforeLeave({ data: { action: { type: "GO_BACK" } } }));
  expect(mockDispatch).not.toHaveBeenCalled();
  // Declining the alert leaves both the applied range and the edited tab intact.
  await changeTime("end", "3");
  await press("OfflineChordsRangeApply");
  expect(visibleText()).toContain(
    "OfflineChordsRangeWhole start=0:00.00 end=0:06.00"
  );
  expect(visibleText()).toContain("OfflineAudioTabEdited");
  await act(async () => accept());
  expect(visibleText()).toContain(
    "OfflineChordsRangeApplied start=0:00.00 end=0:03.00"
  );
  expect(
    screen!.root.findAllByProps({ testID: "imported-audio-tab" })
  ).toHaveLength(0);
});

test("a stale discard confirmation cannot replace a more recently edited tab", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  const initial = importedTab().props.initial;
  await act(async () => {
    importedTab().props.onChange({ ...initial, tempo: 121 }, true);
    importedTab().props.onClose();
  });
  await press("OfflineAudioRegenerateTabs");
  const discard = alert.mock.calls
    .at(-1)![2]!
    .find((button) => button.text === "OfflineAudioDiscardEdits")!.onPress!;
  const latest = { ...initial, tempo: 122 };
  await act(async () => importedTab().props.onChange(latest, true));
  await act(async () => discard());
  await press("OfflineAudioSaveDraft");
  expect(mockNavigate.mock.calls[0][1].draft.tablature).toEqual(latest);
});

test("a guarded background analysis can release its route after handing tabs to the song editor", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  const edited = { ...importedTab().props.initial, tempo: 121 };
  await act(async () => {
    importedTab().props.onChange(edited, true);
    importedTab().props.onClose();
  });
  await press("OfflineAudioSaveDraft");
  await act(async () => {
    mockScreenFocused = false;
    screen!.update(<AnalyzeAudio />);
  });
  const removal = { type: "POP_TO", payload: { name: "Tabs" } };
  const beforeLeave = mockPreventRemove.mock.calls.at(-1)![1];
  await act(async () => beforeLeave({ data: { action: removal } }));
  expect(mockDispatch).not.toHaveBeenCalled();
  const discard = alert.mock.calls
    .at(-1)![2]!
    .find((button) => button.text === "OfflineAudioDiscardEdits")!.onPress!;
  await act(async () => discard());
  expect(mockDispatch).toHaveBeenCalledWith(removal);
});

test("saving the exact imported tab clears its exit warning and keeps edited provenance", async () => {
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  const initial = importedTab().props.initial;
  const edited = { ...initial, tempo: 121 };
  await act(async () => {
    importedTab().props.onChange(edited, true);
    importedTab().props.onClose();
  });
  await press("OfflineAudioSaveDraft");
  const source = mockNavigate.mock.calls.at(-1)![1].audioTabSource;
  expect(source).toMatchObject({
    routeKey: "analysis-route",
    snapshot: JSON.stringify(edited)
  });
  // Opening the form is not a successful save.
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
  await act(async () => {
    mockAnalysisParams = { savedAudioTab: source };
    screen!.update(<AnalyzeAudio />);
  });
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(false);
  expect(importedTab().props.savedSnapshot).toBe(JSON.stringify(edited));
  expect(visibleText()).not.toContain("OfflineAudioTabEdited");
  await press("OfflineAudioSaveDraft");
  expect(mockNavigate.mock.calls.at(-1)![1].draft.content).toContain(
    "OfflineAudioTabEditedNotice"
  );
  await act(async () => importedTab().props.onChange(initial, false));
  // Undoing to the generated tab is still an unsaved change from the saved tab.
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
  await act(async () => importedTab().props.onChange(edited, true));
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(false);
});

test("a save-and-leave receipt works before the analysis renders its new baseline", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  const edited = { ...importedTab().props.initial, tempo: 121 };
  await act(async () => importedTab().props.onChange(edited, true));
  await act(async () => importedTab().props.onSave(edited));
  const source = mockNavigate.mock.calls.at(-1)![1].audioTabSource;
  await act(async () => {
    mockScreenFocused = false;
    screen!.update(<AnalyzeAudio />);
  });
  const beforeLeave = mockPreventRemove.mock.calls.at(-1)![1];
  const removal = { type: "POP_TO", payload: { name: "Tabs" } };
  // SET_PARAMS updates navigation synchronously; the source screen has not
  // rendered again when the form immediately dispatches the pending exit.
  mockAnalysisParams = { savedAudioTab: source };
  await act(async () => beforeLeave({ data: { action: removal } }));
  expect(alert).not.toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledWith(removal);
});

test("an older saved snapshot never clears later edits or a replacement session", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  native.analyzeFile.mockResolvedValueOnce(nativeNotesResult());
  await act(async () => {
    screen = Renderer.create(<AnalyzeAudio />);
  });
  await press("OfflineChordsChooseFile");
  await press("OfflineAudioGenerateTabs");
  const initial = importedTab().props.initial;
  const edited = { ...initial, tempo: 121 };
  await act(async () => importedTab().props.onChange(edited, true));
  await act(async () => importedTab().props.onSave(edited));
  const source = mockNavigate.mock.calls.at(-1)![1].audioTabSource;
  const later = { ...initial, tempo: 122 };
  await act(async () => importedTab().props.onChange(later, true));
  await act(async () => {
    mockAnalysisParams = { savedAudioTab: source };
    screen!.update(<AnalyzeAudio />);
  });
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
  await press("OfflineAudioRegenerateTabs");
  await act(async () =>
    alert.mock.calls
      .at(-1)![2]!
      .find((button) => button.text === "OfflineAudioDiscardEdits")!.onPress!()
  );
  await act(async () => importedTab().props.onChange(edited, true));
  await act(async () => {
    mockAnalysisParams = { savedAudioTab: { ...source } };
    screen!.update(<AnalyzeAudio />);
  });
  expect(importedTab().props.savedSnapshot).toBeUndefined();
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
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
