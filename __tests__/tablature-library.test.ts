import type { SQLResultSet, SQLTransaction } from "react-native-sqlite-2";
import { db } from "../src/components/database";
import { getAllItems } from "../src/components/database/crud";
import {
  defaultSongPreferences,
  flushPreferences,
  usePreferences
} from "../src/components/preferences";
import {
  getTablatureSong,
  listTablatureSongs,
  saveTablature,
  TAB_LIBRARY_PAGE_SIZE
} from "../src/components/tablature-library";
import {
  emptyTablature,
  legacyTablatureText,
  normalizeTablature,
  tablatureText
} from "../src/components/tablature";
import { defaultTabPractice } from "../src/components/tablature-practice";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));

const tab = normalizeTablature({
  version: 1,
  tempo: 90,
  beatsPerBar: 4,
  notes: [
    { string: 0, fret: 0, tick: 0 },
    { string: 5, fret: 12, tick: 24 }
  ]
})!;
const changed = normalizeTablature({
  ...tab,
  notes: [{ string: 1, fret: 3, tick: 12 }]
})!;
let content: string;
let missing: boolean;
let autoCommit: boolean;
let executeSql: jest.MockedFunction<SQLTransaction["executeSql"]>;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  content = "Am C\nOriginal lyrics";
  missing = false;
  autoCommit = true;
  executeSql = jest.fn((sql, _args, success) => {
    const rows =
      sql.startsWith("SELECT content") && !missing ? [{ content }] : [];
    success?.({ executeSql }, {
      insertId: 42,
      rowsAffected: missing ? 0 : 1,
      rows: { length: rows.length, item: (index: number) => rows[index] }
    } as SQLResultSet);
  });
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    try {
      body({ executeSql });
      if (autoCommit) success?.();
    } catch (reason) {
      error?.(Object.assign(reason as Error, { code: 1 }));
    }
  });
  await flushPreferences();
  usePreferences.setState({ songs: {}, saveError: false });
  jest.mocked(db.transaction).mockClear();
  executeSql.mockClear();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("practice preferences commit with a saved tab and survive later score-only saves", async () => {
  const practice = {
    ...defaultTabPractice(),
    metronome: true,
    countInBars: 1 as const
  };
  const id = await saveTablature({
    title: "Practice riff",
    tablature: tab,
    practice
  });
  const row = executeSql.mock.calls.find(
    ([sql, args]) =>
      sql.startsWith("INSERT OR REPLACE") && args?.[0] === `song:${id}:0`
  )!;
  expect(JSON.parse(String(row[1]?.[1])).tabPractice).toEqual(practice);
  await saveTablature({ id, title: "Practice riff", tablature: changed });
  jest.mocked(getAllItems).mockResolvedValue([{ id, title: "Practice riff" }]);
  expect(await getTablatureSong(id)).toEqual({
    id,
    title: "Practice riff",
    tablature: changed,
    practice
  });
});

test.each([false, true])(
  "new tabs publish only after commit and retain the draft on failure (%s)",
  async (fail) => {
    autoCommit = false;
    const pending = saveTablature({ title: " My riff ", tablature: tab });
    const transaction = jest.mocked(db.transaction).mock.calls.at(-1)!;
    expect(usePreferences.getState().songs[42]).toBeUndefined();
    const insert = executeSql.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO songs")
    )!;
    expect(insert[1]).toEqual([
      "My riff",
      tablatureText(tab),
      null,
      "",
      "",
      "my riff"
    ]);
    const settings = executeSql.mock.calls.find(
      ([sql, args]) =>
        sql.startsWith("INSERT OR REPLACE") && args?.[0] === "song:42:0"
    )!;
    expect(JSON.parse(String(settings[1]?.[1])).tablature).toEqual(tab);
    autoCommit = true;
    if (fail) {
      const error = Object.assign(new Error("disk full"), { code: 1 });
      transaction[1]?.(error);
      await expect(pending).rejects.toBe(error);
      expect(usePreferences.getState().songs[42]).toBeUndefined();
    } else {
      transaction[2]?.();
      await expect(pending).resolves.toBe(42);
      expect(usePreferences.getState().songs[42].tablature).toEqual(tab);
    }
  }
);

test("editing a migrated riff refreshes its legacy generated preview", async () => {
  content = legacyTablatureText(tab);
  usePreferences.setState({
    songs: { 7: { ...defaultSongPreferences, tablature: tab } }
  });
  await saveTablature({ id: 7, title: "Riff", tablature: changed });
  const update = executeSql.mock.calls.find(([sql]) =>
    sql.startsWith("UPDATE songs")
  )!;
  expect(update[1]?.[1]).toBe(tablatureText(changed));
});

test("saving migrated note releases updates their old generated text after preferences reload", async () => {
  const migrated = normalizeTablature({
    ...emptyTablature(),
    notes: [
      { string: 0, fret: 0, tick: 0, duration: 96 },
      { string: 0, fret: 3, tick: 24, duration: 12 }
    ],
    rests: [{ tick: 36, duration: 12 }]
  })!;
  content = tablatureText(migrated).replace("E0@1=1/4", "E0@1=1");
  usePreferences.setState({
    songs: { 7: { ...defaultSongPreferences, tablature: migrated } }
  });
  await saveTablature({ id: 7, title: "Riff", tablature: changed });
  const update = executeSql.mock.calls.find(([sql]) =>
    sql.startsWith("UPDATE songs")
  )!;
  expect(update[1]?.[1]).toBe(tablatureText(changed));
});

test("a rest-only part can be saved and is listed with other tabs", async () => {
  const rest = normalizeTablature({
    ...emptyTablature(),
    rests: [{ tick: 0, duration: 96 }],
    barCount: 2
  })!;
  await expect(
    saveTablature({ title: "Tacit intro", tablature: rest })
  ).resolves.toBe(42);
  expect(usePreferences.getState().songs[42].tablature).toEqual(rest);
  executeSql.mockClear();
  await listTablatureSongs();
  expect(executeSql.mock.calls[0][0]).toContain("s.id IN (42)");
});

test("attaching tabs preserves lyrics, song metadata and later preference edits", async () => {
  usePreferences.setState({
    songs: {
      7: {
        ...defaultSongPreferences,
        favorite: false,
        capo: 3,
        sourceTuning: "D A D G B E",
        shapes: { Am: 2 }
      }
    }
  });
  autoCommit = false;
  const pending = saveTablature({ id: 7, title: "Existing", tablature: tab });
  const transaction = jest.mocked(db.transaction).mock.calls.at(-1)!;
  const update = executeSql.mock.calls.find(([sql]) =>
    sql.startsWith("UPDATE songs")
  )!;
  expect(update[0]).not.toMatch(/band_id|youtube_music|youtobe_lesson/);
  expect(update[1]).toEqual(["Existing", content, "existing", 7]);
  usePreferences.getState().updateSong(7, { favorite: true });
  autoCommit = true;
  transaction[2]?.();
  await expect(pending).resolves.toBe(7);
  await flushPreferences();
  expect(usePreferences.getState().songs[7]).toMatchObject({
    favorite: true,
    capo: 3,
    sourceTuning: "D A D G B E",
    shapes: { Am: 2 },
    tablature: tab
  });
});

test.each([false, true])(
  "editing a riff refreshes only its unchanged generated preview (custom text: %s)",
  async (customText) => {
    content = customText ? "My own text" : tablatureText(tab);
    usePreferences.setState({
      songs: { 7: { ...defaultSongPreferences, tablature: tab } }
    });
    await saveTablature({ id: 7, title: "Riff", tablature: changed });
    const update = executeSql.mock.calls.find(([sql]) =>
      sql.startsWith("UPDATE songs")
    )!;
    expect(update[1]?.[1]).toBe(customText ? content : tablatureText(changed));
    expect(usePreferences.getState().songs[7].tablature).toEqual(changed);
  }
);

test("saving a deleted song rejects without creating a replacement or orphan preferences", async () => {
  missing = true;
  await expect(
    saveTablature({ id: 7, title: "Deleted", tablature: tab })
  ).rejects.toThrow("SongMissing");
  expect(
    executeSql.mock.calls.some(([sql]) =>
      /^(INSERT|UPDATE|DELETE)/.test(String(sql))
    )
  ).toBe(false);
  expect(usePreferences.getState().songs[7]).toBeUndefined();
});

test("empty or invalid notes never start a database transaction", async () => {
  await expect(
    saveTablature({ title: "Empty", tablature: { ...tab, notes: [] } })
  ).rejects.toThrow("TablatureInvalid");
  await expect(
    saveTablature({
      title: "Invalid",
      tablature: { ...tab, notes: [{ string: 6, fret: 0, tick: 0 }] }
    })
  ).rejects.toThrow("TablatureInvalid");
  expect(db.transaction).not.toHaveBeenCalled();
});

test("tab library uses literal bound search, stable pagination and more than 999 tab IDs", async () => {
  usePreferences.setState({
    songs: Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [
        index + 1,
        { ...defaultSongPreferences, tablature: tab }
      ])
    )
  });
  const rows = [{ id: 1001, title: "100%_! Love", band_name: "Artist" }];
  executeSql.mockImplementation((_sql, _args, success) =>
    success?.(
      { executeSql },
      {
        insertId: 0,
        rowsAffected: 0,
        rows: { length: rows.length, item: (index: number) => rows[index] }
      }
    )
  );
  await expect(listTablatureSongs("100%_! Love", true, 30)).resolves.toEqual(
    rows
  );
  const [sql, args] = executeSql.mock.calls[0];
  expect(sql).toContain("s.id IN (1,2,3,");
  expect(sql).toContain(
    "ORDER BY s.title COLLATE NOCASE, s.id LIMIT ? OFFSET ?"
  );
  expect(args).toEqual(["%100!%!_!! love%", TAB_LIBRARY_PAGE_SIZE, 30]);
  expect(sql).not.toContain("100%_! Love");
});

test("empty tab collections avoid a query while all-song selection remains available", async () => {
  await expect(listTablatureSongs()).resolves.toEqual([]);
  expect(db.transaction).not.toHaveBeenCalled();
  await listTablatureSongs("", false);
  expect(executeSql.mock.calls[0][0]).not.toContain("IN (");
});

test("opening a library song returns its saved tabs and rejects stale IDs", async () => {
  usePreferences.setState({
    songs: { 7: { ...defaultSongPreferences, tablature: tab } }
  });
  jest.mocked(getAllItems).mockResolvedValue([{ id: 7, title: "Riff" }]);
  await expect(getTablatureSong(7)).resolves.toMatchObject({
    id: 7,
    title: "Riff",
    tablature: tab
  });
  jest.mocked(getAllItems).mockResolvedValue([]);
  await expect(getTablatureSong(7)).resolves.toBeUndefined();
  await expect(getTablatureSong(-1)).rejects.toThrow("SongMissing");
});
