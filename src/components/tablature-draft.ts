import { songFieldLimits } from "../@interfaces";
import { db } from "./database";
import { normalizeTablature, Tablature } from "./tablature";

export interface TablatureDraft {
  version: 1;
  tab: Tablature;
  savedTab: Tablature;
  song: { id: number; title: string } | null;
}

const PREFIX = "tablature-draft:";
const CHUNK_SIZE = 65536;
const MAX_CHUNKS = 16;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = () => new Error("TabDraftInvalid");

function normalizeDraft(value: unknown): TablatureDraft {
  if (!record(value) || value.version !== 1) throw invalid();
  const tab = normalizeTablature(value.tab);
  const savedTab = normalizeTablature(value.savedTab);
  if (!tab || !savedTab) throw invalid();
  const song = value.song;
  let link: TablatureDraft["song"] = null;
  if (song !== null) {
    if (
      !record(song) ||
      typeof song.id !== "number" ||
      !Number.isSafeInteger(song.id) ||
      song.id <= 0 ||
      typeof song.title !== "string" ||
      !song.title.trim() ||
      song.title.length > songFieldLimits.title
    )
      throw invalid();
    link = { id: song.id, title: song.title };
  }
  return {
    version: 1,
    tab,
    savedTab,
    song: link
  };
}

// Reads share the queue so a restore requested immediately after a flush sees
// that committed draft. A failed write must not block later saves or clearing.
let pending: Promise<void> = Promise.resolve();
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function readTablatureDraft(): Promise<TablatureDraft | null> {
  return ordered(
    () =>
      new Promise<TablatureDraft | null>((resolve, reject) => {
        let draft: TablatureDraft | null = null;
        db.transaction(
          (tx) =>
            tx.executeSql(
              "SELECT key, length(value) AS size, substr(value, 1, ?) AS value FROM settings WHERE key LIKE ? ORDER BY key LIMIT ?",
              [CHUNK_SIZE + 1, `${PREFIX}%`, MAX_CHUNKS + 2],
              (_, result) => {
                if (!result.rows.length) return;
                if (result.rows.length > MAX_CHUNKS + 1) throw invalid();
                const values = new Map<string, string>();
                for (let index = 0; index < result.rows.length; index++) {
                  const row = result.rows.item(index);
                  if (
                    typeof row.key !== "string" ||
                    typeof row.value !== "string" ||
                    typeof row.size !== "number" ||
                    row.size > CHUNK_SIZE ||
                    row.value.length > CHUNK_SIZE
                  )
                    throw invalid();
                  values.set(row.key, row.value);
                }
                const metadata = values.get(`${PREFIX}meta`);
                if (!metadata) throw invalid();
                let header: unknown;
                try {
                  header = JSON.parse(metadata);
                } catch {
                  throw invalid();
                }
                if (
                  !record(header) ||
                  header.version !== 1 ||
                  typeof header.parts !== "number" ||
                  !Number.isInteger(header.parts) ||
                  header.parts < 1 ||
                  header.parts > MAX_CHUNKS ||
                  typeof header.length !== "number" ||
                  !Number.isInteger(header.length) ||
                  header.length < 1 ||
                  header.length > CHUNK_SIZE * MAX_CHUNKS ||
                  values.size !== header.parts + 1
                )
                  throw invalid();
                const chunks: string[] = [];
                for (let part = 0; part < header.parts; part++) {
                  const chunk = values.get(`${PREFIX}${part}`);
                  if (!chunk) throw invalid();
                  chunks.push(chunk);
                }
                const text = chunks.join("");
                if (text.length !== header.length) throw invalid();
                try {
                  draft = normalizeDraft(JSON.parse(text));
                } catch {
                  throw invalid();
                }
              }
            ),
          reject,
          () => resolve(draft)
        );
      })
  );
}

export async function writeTablatureDraft(
  draft: TablatureDraft | null
): Promise<void> {
  // Snapshot before queueing: a caller may continue editing this object while
  // an earlier SQLite transaction is still in flight.
  const text = draft === null ? null : JSON.stringify(normalizeDraft(draft));
  if (text && text.length > CHUNK_SIZE * MAX_CHUNKS) throw invalid();
  const chunks: string[] = [];
  if (text) {
    for (let start = 0; start < text.length; ) {
      let end = Math.min(text.length, start + CHUNK_SIZE);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      chunks.push(text.slice(start, end));
      start = end;
    }
    if (chunks.length > MAX_CHUNKS) throw invalid();
  }
  return ordered(
    () =>
      new Promise<void>((resolve, reject) =>
        db.transaction(
          (tx) => {
            tx.executeSql("DELETE FROM settings WHERE key LIKE ?", [
              `${PREFIX}%`
            ]);
            if (!text) return;
            tx.executeSql(
              "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
              [
                `${PREFIX}meta`,
                JSON.stringify({
                  version: 1,
                  parts: chunks.length,
                  length: text.length
                })
              ]
            );
            chunks.forEach((chunk, part) =>
              tx.executeSql(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                [`${PREFIX}${part}`, chunk]
              )
            );
          },
          reject,
          resolve
        )
      )
  );
}
