import { Alert } from "react-native";
import { t } from "../locales";
import { performanceAudio } from "./performance-audio";
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
import { cooperativeWork } from "./cooperative-work";
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
    async pause(): Promise<void> {
      let pending: ReturnType<typeof setTimeout> | undefined;
      try {
        await this.wait(
          new Promise<void>((resolve) => {
            pending = setTimeout(resolve, 0);
          })
        );
      } finally {
        if (pending !== undefined) clearTimeout(pending);
      }
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

let remoteCoverId = 0;
export async function readRemoteSongCover(url: string, signal: AbortSignal) {
  if (!url.startsWith("https://") || signal.aborted) return "";
  const controller = new AbortController();
  const read = fileRead(controller.signal);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 8000);
  const path = `${Dirs.CacheDir}/recognized-cover-${Date.now()}-${++remoteCoverId}.jpg`;
  let request: ReturnType<typeof FileSystem.fetchManaged> | undefined;
  try {
    request = FileSystem.fetchManaged(url, { path }, (bytes) => {
      if (bytes > 5 * 1024 * 1024) abort();
    });
    const response = await read.wait(request.result, () =>
      FileSystem.unlink(path)
    );
    if (!response.ok || signal.aborted) return "";
    return await readSongCover(`file://${path}`, false, controller.signal);
  } catch (error) {
    void request?.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    read.finish();
    await FileSystem.unlink(path).catch(() => undefined);
  }
}

async function validateFileEncoding(
  encoded: string,
  read: ReturnType<typeof fileRead>
) {
  if (encoded.length > Math.ceil(maxBytes / 3) * 4)
    throw new Error("FileTooLarge");
  let length = 0;
  let remaining = 0;
  let min = 0x80;
  let max = 0xbf;
  // A chunk ends on a base64 quartet, but may split a UTF-8 code point.
  for (let start = 0; start < encoded.length; start += 65536) {
    if (start) await read.pause();
    const bytes = toByteArray(encoded.slice(start, start + 65536));
    length += bytes.length;
    if (length > maxBytes) throw new Error("FileTooLarge");
    for (const byte of bytes) {
      if (remaining) {
        if (byte < min || byte > max) throw new Error("FileEncodingError");
        remaining--;
        min = 0x80;
        max = 0xbf;
        continue;
      }
      if (byte < 0x80) continue;
      remaining =
        byte >= 0xc2 && byte <= 0xdf
          ? 1
          : byte >= 0xe0 && byte <= 0xef
            ? 2
            : byte >= 0xf0 && byte <= 0xf4
              ? 3
              : 0;
      if (!remaining) throw new Error("FileEncodingError");
      min = byte === 0xe0 ? 0xa0 : byte === 0xf0 ? 0x90 : 0x80;
      max = byte === 0xed ? 0x9f : byte === 0xf4 ? 0x8f : 0xbf;
    }
  }
  if (remaining) throw new Error("FileEncodingError");
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
    await validateFileEncoding(
      await read.wait(FileSystem.readFile(localUri, "base64")),
      read
    );
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
  const tempoDirective =
    /^[ \t]*\{(?:tempo:[ \t]*|meta:[ \t]*tempo[ \t]+)(\d+(?:\.\d+)?)[ \t]*\}[ \t]*$/gim;
  const tempos = [
    ...new Set(
      [...text.matchAll(tempoDirective)].map((match) => Number(match[1]))
    )
  ];
  const tempo =
    tempos.length === 1 &&
    Number.isFinite(tempos[0]) &&
    tempos[0] >= 40 &&
    tempos[0] <= 200
      ? Math.round(tempos[0])
      : undefined;
  const content = (
    tempo === undefined ? text : text.replace(tempoDirective, "")
  )
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
    tempo,
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
function backupPreferences(value: unknown): SongPreferences {
  const preferences = normalizeSongPreferences(value);
  if (record(value) && value.tablature !== undefined && !preferences.tablature)
    throw new Error("BackupInvalid");
  return preferences;
}
function backupData(text: string) {
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
  return { version: data.version, songs: data.songs as unknown[] };
}

export function parseLibraryBackup(text: string): BackupSong[] {
  const { version, songs } = backupData(text);
  return songs.map((song) => backupSong(song, version));
}

export async function parseLibraryBackupAsync(
  text: string,
  signal?: AbortSignal
): Promise<BackupSong[]> {
  const read = fileRead(signal);
  try {
    read.start();
    await read.pause();
    const { version, songs } = backupData(text);
    const result: BackupSong[] = [];
    const checkpoint = cooperativeWork(() => read.pause());
    for (const song of songs) {
      result.push(backupSong(song, version));
      const pause = checkpoint();
      if (pause) await pause;
    }
    return result;
  } finally {
    read.finish();
  }
}

function backupSong(
  song: unknown,
  version: number,
  preferences?: SongPreferences
): BackupSong {
  if (!record(song)) throw new Error("BackupInvalid");
  const strings: Record<string, string> = {};
  for (const [key, limit] of Object.entries(songFieldLimits)) {
    const value = song[key];
    if (
      typeof value !== "string" ||
      value.length > (version === 1 ? maxBytes : limit)
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
    preferences: preferences ?? backupPreferences(song.preferences)
  };
}

async function utf8Length(
  text: string,
  checkpoint: ReturnType<typeof cooperativeWork>
) {
  let bytes = 0;
  let nextCheck = 16384;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (index >= nextCheck) {
      nextCheck = index + 16384;
      const pause = checkpoint();
      if (pause) await pause;
    }
  }
  return bytes;
}

export async function exportLibrary() {
  const songs = await getAllItems<BackupSong & { id: number }>({
    tableName: "songs",
    fields:
      "songs.id, songs.title, songs.content, songs.youtube_music, songs.youtobe_lesson, COALESCE(bands.name, '') AS band_name",
    joins: ["LEFT JOIN bands ON songs.band_id = bands.id"]
  });
  const checkpoint = cooperativeWork();
  const normalized = new Map<SongPreferences | undefined, SongPreferences>();
  const normalize = (value: SongPreferences | undefined) => {
    let saved = normalized.get(value);
    if (!saved) {
      saved = backupPreferences(value);
      normalized.set(value, saved);
    }
    return saved;
  };
  for (const song of songs) {
    normalize(usePreferences.getState().songs[song.id]);
    const pause = checkpoint();
    if (pause) await pause;
  }
  // Capture the export snapshot after yielding. A preference edited during
  // preparation must not be overwritten with the earlier validation snapshot.
  const state = usePreferences.getState();
  const identities: Record<string, SongPreferences> = {};
  const exported: Record<string, SongPreferences> = {};
  for (const song of songs) {
    const preferences = normalize(state.songs[song.id]);
    exported[song.id] = preferences;
    if (!state.songs[song.id]?.backupId) {
      const identified = {
        ...preferences,
        backupId: `${Date.now().toString(36)}-${song.id}-${Math.random().toString(36).slice(2)}`
      };
      identities[song.id] = identified;
      exported[song.id] = identified;
    }
  }
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
  const prefix = JSON.stringify(header).slice(0, -1) + ',"songs":[';
  const overhead = prefix.length + 2;
  const parts: string[][] = [[]];
  let bytes = overhead;
  for (const song of songs) {
    const entry = backupSong(
      {
        ...song,
        youtube_music: song.youtube_music ?? "",
        youtobe_lesson: song.youtobe_lesson ?? ""
      },
      header.version,
      exported[song.id]
    );
    const encoded = JSON.stringify(entry);
    const size = await utf8Length(encoded, checkpoint);
    if (size + overhead > maxBytes) throw new Error("FileTooLarge");
    let part = parts[parts.length - 1];
    if (part.length && (bytes + size + 1 > maxBytes || part.length === 2000)) {
      part = [];
      parts.push(part);
      bytes = overhead;
    }
    bytes += size + (part.length ? 1 : 0);
    part.push(encoded);
    const pause = checkpoint();
    if (pause) await pause;
  }
  for (const [index, songs] of parts.entries()) {
    const text = prefix + songs.join(",") + "]}";
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
  let snapshot: Record<string, SongPreferences> = {};
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
              snapshot = state.songs;
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
      songs: {
        ...state.songs,
        ...Object.fromEntries(
          Object.entries(addedPreferences).map(([id, preferences]) => [
            id,
            preserveSongPreferenceChanges(
              preferences,
              snapshot[id],
              state.songs[id]
            )
          ])
        )
      }
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
      let failure: unknown;
      for (const item of pending) {
        try {
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
              if (
                take.processing ||
                !(await performanceAudio.remove(take.path))
              )
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
        } catch (error) {
          // A failed recording must not block cleanup of unrelated songs.
          failure ??= error ?? new Error("RecordingDeleteFailed");
        }
      }
      if (failure !== undefined) throw failure;
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
  const fail = () => Alert.alert(t("DeleteSongError"));
  if (!Number.isSafeInteger(songId) || songId <= 0) {
    fail();
    return;
  }
  const remove = async (
    takes: Awaited<ReturnType<typeof performanceAudio.list>>
  ) => {
    const resumeSaving = suspendPreferenceSaving();
    try {
      if (takes.some((take) => take.processing))
        throw new Error("RecordingBusy");
      performanceAudio.stopPlayback();
      await new Promise<void>((resolve, reject) =>
        db.transaction(
          (tx) => {
            if (takes.length)
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
