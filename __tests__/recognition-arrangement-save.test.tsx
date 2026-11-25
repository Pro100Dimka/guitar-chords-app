import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  NativeModules
} from "react-native";
import type { SQLTransaction } from "react-native-sqlite-2";
import { db } from "../src/components/database";
import checkMicPermission from "../src/components/permissions";
import { usePreferences } from "../src/components/preferences";
import {
  lookupSongContent,
  lookupSongTempo
} from "../src/components/song-autofill/lyrics";
import RecognizeSong from "../src/screens/recognize-song";
import CreateChordSong, {
  type FormValues
} from "../src/screens/create-song-chords";
import { sourceArrangement } from "../src/screens/song/rhythms";
import { Action } from "../src/screens/song/tools";

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/permissions", () => jest.fn());
jest.mock("../src/components/song-autofill/lyrics", () => ({
  ...jest.requireActual("../src/components/song-autofill/lyrics"),
  lookupSongContent: jest.fn(),
  lookupSongTempo: jest.fn()
}));
jest.mock("../src/components/library-files", () => ({
  readRemoteSongCover: jest.fn().mockResolvedValue(""),
  readSongCover: jest.fn(),
  fileCanceled: () => false,
  importedSong: jest.fn(),
  readLibraryFile: jest.fn()
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => mockNavigation,
  usePreventRemove: jest.fn(),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));

let mockParams: {
  mode?: "mic";
  autoStart?: boolean;
  requestId?: string;
  draft?: FormValues;
  notice?: string;
};
const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  dispatch: jest.fn()
};
const previousNative = NativeModules.SongRecognition;
const previousAppState = AppState.currentState;
let screen: Renderer.ReactTestRenderer | undefined;
let writes: { sql: string; args: unknown[] }[];
const arrangementText = [
  "Picking: eight",
  "[Verse]",
  "Strumming: four",
  "[Am]First example words [G]for this verse",
  "[Chorus]",
  "Picking: 6/8",
  "[F]Other example words [C]for the chorus"
].join("\n");
const pickedChart = {
  id: 1,
  title: "Track",
  artist: "Artist",
  album: "Picked",
  duration: null,
  source: "Akkords.pro" as const,
  url: "https://akkords.pro/songs/artist/track/",
  content: arrangementText,
  hasChords: true,
  tempo: 92,
  rhythm: sourceArrangement(arrangementText)
};
const strummedChart = {
  ...pickedChart,
  id: 2,
  album: "Strummed",
  url: "https://akkords.pro/songs/artist/track-strummed/",
  content: "Strumming: six\n[Dm]Different words [G]for this version",
  tempo: 118,
  rhythm: sourceArrangement("Strumming: six")
};
const plainChart = {
  ...pickedChart,
  id: 3,
  album: "Plain",
  url: "https://akkords.pro/songs/artist/track-plain/",
  content: "[Em]Only the words [C]and chords are specified",
  tempo: undefined,
  rhythm: undefined
};

async function press(label: string) {
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
}

async function choose(album: string) {
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => String(node.props.label).startsWith(`${album} ·`))!
      .props.onPress()
  );
}

async function start() {
  await act(async () => {
    screen = Renderer.create(<RecognizeSong />);
  });
  await press("AddSongStart");
}

async function openEditor() {
  await press("AddSongEditResult");
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith(
    "createSong",
    expect.objectContaining({ notice: "AddSongChordsNotice" })
  );
  mockParams = mockNavigation.navigate.mock.calls.at(-1)![1];
  await act(async () => screen!.update(<CreateChordSong />));
  return mockParams.draft!;
}

async function save() {
  await act(async () =>
    screen!.root
      .findAllByType(Action)
      .find((node) => node.props.label === "SaveSong")!
      .props.onPress()
  );
  expect(mockNavigation.replace).toHaveBeenLastCalledWith("Song", {
    id: "73"
  });
  const saved = writes.find((write) => write.args[0] === "song:73:0");
  expect(saved).toBeDefined();
  return JSON.parse(String(saved!.args[1]));
}

beforeEach(() => {
  mockParams = { mode: "mic" };
  AppState.currentState = "active";
  writes = [];
  usePreferences.setState({ songs: {}, saveError: false });
  jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected unit-test network request"));
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(true);
  jest.mocked(checkMicPermission).mockResolvedValue(true);
  jest.mocked(lookupSongTempo).mockResolvedValue(undefined);
  jest.mocked(lookupSongContent).mockResolvedValue([pickedChart]);
  NativeModules.SongRecognition = {
    recognizeMicrophone: jest.fn().mockResolvedValue({
      title: "Track",
      artist: "Artist",
      source: "Shazam"
    }),
    cancel: jest.fn().mockResolvedValue(undefined)
  };
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    const tx: SQLTransaction = {
      executeSql: (sql, args, done) => {
        writes.push({ sql: String(sql), args: args ?? [] });
        done?.(tx, {
          insertId: sql.startsWith("INSERT INTO bands") ? 11 : 73,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    success?.();
  });
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

test.each(["recognized", "looked up"])(
  "the chosen chart overrides %s tempo and saves picking plus section rhythms",
  async (fallback) => {
    if (fallback === "recognized")
      NativeModules.SongRecognition.recognizeMicrophone.mockResolvedValue({
        title: "Track",
        artist: "Artist",
        source: "Shazam",
        tempo: 144
      });
    else jest.mocked(lookupSongTempo).mockResolvedValue(144);
    await start();
    const draft = await openEditor();
    expect(draft.tempo).toBe(92);
    const expected = {
      tempo: 92,
      strum: "B3231323",
      strumMeter: 4,
      strumDivision: 2,
      strumPreset: "pick-eight",
      rhythmSections: {
        verse: {
          strum: "D-U-D-U-",
          strumMeter: 4,
          strumDivision: 2,
          strumPreset: "four"
        },
        chorus: {
          strum: "B32123",
          strumMeter: 2,
          strumDivision: 3,
          strumPreset: "pick-six"
        }
      }
    };
    const persisted = await save();
    expect(persisted).toMatchObject(expected);
    expect(usePreferences.getState().songs[73]).toEqual(persisted);
    expect(
      writes.find((write) => write.sql.startsWith("INSERT INTO songs"))
    ).toMatchObject({ args: ["Track", arrangementText, 11, "", "", "track"] });
    expect(lookupSongTempo).toHaveBeenCalledTimes(
      fallback === "recognized" ? 0 : 1
    );
  }
);

test.each([
  { fallback: 137, next: strummedChart, expectedTempo: 118 },
  { fallback: 137, next: plainChart, expectedTempo: 137 },
  { fallback: undefined, next: plainChart, expectedTempo: undefined }
])(
  "switching to $next.album restores its settings with external tempo $fallback",
  async ({ fallback, next, expectedTempo }) => {
    jest.mocked(lookupSongTempo).mockResolvedValue(fallback);
    jest
      .mocked(lookupSongContent)
      .mockResolvedValue([pickedChart, strummedChart, plainChart]);
    await start();
    await choose("Picked");
    await press("ChooseLyricsVersion");
    await choose(next.album);
    const draft = await openEditor();
    expect(draft.content).toBe(next.content);
    expect(draft.tempo).toBe(expectedTempo);
    expect(draft.rhythm).toEqual(next.rhythm);
    const persisted = await save();
    expect(persisted).toMatchObject({
      tempo: expectedTempo ?? 80,
      strum: next === strummedChart ? "D-DU-UDU" : "",
      strumPreset: next === strummedChart ? "six" : "",
      rhythmSections: {}
    });
    expect(usePreferences.getState().songs[73]).toEqual(persisted);
    expect(lookupSongContent).toHaveBeenCalledTimes(1);
  }
);

test.each([NaN, 201])(
  "invalid native tempo %s cannot replace the verified independent fallback",
  async (tempo) => {
    NativeModules.SongRecognition.recognizeMicrophone.mockResolvedValue({
      title: "Track",
      artist: "Artist",
      source: "Shazam",
      tempo
    });
    jest.mocked(lookupSongTempo).mockResolvedValue(136);
    jest.mocked(lookupSongContent).mockResolvedValue([plainChart]);
    await start();
    expect((await openEditor()).tempo).toBe(136);
    expect(lookupSongTempo).toHaveBeenCalledTimes(1);
  }
);

test("a new recognition attempt cannot reuse the previous song's fallback tempo", async () => {
  jest.mocked(lookupSongTempo).mockResolvedValueOnce(137);
  await start();
  jest.mocked(lookupSongContent).mockResolvedValue([plainChart]);
  mockParams = { mode: "mic", autoStart: true, requestId: "next-track" };
  await act(async () => screen!.update(<RecognizeSong />));
  expect((await openEditor()).tempo).toBeUndefined();
  expect(lookupSongContent).toHaveBeenCalledTimes(2);
});
