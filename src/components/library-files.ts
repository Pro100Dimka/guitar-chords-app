import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments
} from "@react-native-documents/picker";
import { Dirs, FileSystem } from "react-native-file-access";
import { db } from "./database";
import { getAllItems } from "./database/crud";
import {
  normalizeSongPreferences,
  SongPreferences,
  suspendPreferenceSaving,
  usePreferences
} from "./preferences";

const maxBytes = 5 * 1024 * 1024;
export const fileCanceled = (error: unknown) =>
  isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;

export async function readLibraryFile(kind: "song" | "backup") {
  const [file] = await pick({ allowMultiSelection: false });
  const extension = file.name?.split(".").pop()?.toLowerCase() ?? "";
  if (
    !(
      kind === "backup" ? ["json"] : ["txt", "pro", "cho", "chordpro"]
    ).includes(extension)
  )
    throw new Error("FileFormatError");
  if (file.size !== null && file.size > maxBytes)
    throw new Error("FileTooLarge");
  const [copy] = await keepLocalCopy({
    destination: "cachesDirectory",
    files: [{ uri: file.uri, fileName: `freetune-import-${Date.now()}.txt` }]
  });
  if (copy.status !== "success") throw new Error("FileReadError");
  try {
    const stat = await FileSystem.stat(copy.localUri);
    if (stat.size > maxBytes) throw new Error("FileTooLarge");
    const text = (await FileSystem.readFile(copy.localUri, "utf8"))
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
    if (text.includes("\0") || text.includes("\uFFFD"))
      throw new Error("FileEncodingError");
    return { text, name: file.name ?? "" };
  } finally {
    await FileSystem.unlink(copy.localUri).catch(() => undefined);
  }
}

export function importedSong(text: string, name: string) {
  if (text.length > 200000) throw new Error("FileTooLarge");
  const title =
    text.match(/^\s*\{(?:title|t):\s*([^}]+)\}\s*$/im)?.[1]?.trim() ??
    name.replace(/\.[^.]+$/, "");
  // Leave musical directives visible for review, without silently changing pitch.
  const content = text.replace(/^\s*\{(?:title|t):[^}]+\}\s*$/gim, "").trim();
  if (!content) throw new Error("FileFormatError");
  return { title, content };
}

interface BackupSong {
  title: string;
  content: string;
  band_name: string;
  youtube_music: string;
  youtobe_lesson: string;
  preferences: SongPreferences;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function parseLibraryBackup(text: string): BackupSong[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("BackupInvalid");
  }
  if (
    !record(data) ||
    data.format !== "freetune-library" ||
    data.version !== 1 ||
    !Array.isArray(data.songs) ||
    data.songs.length > 2000
  )
    throw new Error("BackupInvalid");
  return data.songs.map((song: unknown) => {
    if (!record(song)) throw new Error("BackupInvalid");
    const strings: Record<string, string> = {};
    for (const [key, limit] of Object.entries({
      title: 1000,
      content: 200000,
      band_name: 1000,
      youtube_music: 4000,
      youtobe_lesson: 4000
    })) {
      const value = song[key];
      if (typeof value !== "string" || value.length > limit)
        throw new Error("BackupInvalid");
      strings[key] = value;
    }
    if (!strings.title.trim() || !strings.content.trim())
      throw new Error("BackupInvalid");
    return {
      title: strings.title,
      content: strings.content,
      band_name: strings.band_name,
      youtube_music: strings.youtube_music,
      youtobe_lesson: strings.youtobe_lesson,
      preferences: normalizeSongPreferences(song.preferences)
    };
  });
}

export async function exportLibrary() {
  const songs = await getAllItems<BackupSong & { id: number }>({
    tableName: "songs",
    fields: "songs.*, COALESCE(bands.name, '') AS band_name",
    joins: ["LEFT JOIN bands ON songs.band_id = bands.id"]
  });
  if (
    songs.length > 2000 ||
    songs.reduce(
      (size, song) => size + song.content.length + song.title.length,
      0
    ) > maxBytes
  )
    throw new Error("FileTooLarge");
  const preferences = usePreferences.getState().songs;
  const text = JSON.stringify(
    {
      format: "freetune-library",
      version: 1,
      createdAt: new Date().toISOString(),
      songs: songs.map((song) => ({
        title: song.title,
        content: song.content,
        band_name: song.band_name,
        youtube_music: song.youtube_music ?? "",
        youtobe_lesson: song.youtobe_lesson ?? "",
        preferences: normalizeSongPreferences(preferences[song.id])
      }))
    },
    null,
    2
  );
  // Ensure every exported file can also be restored by this version.
  parseLibraryBackup(text);
  const name = `FreeTune-library-${new Date().toISOString().slice(0, 10)}.json`;
  const path = `${Dirs.CacheDir}/${name}`;
  try {
    await FileSystem.writeFile(path, text, "utf8");
    if ((await FileSystem.stat(path)).size > maxBytes)
      throw new Error("FileTooLarge");
    const results = await saveDocuments({
      sourceUris: [encodeURI(`file://${path}`)],
      fileName: name,
      mimeType: "application/json",
      copy: true
    });
    if (results.some((result) => result.error))
      throw new Error("FileSaveError");
  } finally {
    await FileSystem.unlink(path).catch(() => undefined);
  }
}

export async function restoreLibrary(songs: BackupSong[]) {
  const resumeSaving = suspendPreferenceSaving();
  const addedPreferences: Record<string, SongPreferences> = {};
  let added = 0;
  try {
    await new Promise<void>((resolve, reject) =>
      db.transaction(
        (tx) => {
          const insertNext = (index: number) => {
            const song = songs[index];
            if (!song) {
              const {
                instrument,
                tuning,
                customTuning,
                tunerSound,
                chromaticOctave,
                autoDetect,
                stringIndex,
                tab,
                songs: currentSongs
              } = usePreferences.getState();
              tx.executeSql(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                [
                  "experience",
                  JSON.stringify({
                    instrument,
                    tuning,
                    customTuning,
                    tunerSound,
                    chromaticOctave,
                    autoDetect,
                    stringIndex,
                    tab,
                    songs: { ...currentSongs, ...addedPreferences }
                  })
                ]
              );
              return;
            }
            const { title, content, band_name, youtube_music, youtobe_lesson } =
              song;
            tx.executeSql(
              "SELECT songs.id FROM songs LEFT JOIN bands ON bands.id = songs.band_id WHERE title = ? AND content = ? AND COALESCE(bands.name, '') = ? AND COALESCE(youtube_music, '') = ? AND COALESCE(youtobe_lesson, '') = ? LIMIT 1",
              [title, content, band_name, youtube_music, youtobe_lesson],
              (_, existing) => {
                if (existing.rows.length) {
                  insertNext(index + 1);
                  return;
                }
                const insertSong = (bandId: number | null) =>
                  tx.executeSql(
                    "INSERT INTO songs (title, content, band_id, youtube_music, youtobe_lesson, search_text_lower) VALUES (?, ?, ?, ?, ?, ?)",
                    [
                      title,
                      content,
                      bandId,
                      youtube_music,
                      youtobe_lesson,
                      title.toLowerCase()
                    ],
                    (_tx, result) => {
                      addedPreferences[result.insertId] = song.preferences;
                      added++;
                      insertNext(index + 1);
                    }
                  );
                if (!band_name) {
                  insertSong(null);
                  return;
                }
                tx.executeSql(
                  "SELECT id FROM bands WHERE name = ? LIMIT 1",
                  [band_name],
                  (_tx, bands) => {
                    if (bands.rows.length) insertSong(bands.rows.item(0).id);
                    else
                      tx.executeSql(
                        "INSERT INTO bands (name, search_text_lower) VALUES (?, ?)",
                        [band_name, band_name.toLowerCase()],
                        (_insertTx, result) => insertSong(result.insertId)
                      );
                  }
                );
              }
            );
          };
          insertNext(0);
        },
        reject,
        resolve
      )
    );
    usePreferences.setState((state) => ({
      songs: { ...state.songs, ...addedPreferences }
    }));
    return { added, skipped: songs.length - added };
  } finally {
    resumeSaving();
  }
}
