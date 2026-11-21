import type { SQLTransaction } from "react-native-sqlite-2";
import { db } from "../src/components/database";
import {
  readTablatureDraft,
  TablatureDraft,
  writeTablatureDraft
} from "../src/components/tablature-draft";
import {
  emptyTablature,
  normalizeTablature
} from "../src/components/tablature";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));

let rows: Map<string, string>;
let autoCommit: boolean;
let commits: Array<{ commit: () => void; fail: () => void }>;
const draft = (fret = 3): TablatureDraft => ({
  version: 1,
  tab: {
    version: 1,
    tempo: 90,
    beatsPerBar: 4,
    notes: [{ string: 0, fret, tick: 0 }]
  },
  savedTab: emptyTablature(),
  song: { id: 7, title: "My riff 🎸" }
});
const canonical = (value: TablatureDraft): TablatureDraft => ({
  ...value,
  tab: normalizeTablature(value.tab)!,
  savedTab: normalizeTablature(value.savedTab)!,
  song: value.song && { ...value.song }
});
const tick = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};

beforeEach(() => {
  rows = new Map();
  autoCommit = true;
  commits = [];
  jest.mocked(db.transaction).mockReset();
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    const transactionRows = new Map(rows);
    const tx: SQLTransaction = {
      executeSql: (sql, args = [], callback) => {
        let result: Array<{ key: string; value: string; size: number }> = [];
        if (sql.startsWith("SELECT")) {
          result = [...transactionRows.entries()]
            .filter(([key]) => key.startsWith("tablature-draft:"))
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, Number(args[2]))
            .map(([key, value]) => ({
              key,
              value: value.slice(0, Number(args[0])),
              size: value.length
            }));
        } else if (sql.startsWith("DELETE")) {
          for (const key of transactionRows.keys())
            if (key.startsWith("tablature-draft:")) transactionRows.delete(key);
        } else if (sql.startsWith("INSERT")) {
          transactionRows.set(String(args[0]), String(args[1]));
        }
        callback?.(tx, {
          insertId: 0,
          rowsAffected: 1,
          rows: {
            length: result.length,
            item: (index: number) => result[index]
          }
        });
      }
    };
    try {
      body(tx);
      const control = {
        commit: () => {
          rows = transactionRows;
          success?.();
        },
        fail: () => error?.(Object.assign(new Error("disk full"), { code: 1 }))
      };
      if (autoCommit) control.commit();
      else commits.push(control);
    } catch (reason) {
      error?.(Object.assign(reason as Error, { code: 1 }));
    }
  });
});

test("restores a canonical document and its saved baseline without changing song settings", async () => {
  rows.set("song:7:0", "keep song preferences");
  await expect(readTablatureDraft()).resolves.toBeNull();
  const value = draft();
  await writeTablatureDraft(value);
  await expect(readTablatureDraft()).resolves.toEqual(canonical(value));
  expect(rows.get("song:7:0")).toBe("keep song preferences");
  await writeTablatureDraft(null);
  await expect(readTablatureDraft()).resolves.toBeNull();
  expect(rows.get("song:7:0")).toBe("keep song preferences");
});

test("takes an immutable snapshot before a pending database write", async () => {
  autoCommit = false;
  const value = draft();
  const expected = canonical(value);
  const writing = writeTablatureDraft(value);
  value.tab.notes[0].fret = 19;
  value.song!.title = "Later title";
  await tick();
  expect(rows.size).toBe(0);
  expect(commits).toHaveLength(1);
  commits.shift()!.commit();
  await writing;
  autoCommit = true;
  await expect(readTablatureDraft()).resolves.toEqual(expected);
});

test("a late old save cannot overwrite a newer save or clear, and failure does not block the queue", async () => {
  autoCommit = false;
  const first = writeTablatureDraft(draft(3));
  const second = writeTablatureDraft(draft(7));
  const failed = expect(second).rejects.toThrow("disk full");
  const clear = writeTablatureDraft(null);
  await tick();
  expect(commits).toHaveLength(1);
  commits.shift()!.commit();
  await first;
  await tick();
  expect(commits).toHaveLength(1);
  commits.shift()!.fail();
  await failed;
  await tick();
  expect(commits).toHaveLength(1);
  commits.shift()!.commit();
  await clear;
  autoCommit = true;
  await expect(readTablatureDraft()).resolves.toBeNull();
});

test("a restore waits for an already requested write to commit", async () => {
  autoCommit = false;
  const writing = writeTablatureDraft(draft());
  const reading = readTablatureDraft();
  await tick();
  expect(commits).toHaveLength(1);
  commits.shift()!.commit();
  await writing;
  await tick();
  expect(commits).toHaveLength(1);
  commits.shift()!.commit();
  await expect(reading).resolves.toEqual(canonical(draft()));
});

test("a complete large riff and Unicode title survive bounded chunk storage", async () => {
  const tab = {
    ...emptyTablature(),
    barCount: 128,
    notes: Array.from({ length: 2048 }, (_, index) => ({
      string: index % 6,
      fret: index % 25,
      tick: index * 6,
      duration: 6
    }))
  };
  const value: TablatureDraft = {
    version: 1,
    tab,
    savedTab: tab,
    song: { id: 7, title: "🎸".repeat(500) }
  };
  await writeTablatureDraft(value);
  const chunks = [...rows.entries()].filter(([key]) => /:\d+$/.test(key));
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(([, chunk]) => chunk.length <= 65536)).toBe(true);
  expect(
    chunks.every(
      ([, chunk]) =>
        !/^[\uDC00-\uDFFF]/.test(chunk) && !/[\uD800-\uDBFF]$/.test(chunk)
    )
  ).toBe(true);
  await expect(readTablatureDraft()).resolves.toEqual(canonical(value));
});

test.each([
  (data: Map<string, string>) => data.delete("tablature-draft:meta"),
  (data: Map<string, string>) => data.delete("tablature-draft:0"),
  (data: Map<string, string>) => data.set("tablature-draft:meta", "{}"),
  (data: Map<string, string>) => data.set("tablature-draft:extra", "stale"),
  (data: Map<string, string>) =>
    data.set("tablature-draft:0", "x".repeat(65537)),
  (data: Map<string, string>) => {
    const header = JSON.parse(data.get("tablature-draft:meta")!);
    data.set("tablature-draft:meta", JSON.stringify({ ...header, parts: 17 }));
  }
])(
  "rejects incomplete or oversized stored drafts without deleting them (%#)",
  async (damage) => {
    await writeTablatureDraft(draft());
    damage(rows);
    const damaged = [...rows.entries()];
    await expect(readTablatureDraft()).rejects.toThrow("TabDraftInvalid");
    expect([...rows.entries()]).toEqual(damaged);
  }
);

test.each([
  { version: 2 },
  { savedTab: {} },
  { song: { id: 0, title: "Riff" } },
  { song: { id: 7, title: " " } },
  { song: { id: 7, title: "x".repeat(1001) } },
  { song: undefined }
])(
  "invalid new draft never replaces the recoverable version (%j)",
  async (patch) => {
    const value = draft();
    await writeTablatureDraft(value);
    const persisted = [...rows.entries()];
    await expect(
      writeTablatureDraft({ ...value, ...patch } as TablatureDraft)
    ).rejects.toThrow("TabDraftInvalid");
    expect([...rows.entries()]).toEqual(persisted);
    await expect(readTablatureDraft()).resolves.toEqual(canonical(value));
  }
);

test("valid JSON with corrupt musical data fails restoration without being discarded", async () => {
  await writeTablatureDraft(draft());
  const value = JSON.parse(rows.get("tablature-draft:0")!);
  value.tab.notes[0].fret = 999;
  const text = JSON.stringify(value);
  rows.set("tablature-draft:0", text);
  rows.set(
    "tablature-draft:meta",
    JSON.stringify({ version: 1, parts: 1, length: text.length })
  );
  await expect(readTablatureDraft()).rejects.toThrow("TabDraftInvalid");
  expect(rows.get("tablature-draft:0")).toBe(text);
});
