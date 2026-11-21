import { songFieldLimits } from "../@interfaces";
import { db } from "./database";
import { getAllItems } from "./database/crud";
import {
  normalizeSongPreferences,
  preserveSongPreferenceChanges,
  SongPreferences,
  suspendPreferenceSaving,
  usePreferences,
  writePreferences
} from "./preferences";
import {
  legacyTablatureText,
  normalizeTablature,
  Tablature,
  tablatureText
} from "./tablature";

export const TAB_LIBRARY_PAGE_SIZE = 30;
export interface TablatureSong {
  id: number;
  title: string;
  band_name?: string;
}

const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

export async function listTablatureSongs(
  search = "",
  onlyTabs = true,
  offset = 0
): Promise<TablatureSong[]> {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid pagination");
  const ids = Object.entries(usePreferences.getState().songs)
    .filter(
      ([, song]) =>
        !!(song.tablature?.notes.length || song.tablature?.rests?.length)
    )
    .map(([id]) => Number(id))
    .filter(validId);
  if (onlyTabs && !ids.length) return [];
  const term = search
    .trim()
    .toLowerCase()
    .replace(/[!%_]/g, (character) => `!${character}`);
  const rows: TablatureSong[] = [];
  await new Promise<void>((resolve, reject) =>
    db.transaction(
      (tx) =>
        tx.executeSql(
          `SELECT s.id, s.title, b.name AS band_name FROM songs s LEFT JOIN bands b ON s.band_id = b.id WHERE LOWER(COALESCE(b.search_text_lower, '') || ' ' || COALESCE(s.search_text_lower, s.title)) LIKE ? ESCAPE '!'${onlyTabs ? ` AND s.id IN (${ids.join(",")})` : ""} ORDER BY s.title COLLATE NOCASE, s.id LIMIT ? OFFSET ?`,
          [`%${term}%`, TAB_LIBRARY_PAGE_SIZE, offset],
          (_, result) => {
            for (let index = 0; index < result.rows.length; index++)
              rows.push(result.rows.item(index));
          }
        ),
      reject,
      resolve
    )
  );
  return rows;
}

export async function getTablatureSong(
  id: number
): Promise<(TablatureSong & { tablature?: Tablature }) | undefined> {
  if (!validId(id)) throw new Error("SongMissing");
  const [song] = await getAllItems<TablatureSong>({
    tableName: "songs",
    fields: "songs.id, songs.title, bands.name AS band_name",
    joins: ["LEFT JOIN bands ON songs.band_id = bands.id"],
    filters: "songs.id = ?",
    parameters: [id],
    limit: 1
  });
  return song
    ? {
        ...song,
        tablature: normalizeTablature(
          usePreferences.getState().songs[id]?.tablature
        )
      }
    : undefined;
}

export async function saveTablature({
  id,
  title,
  tablature
}: {
  id?: number;
  title: string;
  tablature: Tablature;
}): Promise<number> {
  const tab = normalizeTablature(tablature);
  if (!tab || (!tab.notes.length && !tab.rests?.length))
    throw new Error("TablatureInvalid");
  const name = title.trim();
  if (!name) throw new Error("FieldRequired");
  if (name.length > songFieldLimits.title) throw new Error("FileTooLarge");
  if (id !== undefined && !validId(id)) throw new Error("SongMissing");
  const preview = tablatureText(tab);
  if (preview.length > songFieldLimits.content) throw new Error("FileTooLarge");
  const resume = suspendPreferenceSaving();
  let savedId = id ?? 0;
  let persisted: Record<string, SongPreferences> | undefined;
  let snapshot: SongPreferences | undefined;
  let committed = false;
  try {
    await new Promise<void>((resolve, reject) =>
      db.transaction(
        (tx) => {
          const savePreferences = (songId: number) => {
            savedId = songId;
            const state = usePreferences.getState();
            snapshot = state.songs[songId];
            persisted = {
              [songId]: normalizeSongPreferences({
                ...snapshot,
                tablature: tab
              })
            };
            writePreferences(tx, {
              ...state,
              songs: { ...state.songs, ...persisted }
            });
          };
          if (id === undefined) {
            tx.executeSql(
              "INSERT INTO songs (title, content, band_id, youtube_music, youtobe_lesson, search_text_lower) VALUES (?, ?, ?, ?, ?, ?)",
              [name, preview, null, "", "", name.toLowerCase()],
              (_, result) => savePreferences(result.insertId)
            );
            return;
          }
          tx.executeSql(
            "SELECT content FROM songs WHERE id = ?",
            [id],
            (_, result) => {
              if (result.rows.length !== 1) throw new Error("SongMissing");
              const original = result.rows.item(0).content as string;
              const previous = usePreferences.getState().songs[id]?.tablature;
              const content =
                previous &&
                (original === tablatureText(previous) ||
                  original === legacyTablatureText(previous))
                  ? preview
                  : original;
              tx.executeSql(
                "UPDATE songs SET title = ?, content = ?, search_text_lower = ? WHERE id = ?",
                [name, content, name.toLowerCase(), id],
                (_, update) => {
                  if (update.rowsAffected !== 1) throw new Error("SongMissing");
                  savePreferences(id);
                }
              );
            }
          );
        },
        reject,
        resolve
      )
    );
    committed = true;
    usePreferences.setState((state) => ({
      songs: {
        ...state.songs,
        [savedId]: preserveSongPreferenceChanges(
          persisted?.[savedId],
          snapshot,
          state.songs[savedId]
        )
      }
    }));
    return savedId;
  } finally {
    resume(committed ? persisted : undefined);
  }
}
