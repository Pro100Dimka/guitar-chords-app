import { Alert } from "react-native";
import { t } from "../locales";
import { performanceAudio } from "./performance-audio";
import { deleteItem } from "./database/crud";
import { songFieldLimits } from "@/@interfaces";
import { transposeSong } from "../screens/song/chords";
import { sourceArrangement } from "../screens/song/rhythms";
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
  saveDocuments
} from "@react-native-documents/picker";
import { Dirs, FileSystem } from "react-native-file-access";
import ImageResizer from "@bam.tech/react-native-image-resizer";
import { toByteArray } from "base64-js";
import { db } from "./database";
import { getAllItems } from "./database/crud";
import {
  normalizeSongPreferences,
  SongPreferences,
  suspendPreferenceSaving,
  usePreferences,
  writePreferences
} from "./preferences";

const maxBytes = 5 * 1024 * 1024;
export const fileCanceled = (error: unknown) =>
  isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;

function fileRead(signal?: AbortSignal) {
  const cancelled = () =>
    Object.assign(new Error("Cancelled"), {
      code: errorCodes.OPERATION_CANCELED
    });
  if (signal?.aborted) throw cancelled();
  let stopped: Error | undefined;
  let reject!: (error: Error) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const stop = (error: Error) => {
    stopped = error;
    reject(error);
  };
  const abort = () => stop(cancelled());
  signal?.addEventListener("abort", abort, { once: true });
  return {
    wait<T>(promise: Promise<T>, discard?: (value: T) => Promise<unknown>) {
      return Promise.race([
        promise.then((value) => {
          if (stopped && discard) void discard(value).catch(() => undefined);
          return value;
        }),
        interrupted
      ]);
    },
    start() {
      timer = setTimeout(() => stop(new Error("FileReadError")), 30000);
    },
    finish() {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
}

export async function readSongCover(
  uri?: string,
  rotate = !!uri,
  signal?: AbortSignal
) {
  const read = fileRead(signal);
  let localUri: string | undefined;
  let resizedUri: string | undefined;
  try {
    if (!uri) {
      const [file] = await read.wait(
        pick({
          type: [types.images],
          allowMultiSelection: false
        })
      );
      read.start();
      if (file.size !== null && file.size > 20 * 1024 * 1024)
        throw new Error("FileTooLarge");
      const [copy] = await read.wait(
        keepLocalCopy({
          destination: "cachesDirectory",
          files: [
            {
              uri: file.uri,
              fileName: `cover-${Date.now()}-${Math.random().toString(36).slice(2)}.${file.name?.split(".").pop() ?? "jpg"}`
            }
          ]
        }),
        (copies) =>
          Promise.all(
            copies.map((copy) =>
              copy.status === "success"
                ? FileSystem.unlink(copy.localUri)
                : Promise.resolve()
            )
          )
      );
      if (copy.status !== "success") throw new Error("FileReadError");
      localUri = copy.localUri;
      if ((await read.wait(FileSystem.stat(localUri))).size > 20 * 1024 * 1024)
        throw new Error("FileTooLarge");
    } else read.start();
    const resized = await read.wait(
      ImageResizer.createResizedImage(
        uri ?? localUri!,
        384,
        384,
        "JPEG",
        82,
        rotate ? 90 : 0,
        undefined,
        false,
        { mode: "contain", onlyScaleDown: true }
      ),
      (image) => FileSystem.unlink(image.uri)
    );
    resizedUri = resized.uri;
    const cover = `data:image/jpeg;base64,${await read.wait(FileSystem.readFile(resized.uri, "base64"))}`;
    if (cover.length > 300000) throw new Error("FileTooLarge");
    return cover;
  } finally {
    read.finish();
    void Promise.all(
      [localUri, resizedUri]
        .filter((path): path is string => !!path)
        .map((path) => FileSystem.unlink(path).catch(() => undefined))
    );
  }
}

export async function readRemoteSongCover(url: string, signal: AbortSignal) {
  if (!url.startsWith("https://") || signal.aborted) return "";
  const path = `${Dirs.CacheDir}/recognized-cover-${Date.now()}.jpg`;
  const request = FileSystem.fetchManaged(url, { path }, (bytes) => {
    if (bytes > 5 * 1024 * 1024) void request.cancel();
  });
  const abort = () => {
    void request.cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 8000);
  try {
    const response = await request.result;
    if (!response.ok || signal.aborted) return "";
    return await readSongCover(`file://${path}`, false, signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    await FileSystem.unlink(path).catch(() => undefined);
  }
}

export async function readLibraryFile(
  kind: "song" | "backup",
  signal?: AbortSignal
) {
  const read = fileRead(signal);
  let localUri: string | undefined;
  try {
    const [file] = await read.wait(pick({ allowMultiSelection: false }));
    read.start();
    const extension = file.name?.split(".").pop()?.toLowerCase() ?? "";
    if (
      !(
        kind === "backup" ? ["json"] : ["txt", "pro", "cho", "chordpro"]
      ).includes(extension)
    )
      throw new Error("FileFormatError");
    if (file.size !== null && file.size > maxBytes)
      throw new Error("FileTooLarge");
    const [copy] = await read.wait(
      keepLocalCopy({
        destination: "cachesDirectory",
        files: [
          {
            uri: file.uri,
            fileName: `freetune-import-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
          }
        ]
      }),
      (copies) =>
        Promise.all(
          copies.map((copy) =>
            copy.status === "success"
              ? FileSystem.unlink(copy.localUri)
              : Promise.resolve()
          )
        )
    );
    if (copy.status !== "success") throw new Error("FileReadError");
    localUri = copy.localUri;
    const stat = await read.wait(FileSystem.stat(localUri));
    if (stat.size > maxBytes) throw new Error("FileTooLarge");
    const bytes = toByteArray(
      await read.wait(FileSystem.readFile(localUri, "base64"))
    );
    if (bytes.length > maxBytes) throw new Error("FileTooLarge");
    for (let i = 0; i < bytes.length; ) {
      const lead = bytes[i++];
      if (lead < 0x80) continue;
      const count =
        lead >= 0xc2 && lead <= 0xdf
          ? 1
          : lead >= 0xe0 && lead <= 0xef
            ? 2
            : lead >= 0xf0 && lead <= 0xf4
              ? 3
              : 0;
      if (!count || i + count > bytes.length)
        throw new Error("FileEncodingError");
      for (let offset = 0; offset < count; offset++) {
        const byte = bytes[i++];
        const min =
          offset === 0 && lead === 0xe0
            ? 0xa0
            : offset === 0 && lead === 0xf0
              ? 0x90
              : 0x80;
        const max =
          offset === 0 && lead === 0xed
            ? 0x9f
            : offset === 0 && lead === 0xf4
              ? 0x8f
              : 0xbf;
        if (byte < min || byte > max) throw new Error("FileEncodingError");
      }
    }
    const text = (await read.wait(FileSystem.readFile(localUri, "utf8")))
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
    if (text.includes("\0")) throw new Error("FileEncodingError");
    return { text, name: file.name ?? "" };
  } finally {
    read.finish();
    if (localUri) await FileSystem.unlink(localUri).catch(() => undefined);
  }
}

export function importedSong(text: string, name: string) {
  if (text.length > 200000) throw new Error("FileTooLarge");
  const title =
    text
      .match(
        /^[^\S\r\n\u2028\u2029]*\{(?:title|t):[^\S\r\n\u2028\u2029]*([^{}\r\n]+)\}[^\S\r\n\u2028\u2029]*$/im
      )?.[1]
      ?.trim() ?? name.replace(/\.[^.]+$/, "");
  if (title.length > songFieldLimits.title) throw new Error("FileTooLarge");
  const capoDirective =
    /\{capo:[^\S\r\n\u2028\u2029]*(\d+)[^\S\r\n\u2028\u2029]*\}/i;
  const capo = Math.min(12, Number(text.match(capoDirective)?.[1] ?? 0));
  const sourceTuning = text
    .match(/\{tuning:[^\S\r\n\u2028\u2029]*([^{}\r\n]+)\}/i)?.[1]
    ?.trim();
  const content = text
    .replace(
      /^[^\S\r\n\u2028\u2029]*\{(title|t|artist|a|capo|tuning):[^{}\r\n]+\}[^\S\r\n\u2028\u2029]*$/gim,
      (line, directive: string) =>
        directive.toLowerCase() === "capo" && !capoDirective.test(line)
          ? line
          : ""
    )
    .trim();
  if (!content) throw new Error("FileFormatError");
  const artist =
    text
      .match(
        /^[^\S\r\n\u2028\u2029]*\{(?:artist|a):[^\S\r\n\u2028\u2029]*([^{}\r\n]+)\}[^\S\r\n\u2028\u2029]*$/im
      )?.[1]
      ?.trim() ?? "";
  if (artist.length > songFieldLimits.band_name)
    throw new Error("FileTooLarge");
  return {
    title,
    capo,
    sourceTuning,
    rhythm: sourceArrangement(content),
    content: transposeSong(content, capo),
    fk_band: {
      id: "",
      name: artist,
      search_text_lower: artist.toLocaleLowerCase()
    }
  };
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
    typeof data.version !== "number" ||
    ![1, 2].includes(data.version) ||
    !Array.isArray(data.songs) ||
    data.songs.length > 2000
  )
    throw new Error("BackupInvalid");
  return data.songs.map((song: unknown) => {
    if (!record(song)) throw new Error("BackupInvalid");
    const strings: Record<string, string> = {};
    for (const [key, limit] of Object.entries(songFieldLimits)) {
      const value = song[key];
      if (
        typeof value !== "string" ||
        value.length > (data.version === 1 ? maxBytes : limit)
      )
        throw new Error("BackupInvalid");
      strings[key] = value;
    }
    if (
      Object.values(strings).reduce((size, value) => size + value.length, 0) >
      400000
    )
      throw new Error("BackupInvalid");
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
  const state = usePreferences.getState();
  const identities = Object.fromEntries(
    songs
      .filter((song) => !state.songs[song.id]?.backupId)
      .map((song) => [
        song.id,
        {
          ...normalizeSongPreferences(state.songs[song.id]),
          backupId: `${Date.now().toString(36)}-${song.id}-${Math.random().toString(36).slice(2)}`
        }
      ])
  );
  const preferences = { ...state.songs, ...identities };
  if (Object.keys(identities).length) {
    const resume = suspendPreferenceSaving();
    let committed = false;
    try {
      await new Promise<void>((resolve, reject) =>
        db.transaction(
          (tx) => writePreferences(tx, { ...state, songs: preferences }),
          reject,
          resolve
        )
      );
      committed = true;
      usePreferences.setState((current) => ({
        songs: {
          ...current.songs,
          ...Object.fromEntries(
            Object.entries(identities).map(([id, song]) => [
              id,
              { ...current.songs[id], backupId: song.backupId }
            ])
          )
        }
      }));
    } finally {
      resume(committed ? preferences : undefined);
    }
  }
  const header = {
    format: "freetune-library",
    version: songs.some((song) =>
      Object.entries(songFieldLimits).some(
        ([key, limit]) => String(song[key as keyof typeof song]).length > limit
      )
    )
      ? 1
      : 2,
    createdAt: new Date().toISOString()
  };
  const overhead = JSON.stringify({ ...header, songs: [] }).length;
  const parts: BackupSong[][] = [[]];
  let bytes = overhead;
  for (const song of songs) {
    const entry = {
      title: song.title,
      content: song.content,
      band_name: song.band_name,
      youtube_music: song.youtube_music ?? "",
      youtobe_lesson: song.youtobe_lesson ?? "",
      preferences: normalizeSongPreferences(preferences[song.id])
    };
    const size = encodeURIComponent(JSON.stringify(entry)).replace(
      /%[\dA-F]{2}/g,
      "_"
    ).length;
    if (size + overhead > maxBytes) throw new Error("FileTooLarge");
    let part = parts[parts.length - 1];
    if (part.length && (bytes + size + 1 > maxBytes || part.length === 2000)) {
      part = [];
      parts.push(part);
      bytes = overhead;
    }
    bytes += size + (part.length ? 1 : 0);
    part.push(entry);
  }
  for (const [index, songs] of parts.entries()) {
    const text = JSON.stringify({ ...header, songs });
    parseLibraryBackup(text);
    const suffix =
      parts.length > 1 ? `-part-${index + 1}-of-${parts.length}` : "";
    const name = `FreeTune-library-${header.createdAt.slice(0, 10)}${suffix}.json`;
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
}

export async function restoreLibrary(songs: BackupSong[]) {
  const resumeSaving = suspendPreferenceSaving();
  const addedPreferences: Record<string, SongPreferences> = {};
  let added = 0;
  let committed = false;
  const matched = new Set<number>();
  try {
    await new Promise<void>((resolve, reject) =>
      db.transaction(
        (tx) => {
          const insertNext = (index: number) => {
            const song = songs[index];
            if (!song) {
              const state = usePreferences.getState();
              writePreferences(tx, {
                ...state,
                songs: { ...state.songs, ...addedPreferences }
              });
              return;
            }
            const { title, content, band_name, youtube_music, youtobe_lesson } =
              song;
            tx.executeSql(
              "SELECT songs.id FROM songs LEFT JOIN bands ON bands.id = songs.band_id WHERE title = ? AND content = ? AND COALESCE(bands.name, '') = ? AND COALESCE(youtube_music, '') = ? AND COALESCE(youtobe_lesson, '') = ? ORDER BY songs.id",
              [title, content, band_name, youtube_music, youtobe_lesson],
              (_, existing) => {
                const candidates = Array.from(
                  { length: existing.rows.length },
                  (_, i) => existing.rows.item(i).id as number
                ).filter((id) => !matched.has(id));
                const current = usePreferences.getState().songs;
                const match =
                  candidates.find(
                    (id) =>
                      song.preferences.backupId &&
                      current[id]?.backupId === song.preferences.backupId
                  ) ??
                  candidates.find(
                    (id) => !song.preferences.backupId || !current[id]?.backupId
                  );
                if (match !== undefined) {
                  matched.add(match);
                  addedPreferences[match] = song.preferences;
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
                      matched.add(result.insertId);
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
    committed = true;
    usePreferences.setState((state) => ({
      songs: { ...state.songs, ...addedPreferences }
    }));
    return { added, skipped: songs.length - added };
  } finally {
    resumeSaving(committed ? addedPreferences : undefined);
  }
}

let recordingCleanup: Promise<void> | undefined;
function recordingFileName(path: string, songId: number) {
  const name = path.split(/[\\/]/).pop() ?? "";
  if (!new RegExp(`^song-${songId}-[0-9]+\\.m4a$`).test(name))
    throw new Error("RecordingDeleteFailed");
  return name;
}
export function finishPendingRecordingDeletions(): Promise<void> {
  const cleanup = (recordingCleanup ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const pending = await getAllItems<{ key: string; value: string }>({
        tableName: "settings",
        filters: "key LIKE ?",
        parameters: ["recording-delete:%"]
      });
      for (const item of pending) {
        const match = /^recording-delete:(\d+)$/.exec(item.key);
        if (!match) continue;
        const songId = Number(match[1]);
        const songs = await getAllItems({
          tableName: "songs",
          filters: "id = ?",
          parameters: [songId]
        });
        if (!songs.length) {
          const paths: unknown = JSON.parse(item.value);
          if (
            !Array.isArray(paths) ||
            !paths.every((path) => typeof path === "string")
          )
            throw new Error("RecordingDeleteFailed");
          const names = paths.map((path) => recordingFileName(path, songId));
          const remaining = await performanceAudio.list(songId);
          for (const take of remaining.filter((take) =>
            names.includes(recordingFileName(take.path, songId))
          )) {
            if (take.processing || !(await performanceAudio.remove(take.path)))
              throw new Error("RecordingDeleteFailed");
          }
          const after = await performanceAudio.list(songId);
          if (
            after.some((take) =>
              names.includes(recordingFileName(take.path, songId))
            )
          )
            throw new Error("RecordingDeleteFailed");
        }
        await new Promise<void>((resolve, reject) =>
          db.transaction(
            (tx) =>
              tx.executeSql("DELETE FROM settings WHERE key = ?", [item.key]),
            reject,
            resolve
          )
        );
      }
    });
  recordingCleanup = cleanup;
  return cleanup.finally(() => {
    if (recordingCleanup === cleanup) recordingCleanup = undefined;
  });
}

export function requestSongDeletion(
  songId: number,
  onDeleted: () => void,
  onRecordings: () => void
) {
  const fail = () => Alert.alert(t("Error"));
  const remove = async (
    takes: Awaited<ReturnType<typeof performanceAudio.list>>
  ) => {
    const resumeSaving = suspendPreferenceSaving();
    try {
      if (takes.some((take) => take.processing))
        throw new Error("RecordingBusy");
      performanceAudio.stopPlayback();
      if (takes.length)
        await new Promise<void>((resolve, reject) =>
          db.transaction(
            (tx) => {
              tx.executeSql(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                [
                  `recording-delete:${songId}`,
                  JSON.stringify(
                    takes.map((take) => recordingFileName(take.path, songId))
                  )
                ]
              );
              tx.executeSql(
                "DELETE FROM songs WHERE id = ?",
                [songId],
                (_, result) => {
                  if (result.rowsAffected !== 1) throw new Error("SongMissing");
                }
              );
              tx.executeSql("DELETE FROM settings WHERE key LIKE ?", [
                `song:${songId}:%`
              ]);
            },
            reject,
            resolve
          )
        );
      else await deleteItem({ tableName: "songs", filters: `id = ${songId}` });
      usePreferences.getState().removeSong(songId);
      onDeleted();
      if (takes.length)
        await finishPendingRecordingDeletions().catch(() =>
          Alert.alert(t("RecordingCleanupPending"))
        );
    } catch {
      fail();
    } finally {
      resumeSaving();
    }
  };
  Alert.alert(t("Delete"), t("DeleteSongConfirm"), [
    { text: t("Cancel"), style: "cancel" },
    {
      text: t("Delete"),
      style: "destructive",
      onPress: () => {
        void (async () => {
          try {
            await performanceAudio.stop();
            const takes = await performanceAudio.list(songId);
            if (!takes.length) {
              await remove([]);
              return;
            }
            Alert.alert(t("MyRecordings"), t("DeleteSongRecordings"), [
              { text: t("Cancel"), style: "cancel" },
              { text: t("MyRecordings"), onPress: onRecordings },
              {
                text: t("DeleteSongAndRecordings"),
                style: "destructive",
                onPress: () => void remove(takes)
              }
            ]);
          } catch {
            fail();
          }
        })();
      }
    }
  ]);
}
