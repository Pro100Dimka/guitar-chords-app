import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import type { FormikProps } from "formik";
import type { SQLTransaction } from "react-native-sqlite-2";
import { db } from "../src/components/database";
import { usePreferences } from "../src/components/preferences";
import {
  emptyTablature,
  normalizeTablature
} from "../src/components/tablature";
import Editor, { type FormValues } from "../src/screens/create-song-chords";
import initialValues from "../src/screens/create-song-chords/formik/initial-values";
import type { RootStackParamList } from "../src/router";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/library-files", () => ({
  readSongCover: jest.fn(),
  fileCanceled: () => false
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("../src/screens/song/tools", () => ({
  Action: () => null
}));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => mockNavigation,
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));

const tab = normalizeTablature({
  ...emptyTablature(121),
  notes: [{ string: 0, fret: 3, tick: 0, duration: 24 }]
})!;
const source = {
  routeKey: "analysis-source",
  sessionId: 7,
  snapshot: JSON.stringify(tab)
};
const receipt = {
  type: "SET_PARAMS",
  source: source.routeKey,
  payload: { params: { savedAudioTab: source } }
};
let mockParams: Exclude<RootStackParamList["createSong"], undefined>;
let mockRoutes: Array<{ key: string; name: string }>;
const mockNavigation = {
  replace: jest.fn(),
  dispatch: jest.fn(),
  getState: () => ({ routes: mockRoutes })
};
const mockPreventRemove = jest.fn();
let screen: Renderer.ReactTestRenderer | undefined;
let holdSave: boolean;
let failSave: boolean;
let commit: (() => void) | undefined;
const form = () =>
  screen!.root.findAll(
    (node) => node.props.formik && node.props.name === "title"
  )[0].props.formik as FormikProps<FormValues>;
const leave = (action: { type: string; payload?: object }) =>
  mockPreventRemove.mock.calls.at(-1)![1]({ data: { action } });
const pressAlert = async (label: string) => {
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === label)!
      .onPress?.()
  );
};

beforeEach(async () => {
  jest.clearAllMocks();
  holdSave = false;
  failSave = false;
  commit = undefined;
  mockRoutes = [{ key: source.routeKey, name: "analyzeAudio" }];
  mockParams = {
    draft: {
      ...initialValues,
      title: "Imported recording",
      content: "[C] 0:00.00–0:01.00",
      tempo: tab.tempo,
      tablature: tab
    },
    audioTabSource: source,
    notice: "OfflineAudioTabNotice"
  };
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  usePreferences.setState({ songs: {}, saveError: false });
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    let savingSong = false;
    const tx: SQLTransaction = {
      executeSql: (sql, _args, done) => {
        if (String(sql).startsWith("INSERT INTO songs")) savingSong = true;
        done?.(tx, {
          insertId: 73,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    const finish = () => {
      if (savingSong && failSave)
        error?.(Object.assign(new Error("disk full"), { code: 1 }));
      else success?.();
    };
    if (savingSong && holdSave) commit = finish;
    else finish();
  });
  await act(async () => {
    screen = Renderer.create(<Editor />);
  });
});

afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.restoreAllMocks();
});

test("the exact tab is acknowledged only after its song transaction commits", async () => {
  holdSave = true;
  let pending!: Promise<void>;
  await act(async () => {
    pending = form().submitForm();
    for (let step = 0; step < 40; step++) await Promise.resolve();
  });
  expect(commit).toBeDefined();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(mockNavigation.replace).not.toHaveBeenCalled();
  await act(async () => {
    commit!();
    await pending;
  });
  expect(usePreferences.getState().songs[73].tablature).toEqual(tab);
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(receipt);
  expect(mockNavigation.replace).toHaveBeenCalledWith("Song", { id: "73" });
  expect(mockNavigation.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
    mockNavigation.replace.mock.invocationCallOrder[0]
  );
});

test("a failed save retains the source protection and retry acknowledges it", async () => {
  failSave = true;
  await act(async () => form().submitForm());
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(mockNavigation.replace).not.toHaveBeenCalled();
  expect(form().values.tablature).toEqual(tab);
  expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
  failSave = false;
  await act(async () => form().submitForm());
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(receipt);
});

test("save-and-leave acknowledges the source before dispatching the pending exit", async () => {
  const removal = { type: "POP_TO", payload: { name: "Tabs" } };
  await act(async () => leave(removal));
  await pressAlert("SaveSong");
  expect(mockNavigation.dispatch.mock.calls.map(([action]) => action)).toEqual([
    receipt,
    removal
  ]);
  expect(mockNavigation.replace).not.toHaveBeenCalled();
});

test("discarding the song form does not acknowledge its imported tab", async () => {
  const back = { type: "GO_BACK" };
  await act(async () => leave(back));
  await pressAlert("DiscardChanges");
  expect(mockNavigation.dispatch.mock.calls.map(([action]) => action)).toEqual([
    back
  ]);
  expect(mockNavigation.replace).not.toHaveBeenCalled();
});

test.each(["missing route", "different tab"])(
  "a successful save cannot acknowledge a %s",
  async (condition) => {
    if (condition === "missing route") mockRoutes = [];
    else
      await act(async () =>
        form().setFieldValue("tablature", { ...tab, tempo: 122 })
      );
    await act(async () => form().submitForm());
    expect(mockNavigation.replace).toHaveBeenCalledWith("Song", { id: "73" });
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  }
);
