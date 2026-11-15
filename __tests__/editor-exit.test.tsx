import * as libraryFiles from "../src/components/library-files";
import type { SQLTransaction } from "react-native-sqlite-2";
import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, TextInput, ScrollView, FlatList, Text } from "react-native";
import { Formik, FormikProps } from "formik";
import Editor, { FormValues } from "../src/screens/create-song-chords";
import initialValues from "../src/screens/create-song-chords/formik/initial-values";
import { db } from "../src/components/database";
import Song from "../src/screens/song";
import Menu from "../src/screens/song/header-modal";
import { Action, Sheet } from "../src/screens/song/tools";
import { getAllItems, deleteItem } from "../src/components/database/crud";
import { usePreferences } from "../src/components/preferences";
import { performanceAudio } from "../src/components/performance-audio";
import { pick, keepLocalCopy } from "@react-native-documents/picker";
import { FileSystem } from "react-native-file-access";
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
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: String, i18n: { language: "en" } })
}));
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

test("deleting the open scrolled song does not recreate its preferences on unmount", async () => {
  await act(async () => screen.unmount());
  mockParams = { id: "1" };
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 1,
      title: "Title",
      content: "Am\nWords",
      band_name: "",
      youtube_music: "",
      youtobe_lesson: ""
    }
  ]);
  jest.mocked(deleteItem).mockResolvedValue(undefined);
  jest.mocked(performanceAudio.list).mockResolvedValue([]);
  usePreferences.getState().updateSong(1, { favorite: true });
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  const scroll = screen.root
    .findAllByType(ScrollView)
    .find((node) => typeof node.props.onContentSizeChange === "function")!;
  await act(async () => {
    scroll.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
    scroll.props.onContentSizeChange(360, 1600);
  });
  await act(async () =>
    scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 200 } } })
  );
  await act(async () =>
    screen.root
      .findByType(Menu)
      .find(
        (node) =>
          node.props.accessibilityLabel === "SongTools" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  const item = screen.root
    .findByType(Menu)
    .findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.props.children?.props?.children === "Delete"
    )[0];
  await act(async () => item.props.onPress());
  await press("Delete");
  expect(usePreferences.getState().songs[1]).toBeUndefined();
  await act(async () => screen.unmount());
  expect(usePreferences.getState().songs[1]).toBeUndefined();
});

test.each([true, false])(
  "real editor preserves dense chords and musical annotations on save: edit=%s",
  async (edit) => {
    await act(async () => screen.unmount());
    const content = edit ? "[C]а[Am]б[Dm]в" : "C | G | (x2)\nHello there";
    const song = { id: 22, title: "Saved song", content };
    const saved: string[] = [];
    jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
      const tx: SQLTransaction = {
        executeSql: (sql, args, done) => {
          if (sql.startsWith("UPDATE songs")) saved.push(String(args![1]));
          done?.(tx, {
            rowsAffected: 1,
            insertId: 22,
            rows: { length: 0, item: jest.fn() }
          });
        }
      };
      body(tx);
      success?.();
    });
    await act(async () => {
      screen = Renderer.create(<Editor song={song} setIsEdit={() => {}} />);
    });
    const form = () =>
      screen.root.findAll(
        (node) => node.props.formik && node.props.name === "title"
      )[0].props.formik;
    if (edit) {
      await act(async () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "EditLyrics")!
          .props.onPress()
      );
      const input = screen.root
        .findAllByType(TextInput)
        .find((node) => node.props.accessibilityLabel === "ChordsLyrics")!;
      expect(input.props.value).toBe("C Dm\n Am\nабв");
      await act(async () =>
        input.props.onChangeText(input.props.value.replace(/^C/, "D"))
      );
    }
    await act(async () => form().submitForm());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBe(edit ? "[D]а[Am]б[Dm]в" : content);
    const {
      songChordSequence,
      transposeSong
    } = require("../src/screens/song/chords");
    expect(songChordSequence(saved[0])).toEqual(
      edit ? ["D", "Am", "Dm"] : ["C", "G"]
    );
    expect(transposeSong(saved[0], 0)).toBe(saved[0]);
  }
);

test("opening recordings from deletion while editing preserves the draft", async () => {
  await act(async () => screen.unmount());
  mockParams = { id: "22" };
  const song = { id: 22, title: "Saved song", content: "Am\nWords" };
  jest.mocked(getAllItems).mockResolvedValue([song]);
  jest
    .mocked(performanceAudio.list)
    .mockResolvedValue([
      { path: "/performances/song-22-100.m4a", date: 100, bytes: 100 }
    ]);
  mockNavigation.setParams.mockImplementation((patch) => {
    Object.assign(mockParams, patch);
  });
  await act(async () => {
    screen = Renderer.create(<Song />);
  });
  await act(async () => screen.root.findByType(Menu).props.setIsEdit(true));
  const form = () =>
    screen.root.findAll(
      (node) => node.props.formik && node.props.name === "title"
    )[0].props.formik;
  await act(async () => form().setFieldValue("title", "Unsaved draft"));
  await act(async () =>
    screen.root
      .findByType(Menu)
      .find(
        (node) =>
          node.props.accessibilityLabel === "SongTools" &&
          typeof node.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () =>
    screen.root
      .findByType(Menu)
      .findAll(
        (node) =>
          typeof node.props.onPress === "function" &&
          node.props.children?.props?.children === "Delete"
      )[0]
      .props.onPress()
  );
  await press("Delete");
  await press("MyRecordings");
  await act(async () => screen.update(<Song />));
  expect(
    screen.root
      .findAllByType(Sheet)
      .some((node) => node.props.title === "MyRecordings")
  ).toBe(true);
  expect(form().values.title).toBe("Unsaved draft");
  expect(
    screen.root.findAll(
      (node) => node.props.accessibilityLabel === "StartRecording"
    )
  ).toHaveLength(0);
  expect(mockNavigation.popTo).not.toHaveBeenCalled();
});

test.each([false, true])(
  "real editor preserves ordinary chord order on save and paste: paste=%s",
  async (paste) => {
    await act(async () => screen.unmount());
    const saved: string[] = [];
    jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
      const tx: SQLTransaction = {
        executeSql: (sql, args, done) => {
          if (sql.startsWith("UPDATE songs")) saved.push(String(args![1]));
          done?.(tx, {
            rowsAffected: 1,
            insertId: 22,
            rows: { length: 0, item: jest.fn() }
          });
        }
      };
      body(tx);
      success?.();
    });
    await act(async () => {
      screen = Renderer.create(
        <Editor
          song={{
            id: 22,
            title: "Sequence",
            content: paste ? "" : "Am C\nF G\nHello world"
          }}
          setIsEdit={() => {}}
        />
      );
    });
    const form = () =>
      screen.root.findAll(
        (node) => node.props.formik && node.props.name === "title"
      )[0].props.formik;
    if (paste) {
      await act(async () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "EditLyrics")!
          .props.onPress()
      );
      await act(async () =>
        screen.root
          .findAllByType(TextInput)
          .find((node) => node.props.accessibilityLabel === "ChordsLyrics")!
          .props.onChangeText("Am C\nF G\nHello world")
      );
    }
    await act(async () => form().submitForm());
    const { songChordSequence } = require("../src/screens/song/chords");
    expect(songChordSequence(saved[0])).toEqual(["Am", "C", "F", "G"]);
  }
);

test.each([
  "[Am]Н[Em]очь  [F][G]придёт",
  "[C]а[Am]б[Dm]в [G]д  [F][Em]слово",
  "[C]A[Am]m\nNext line"
])(
  "editing only punctuation preserves all dense chord coordinates: %s",
  async (content) => {
    await act(async () => screen.unmount());
    const saved: string[] = [];
    jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
      const tx: SQLTransaction = {
        executeSql: (sql, args, done) => {
          if (sql.startsWith("UPDATE songs")) saved.push(String(args![1]));
          done?.(tx, {
            rowsAffected: 1,
            insertId: 22,
            rows: { length: 0, item: jest.fn() }
          });
        }
      };
      body(tx);
      success?.();
    });
    await act(async () => {
      screen = Renderer.create(
        <Editor
          song={{ id: 22, title: "Coordinates", content }}
          setIsEdit={() => {}}
        />
      );
    });
    const form = () =>
      screen.root.findAll(
        (node) => node.props.formik && node.props.name === "title"
      )[0].props.formik;
    await act(async () =>
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "EditLyrics")!
        .props.onPress()
    );
    const input = screen.root
      .findAllByType(TextInput)
      .find((node) => node.props.accessibilityLabel === "ChordsLyrics")!;
    await act(async () => input.props.onChangeText(input.props.value + "!"));
    await act(async () => form().submitForm());
    expect(saved).toEqual([content + "!"]);
  }
);

test.each([
  { source: "[Am]a[C]b[F]c[G]d", remove: "C", expected: "[Am]ab[F]c[G]d" },
  { source: "[Am]a[C]b[F]c[G]d", remove: "F", expected: "[Am]a[C]bc[G]d" },
  { source: "[C]Am\nNext line", remove: "", expected: "[C]Am\nNext line!" }
])(
  "real editor save/reopen preserves chord deletion and lyric identity: $remove $source",
  async ({ source, remove, expected }) => {
    const saved: string[] = [];
    jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
      const tx: SQLTransaction = {
        executeSql: (sql, args, done) => {
          if (sql.startsWith("UPDATE songs")) saved.push(String(args![1]));
          done?.(tx, {
            rowsAffected: 1,
            insertId: 22,
            rows: { length: 0, item: jest.fn() }
          });
        }
      };
      body(tx);
      success?.();
    });
    for (let cycle = 0; cycle < 2; cycle++) {
      await act(async () => screen.unmount());
      await act(async () => {
        screen = Renderer.create(
          <Editor
            song={{
              id: 22,
              title: "Round trip",
              content: saved.at(-1) ?? source
            }}
            setIsEdit={() => {}}
          />
        );
      });
      await act(async () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "EditLyrics")!
          .props.onPress()
      );
      const input = screen.root
        .findAllByType(TextInput)
        .find((node) => node.props.accessibilityLabel === "ChordsLyrics")!;
      const draft = input.props.value;
      if (cycle === 0) {
        if (remove) expect(draft).toBe("Am G\n C\n  F\nabcd");
        await act(async () =>
          input.props.onChangeText(
            remove ? draft.replace(remove, "") : draft + "!"
          )
        );
      }
      await act(async () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "CollapseEditor")!
          .props.onPress()
      );
      const form = screen.root.findAll(
        (node) => node.props.formik && node.props.name === "title"
      )[0].props.formik;
      await act(async () => form.submitForm());
      expect(saved).toHaveLength(cycle + 1);
      expect(saved[cycle]).toBe(expected);
      const { songChordSequence } = require("../src/screens/song/chords");
      expect(songChordSequence(saved[cycle])).toEqual(
        songChordSequence(expected)
      );
    }
  }
);

test("renaming a restored maximum-size song preserves its accepted text", async () => {
  const content = "C D\nHello\n".repeat(20000);
  const [restored] = libraryFiles.parseLibraryBackup(
    JSON.stringify({
      format: "freetune-library",
      version: 2,
      songs: [
        {
          title: "Original",
          content,
          band_name: "",
          youtube_music: "",
          youtobe_lesson: ""
        }
      ]
    })
  );
  const saved: unknown[][] = [];
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    const tx: SQLTransaction = {
      executeSql: (sql, args, done) => {
        if (sql.startsWith("UPDATE songs")) saved.push(args ?? []);
        done?.(tx, {
          insertId: 22,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    success?.();
  });
  await act(async () => screen.unmount());
  await act(async () => {
    screen = Renderer.create(
      <Editor song={{ ...restored, id: 22 }} setIsEdit={() => {}} />
    );
  });
  const form = () =>
    screen.root.findAll(
      (node) => node.props.formik && node.props.name === "title"
    )[0].props.formik;
  await act(async () => form().setFieldValue("title", "Renamed"));
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "SaveSong")!
      .props.onPress()
  );
  expect(form().errors).toEqual({});
  expect(saved).toHaveLength(1);
  expect(saved[0].slice(0, 2)).toEqual(["Renamed", content]);
});

test.each([
  "[Am]Words\n".repeat(300),
  ("x".repeat(750) + "[C]".repeat(260) + "y\n").repeat(130)
])("large song documents render through a windowed list", async (content) => {
  jest.useFakeTimers();
  try {
    await act(async () => screen.unmount());
    jest
      .mocked(getAllItems)
      .mockResolvedValue([{ id: 22, title: "Large song", content }]);
    mockParams = { id: "22" };
    await act(async () => {
      screen = Renderer.create(<Song />);
    });
    expect(screen.root.findAllByType(FlatList)).toHaveLength(1);
    expect(screen.root.findAllByType(Text).length).toBeLessThan(100);
    const list = screen.root.findByType(FlatList);
    expect(list.props.initialNumToRender).toBe(4);
    expect(list.props.windowSize).toBe(3);
    const rows = list.props.data
      .flat()
      .map((row: { line: string }) => row.line);
    if (content.startsWith("x")) expect(rows.join("\n")).toBe(content);
    else expect(rows).toHaveLength(601);
  } finally {
    await act(async () => screen.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test.each(["cancel", "timeout"])(
  "pending cloud cover releases the editor after %s",
  async (exit) => {
    jest.useFakeTimers();
    await change();
    jest.mocked(pick).mockResolvedValue([
      {
        uri: "content://cover.jpg",
        name: "cover.jpg",
        size: 1024,
        type: "image/jpeg",
        nativeType: "image/jpeg",
        error: null,
        isVirtual: false,
        convertibleToMimeTypes: null,
        hasRequestedType: true
      }
    ]);
    let finish!: (value: Awaited<ReturnType<typeof keepLocalCopy>>) => void;
    jest.mocked(keepLocalCopy).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
    try {
      await act(async () =>
        screen.root
          .find(
            (node) =>
              node.props.accessibilityLabel === "ChangeSongCover" &&
              typeof node.props.onPress === "function"
          )
          .props.onPress()
      );
      const save = () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "SaveSong")!;
      expect(save().props.disabled).toBe(true);
      if (exit === "cancel") {
        await act(async () => trigger({ type: "GO_BACK" }));
        expect(
          jest
            .mocked(Alert.alert)
            .mock.calls.at(-1)?.[2]
            ?.some((button) => button.text === "Cancel")
        ).toBe(true);
        await press("Cancel");
      } else
        await act(async () => {
          await jest.advanceTimersByTimeAsync(60000);
        });
      expect(save().props.disabled).toBe(false);
      await act(async () =>
        finish([
          {
            status: "success",
            localUri: "file:///late-cover.jpg",
            sourceUri: "content://cover.jpg"
          }
        ])
      );
      expect(FileSystem.unlink).toHaveBeenCalledWith("file:///late-cover.jpg");
      const form = () =>
        screen.root.findAll(
          (node) => node.props.formik && node.props.name === "title"
        )[0].props.formik;
      expect(form().values).toMatchObject({
        title: "Draft",
        content: "Am\nWords",
        cover: ""
      });
      const action = { type: "GO_BACK" };
      await act(async () => trigger(action));
      await press("SaveSong");
      expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  }
);

test.each([false, true])(
  "virtualized reading retains its target until layout catches up: grow=%s",
  async (grow) => {
    jest.useFakeTimers();
    await act(async () => screen.unmount());
    mockParams = { id: "22" };
    usePreferences.getState().updateSong(22, { position: 5000 });
    jest
      .mocked(getAllItems)
      .mockResolvedValue([
        { id: 22, title: "Long", content: "Words\n".repeat(301) }
      ]);
    try {
      await act(async () => {
        screen = Renderer.create(<Song />);
      });
      const list = screen.root.findByType(FlatList);
      const scroll = jest
        .spyOn(list.instance, "scrollToOffset")
        .mockImplementation(() => {});
      await act(async () => {
        list.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
        list.props.onContentSizeChange(360, 800);
        list.props.onScroll({ nativeEvent: { contentOffset: { y: 400 } } });
      });
      expect(scroll).toHaveBeenCalledWith({ offset: 400, animated: false });
      if (grow) {
        await act(async () => list.props.onContentSizeChange(360, 10000));
        expect(scroll).toHaveBeenLastCalledWith({
          offset: 5000,
          animated: false
        });
        await act(async () =>
          list.props.onScroll({ nativeEvent: { contentOffset: { y: 5000 } } })
        );
      }
      await act(async () => screen.unmount());
      expect(usePreferences.getState().songs[22].position).toBe(5000);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  }
);

test.each([false, true])(
  "virtualized reading completes restoration at the measured final item, scroll last=%s",
  async (scrollLast) => {
    jest.useFakeTimers();
    await act(async () => screen.unmount());
    mockParams = { id: "22" };
    usePreferences.getState().updateSong(22, { position: 18000 });
    jest
      .mocked(getAllItems)
      .mockResolvedValue([
        { id: 22, title: "Shortened", content: "Words\n".repeat(301) }
      ]);
    try {
      await act(async () => {
        screen = Renderer.create(<Song />);
      });
      const list = screen.root.findByType(FlatList);
      const scroll = jest
        .spyOn(list.instance, "scrollToOffset")
        .mockImplementation(() => {});
      await act(async () => {
        list.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
        list.props.onContentSizeChange(360, 10000);
        if (!scrollLast)
          list.props.onScroll({ nativeEvent: { contentOffset: { y: 9600 } } });
        list.props.onViewableItemsChanged?.({
          viewableItems: [
            {
              index: list.props.data.length - 1,
              isViewable: true,
              item: list.props.data.at(-1),
              key: "last"
            }
          ],
          changed: []
        });
        if (scrollLast)
          list.props.onScroll({ nativeEvent: { contentOffset: { y: 9600 } } });
      });
      scroll.mockClear();
      await act(async () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "ScrollLyrics")!
          .props.onPress()
      );
      await act(async () => jest.advanceTimersByTime(1000));
      expect(scroll.mock.calls.length).toBeGreaterThan(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  }
);
