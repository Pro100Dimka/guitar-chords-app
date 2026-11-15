import * as libraryFiles from "../src/components/library-files";
import type { SQLTransaction } from "react-native-sqlite-2";
import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, TextInput } from "react-native";
import { Formik, FormikProps } from "formik";
import Editor, { FormValues } from "../src/screens/create-song-chords";
import initialValues from "../src/screens/create-song-chords/formik/initial-values";
import { db } from "../src/components/database";
import Song from "../src/screens/song";
import Menu from "../src/screens/song/header-modal";
import { Action } from "../src/screens/song/tools";
import { getAllItems, deleteItem } from "../src/components/database/crud";
import { usePreferences } from "../src/components/preferences";
import { performanceAudio } from "../src/components/performance-audio";
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn(),
  deleteItem: jest.fn()
}));
jest.mock("../src/screens/tuner", () => () => null);
jest.mock("../src/screens/tuner/MicrophoneStream", () => ({
  setKeepAwake: jest.fn()
}));
jest.mock("react-native-vector-icons/Ionicons", () => "Icon");
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: mockParams }),
  useIsFocused: () => true,
  useNavigation: () => mockNavigation,
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
  useFocusEffect: (cb: () => void) => require("react").useEffect(cb, [cb])
}));
let mockParams: { id?: string } = {};
const mockNavigation = {
  dispatch: jest.fn(),
  replace: jest.fn(),
  popTo: jest.fn(),
  setParams: jest.fn()
};
const mockPreventRemove = jest.fn();
let screen: Renderer.ReactTestRenderer;
let fail = false;
let values!: FormikProps<FormValues>;
beforeEach(async () => {
  jest.clearAllMocks();
  fail = false;
  mockParams = {};
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    const tx: SQLTransaction = {
      executeSql: (_sql, _args, done) => {
        done?.(tx, {
          insertId: 91,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
    else success?.();
  });
  await act(async () => {
    screen = Renderer.create(<Editor />);
  });
});
afterEach(async () => {
  await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
async function change() {
  const input = screen.root.findAll(
    (node) => node.props.formik && node.props.name === "title"
  )[0];
  values = input.props.formik;
  await act(async () => {
    await values.setValues({
      ...initialValues,
      title: "Draft",
      content: "Am\nWords"
    });
  });
  values = screen.root.findAll(
    (node) => node.props.formik && node.props.name === "title"
  )[0].props.formik;
}
const trigger = (action: unknown) =>
  mockPreventRemove.mock.calls.at(-1)![1]({ data: { action } });
const press = async (label: string) => {
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === label)!
      .onPress?.()
  );
};
test.each(["GO_BACK", "POP", "POP_TO_TOP"])(
  "changed form blocks %s until discard",
  async (type) => {
    await change();
    expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
    const action = { type };
    await act(async () => trigger(action));
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    await press("StayInEditor");
    expect(values.values.title).toBe("Draft");
    await act(async () => trigger(action));
    await press("DiscardChanges");
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
  }
);
test("save-and-leave waits for successful persistence; failure preserves the edited text", async () => {
  await change();
  const action = { type: "GO_BACK" };
  fail = true;
  await act(async () => trigger(action));
  await press("SaveSong");
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(values.values.content).toBe("Am\nWords");
  fail = false;
  await act(async () => trigger(action));
  await press("SaveSong");
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
});

test("confirmed header deletion of a dirty editor leaves without offering to save the deleted song", async () => {
  await act(async () => screen.unmount());
  mockParams = { id: "1" };
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 1,
      title: "Original",
      content: "Am\nWords",
      band_id: null,
      band_name: "",
      youtube_music: "",
      youtobe_lesson: ""
    }
  ]);
  jest.mocked(deleteItem).mockResolvedValue(undefined);
  jest.mocked(performanceAudio.list).mockResolvedValue([]);
  usePreferences.getState().updateSong(1, { favorite: true });
  mockNavigation.popTo.mockImplementation(() => {
    const action = { type: "POP_TO", payload: { name: "Tabs" } };
    const hook = mockPreventRemove.mock.calls.at(-1);
    if (hook?.[0]) hook[1]({ data: { action } });
    else mockNavigation.dispatch(action);
  });
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const menu = async (label: string) => {
    await act(async () =>
      screen.root
        .findByType(Menu)
        .findAll(
          (node) =>
            node.props.accessibilityLabel === "SongTools" &&
            typeof node.props.onPress === "function"
        )[0]
        .props.onPress()
    );
    const item = screen.root
      .findByType(Menu)
      .findAll(
        (node) =>
          typeof node.props.onPress === "function" &&
          node.props.children?.props?.children === label
      )[0];
    await act(async () => item.props.onPress());
  };
  await menu("Edit");
  await change();
  await menu("Delete");
  await press("Delete");
  expect(deleteItem).toHaveBeenCalledWith(
    expect.objectContaining({ tableName: "songs" })
  );
  expect(
    jest
      .mocked(Alert.alert)
      .mock.calls.some((args) => args[0] === "UnsavedSong")
  ).toBe(false);
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: "POP_TO" })
  );
});

test("rendered inputs do not accept new edits while the save transaction is pending", async () => {
  await change();
  let finish!: () => void;
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    let saving = false;
    const tx: SQLTransaction = {
      executeSql: (sql, _args, done) => {
        if (String(sql).startsWith("INSERT INTO songs")) saving = true;
        done?.(tx, {
          insertId: 91,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    if (saving) finish = () => success?.();
    else success?.();
  });
  const title = () =>
    screen.root
      .findAllByType(TextInput)
      .find((node) => node.props.accessibilityLabel === "SongTitle")!;
  await act(async () => {
    void screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "SaveSong")!
      .props.onPress();
  });
  expect(typeof finish).toBe("function");
  expect(
    screen.root
      .findAllByType(TextInput)
      .every((node) => node.props.editable === false)
  ).toBe(true);
  await act(async () => title().props.onChangeText("Typed while saving"));
  expect(title().props.value).toBe("Draft");
  await act(async () => finish());
  expect(mockNavigation.replace).toHaveBeenCalledWith("Song", { id: "91" });
});

test("overlong performer shows its field error instead of silently refusing save", async () => {
  const fields = screen.root.findAllByType(TextInput);
  const performer = fields.find((x) => x.props.accessibilityLabel === "Band")!;
  await act(async () => performer.props.onChangeText("x".repeat(1001)));
  const current = screen.root.findAll(
    (node) => node.props.formik && node.props.name === "title"
  )[0].props.formik;
  await act(async () => {
    await current.setFieldValue("title", "Example");
    await current.setFieldValue("content", "Am\nWords");
  });
  await act(async () => current.submitForm());
  expect(JSON.stringify(screen.toJSON())).toContain("FileTooLarge");
  expect(mockNavigation.replace).not.toHaveBeenCalled();
});

test("exit saving cannot commit while the selected cover is still processing", async () => {
  await change();
  let finishCover!: (value: string) => void;
  jest.spyOn(libraryFiles, "readSongCover").mockReturnValue(
    new Promise((resolve) => {
      finishCover = resolve;
    })
  );
  await act(async () =>
    screen.root
      .find(
        (node) =>
          node.props.accessibilityLabel === "ChangeSongCover" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  jest.mocked(db.transaction).mockClear();
  const action = { type: "GO_BACK" };
  await act(async () => trigger(action));
  const save = jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)?.[2]
    ?.find((button) => button.text === "SaveSong");
  if (save) await act(async () => save.onPress?.());
  expect(db.transaction).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  await act(async () => finishCover("data:image/jpeg;base64,/9j/2Q=="));
  await act(async () => trigger(action));
  await press("SaveSong");
  expect(usePreferences.getState().songs[91].cover).toBe(
    "data:image/jpeg;base64,/9j/2Q=="
  );
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
});

test("editing and saving imported internal chord changes preserves the word and capo", async () => {
  const imported = libraryFiles.importedSong(
    "{title: Example}\n{capo: 1}\nПо[C]ве[Am]рь",
    "example.pro"
  );
  const field = () =>
    screen.root.findAll(
      (node) => node.props.formik && node.props.name === "title"
    )[0].props.formik;
  await act(async () => field().setValues({ ...initialValues, ...imported }));
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "EditLyrics")!
      .props.onPress()
  );
  const input = screen.root
    .findAllByType(TextInput)
    .find((node) => node.props.accessibilityLabel === "ChordsLyrics")!;
  expect(input.props.value).not.toMatch(/\[[A-G]/);
  expect(input.props.value.split("\n").at(-1)).toBe("Поверь");
  await act(async () => input.props.onChangeText(input.props.value + " мне"));
  await act(async () => field().submitForm());
  const { transposeSong } = require("../src/screens/song/chords");
  const metadata = usePreferences.getState().songs[91];
  const transaction = jest.mocked(db.transaction).mock.calls.at(-1)!;
  const contents: string[] = [];
  transaction[0]({
    executeSql: (sql, args, success) => {
      if (sql.startsWith("INSERT INTO songs")) contents.push(String(args![1]));
      success?.(
        { executeSql: jest.fn() },
        { rowsAffected: 1, insertId: 91, rows: { length: 0, item: jest.fn() } }
      );
    }
  });
  expect(metadata.capo).toBe(1);
  expect(transposeSong(contents[0], -metadata.capo)).toBe("По[C]ве[Am]рь мне");
  const backup = libraryFiles.parseLibraryBackup(
    JSON.stringify({
      format: "freetune-library",
      version: 2,
      songs: [
        {
          ...imported,
          band_name: "",
          youtube_music: "",
          youtobe_lesson: "",
          content: contents[0],
          preferences: metadata
        }
      ]
    })
  );
  expect(transposeSong(backup[0].content, -backup[0].preferences.capo)).toBe(
    "По[C]ве[Am]рь мне"
  );
});
