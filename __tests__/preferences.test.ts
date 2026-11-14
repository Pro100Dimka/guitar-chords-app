jest.mock("../src/locales", () => ({ t: String }));
import { db } from "../src/components/database";
import { getAllItems } from "../src/components/database/crud";
import { FileSystem } from "react-native-file-access";
import { saveDocuments } from "@react-native-documents/picker";
import {
  exportLibrary,
  parseLibraryBackup,
  restoreLibrary
} from "../src/components/library-files";
import {
  flushPreferences,
  loadPreferences,
  usePreferences
} from "../src/components/preferences";
import { SQLTransaction } from "react-native-sqlite-2";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));

const cover = "data:image/jpeg;base64,/9j/2Q==";
beforeEach(() => {
  jest.useFakeTimers();
  usePreferences.setState({ songs: {}, saveError: false });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.resetAllMocks();
});

test("song preferences and cover survive serialization and reload; failed commits remain visible", async () => {
  const saved = new Map<string, string>();
  let fail = true;
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    body({
      executeSql: (_sql, args) => {
        if (args?.[1]) saved.set(String(args[0]), String(args[1]));
      }
    });
    if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
    else success?.();
  });
  usePreferences.getState().updateSong(17, {
    cover,
    favorite: true,
    position: 125,
    shapes: { F: 3 },
    tempo: 92
  });
  flushPreferences();
  expect(usePreferences.getState().saveError).toBe(true);
  fail = false;
  flushPreferences();
  expect(usePreferences.getState().saveError).toBe(false);
  usePreferences.setState({ songs: {} });
  jest.mocked(getAllItems).mockImplementation(async (query) => {
    const value = saved.get("experience")!;
    if (query.fields?.startsWith("length")) return [{ length: value.length }];
    if (query.fields?.startsWith("substr")) return [{ value }];
    return [...saved.entries()]
      .filter(([key]) => key.startsWith("song:"))
      .map(([key, value]) => ({ key, value }));
  });
  await loadPreferences();
  expect(usePreferences.getState().songs[17]).toMatchObject({
    cover,
    favorite: true,
    position: 125,
    shapes: { F: 3 },
    tempo: 92
  });
});

test("exported backup retains artist, lyrics, cover and chord shapes", async () => {
  const contentSource = {
    name: "GuitareTab",
    url: "https://www.guitaretab.com/e/eagles/286856.html"
  };
  usePreferences
    .getState()
    .updateSong(17, { cover, shapes: { Am: 2 }, contentSource });
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 17,
      title: "Song",
      band_name: "Artist",
      content: "Am C\nWords",
      youtube_music: null,
      youtobe_lesson: null
    }
  ]);
  jest.mocked(FileSystem.writeFile).mockResolvedValue(undefined);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: 1000 } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest.mocked(saveDocuments).mockResolvedValue([
    {
      uri: "content://backup/library.json",
      name: "library.json",
      error: null
    }
  ]);
  await exportLibrary();
  const [, text] = jest.mocked(FileSystem.writeFile).mock.calls[0];
  const restored = parseLibraryBackup(text);
  expect(restored[0]).toMatchObject({
    title: "Song",
    band_name: "Artist",
    content: "Am C\nWords",
    preferences: { cover, shapes: { Am: 2 }, contentSource }
  });
  expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
  expect(() => parseLibraryBackup('{"format":"broken"}')).toThrow(
    "BackupInvalid"
  );
});

test.each([false, true])(
  "restoration publishes imported preferences only after a successful commit (failure: %s)",
  async (fail) => {
    usePreferences.getState().updateSong(9, { favorite: true, tempo: 92 });
    const original = { ...usePreferences.getState().songs };
    const songs = parseLibraryBackup(
      JSON.stringify({
        format: "freetune-library",
        version: 1,
        songs: [
          {
            title: "Imported",
            content: "Am C\nWords",
            band_name: "",
            youtube_music: "",
            youtobe_lesson: "",
            preferences: { cover, favorite: true, shapes: { Am: 2 } }
          }
        ]
      })
    );
    const executeSql: SQLTransaction["executeSql"] = jest.fn(
      (sql, args, success) => {
        success?.(
          { executeSql },
          {
            insertId: 42,
            rowsAffected: 1,
            rows: { length: 0, item: () => undefined }
          }
        );
      }
    );
    jest.mocked(db.transaction).mockImplementation((body) => {
      body({ executeSql });
    });
    const pending = restoreLibrary(songs);
    expect(usePreferences.getState().songs).toEqual(original);
    const commit = jest.mocked(db.transaction).mock.calls.at(-1)!;
    const write = jest
      .mocked(executeSql)
      .mock.calls.filter(([sql]) => sql.startsWith("INSERT OR REPLACE"))
      .at(-1)!;
    expect(JSON.parse(String(write[1]?.[1]))).toMatchObject({
      cover,
      favorite: true,
      shapes: { Am: 2 }
    });
    if (fail) {
      const error = Object.assign(new Error("disk full"), { code: 1 });
      commit[1]?.(error);
      await expect(pending).rejects.toBe(error);
      expect(usePreferences.getState().songs).toEqual(original);
    } else {
      commit[2]?.();
      await expect(pending).resolves.toEqual({ added: 1, skipped: 0 });
      expect(usePreferences.getState().songs[42]).toMatchObject({
        cover,
        favorite: true,
        shapes: { Am: 2 }
      });
    }
  }
);

test("many covers never create a single oversized settings row", () => {
  const writes: string[] = [];
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({
      executeSql: (_sql, args) => {
        if (args?.[1]) writes.push(String(args[1]));
      }
    });
    success?.();
  });
  for (let id = 1; id <= 144; id++)
    usePreferences
      .getState()
      .updateSong(id, { cover: "data:image/jpeg;base64," + "a".repeat(15000) });
  flushPreferences();
  expect(Math.max(...writes.map((x) => x.length))).toBeLessThan(400000);
  expect(writes.filter((x) => x.includes("data:image/jpeg"))).toHaveLength(144);
});

test("existing oversized backup fields remain exportable and restorable", async () => {
  jest
    .mocked(getAllItems)
    .mockResolvedValue([
      {
        id: 1,
        title: "a".repeat(1001),
        content: "Am\nWords",
        band_name: "",
        youtube_music: "",
        youtobe_lesson: ""
      }
    ]);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: 2000 } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest
    .mocked(saveDocuments)
    .mockResolvedValue([
      { uri: "content://backup", name: "backup.json", error: null }
    ]);
  await exportLibrary();
  expect(
    parseLibraryBackup(jest.mocked(FileSystem.writeFile).mock.calls[0][1])[0]
      .title
  ).toHaveLength(1001);
});

test.each([false, true])(
  "large legacy preferences migrate in bounded reads and publish only on commit (failure: %s)",
  async (fail) => {
    const legacy = JSON.stringify({
      instrument: "chromatic",
      songs: Object.fromEntries(
        Array.from({ length: 144 }, (_, i) => [
          i + 1,
          {
            cover: "data:image/jpeg;base64," + "a".repeat(15000),
            favorite: true,
            capo: 2
          }
        ])
      )
    });
    expect(legacy.length).toBeGreaterThan(2 * 1024 * 1024);
    jest.mocked(getAllItems).mockImplementation(async (query) => {
      if (query.fields === "length(value) AS length")
        return [{ length: legacy.length }];
      const match = query.fields?.match(
        /^substr\(value, (\d+), 65536\) AS value$/
      );
      if (match)
        return [
          {
            value: legacy.slice(
              Number(match[1]) - 1,
              Number(match[1]) - 1 + 65536
            )
          }
        ];
      if (query.parameters?.[0] === "song:%") return [];
      throw new Error("Oversized CursorWindow read");
    });
    const writes: unknown[][] = [];
    jest.mocked(db.transaction).mockImplementation((body, error, success) => {
      body({
        executeSql: (_sql, args) => {
          if (args) writes.push(args);
        }
      });
      if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
      else success?.();
    });
    if (fail) {
      await expect(loadPreferences()).rejects.toThrow("disk full");
      expect(usePreferences.getState().songs).toEqual({});
    } else {
      await loadPreferences();
      expect(Object.keys(usePreferences.getState().songs)).toHaveLength(144);
      expect(usePreferences.getState().songs[144]).toMatchObject({
        favorite: true,
        capo: 2
      });
      expect(
        writes.filter((args) => /^song:\d+:\d+$/.test(String(args[0])))
      ).toHaveLength(144);
      expect(
        String(writes.find((args) => args[0] === "experience")?.[1])
      ).not.toContain("data:image");
    }
  }
);


test("backup rejects a single text row too large for bounded SQLite reads",()=>{
  expect(()=>parseLibraryBackup(JSON.stringify({format:"freetune-library",version:1,songs:[{title:"Title",content:"a".repeat(400001),band_name:"",youtube_music:"",youtobe_lesson:"",preferences:{}}]}))).toThrow("BackupInvalid");
});
