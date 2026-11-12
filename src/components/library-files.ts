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
import { db } from "./database";
import { getAllItems } from "./database/crud";
import {
  AudioSong,
  audioBackupFootprint,
  listAudioSongs
} from "./database/audio-analysis";
import { validateSongAnalysis } from "./song-analysis/types";
import {
  normalizeSongPreferences,
  SongPreferences,
  suspendPreferenceSaving,
  usePreferences
} from "./preferences";

const maxBytes = 5 * 1024 * 1024;
const maxBackupBytes = 50 * 1024 * 1024;
export const fileCanceled = (error: unknown) =>
  isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;

export async function readSongCover(uri?: string) {
  let localUri: string | undefined;
  let resizedUri: string | undefined;
  try {
    if (!uri) {
      const [file] = await pick({
        type: [types.images],
        allowMultiSelection: false
      });
      if (file.size !== null && file.size > 20 * 1024 * 1024)
        throw new Error("FileTooLarge");
      const [copy] = await keepLocalCopy({
        destination: "cachesDirectory",
        files: [
          {
            uri: file.uri,
            fileName: `cover-${Date.now()}.${file.name?.split(".").pop() ?? "jpg"}`
          }
        ]
      });
      if (copy.status !== "success") throw new Error("FileReadError");
      localUri = copy.localUri;
      if ((await FileSystem.stat(localUri)).size > 20 * 1024 * 1024)
        throw new Error("FileTooLarge");
    }
    const resized = await ImageResizer.createResizedImage(
      uri ?? localUri!,
      384,
      384,
      "JPEG",
      82,
      uri ? 90 : 0,
      undefined,
      false,
      { mode: "contain", onlyScaleDown: true }
    );
    resizedUri = resized.uri;
    const cover = `data:image/jpeg;base64,${await FileSystem.readFile(resized.uri, "base64")}`;
    if (cover.length > 300000) throw new Error("FileTooLarge");
    return cover;
  } finally {
    await Promise.all(
      [localUri, resizedUri]
        .filter((path): path is string => !!path)
        .map((path) => FileSystem.unlink(path).catch(() => undefined))
    );
  }
}

export async function readLibraryFile(kind: "song" | "backup") {
  const [file] = await pick({ allowMultiSelection: false });
  const extension = file.name?.split(".").pop()?.toLowerCase() ?? "";
  if (
    !(
      kind === "backup" ? ["json"] : ["txt", "pro", "cho", "chordpro"]
    ).includes(extension)
  )
    throw new Error("FileFormatError");
  const limit = kind === "backup" ? maxBackupBytes : maxBytes;
  if (file.size !== null && file.size > limit) throw new Error("FileTooLarge");
  const [copy] = await keepLocalCopy({
    destination: "cachesDirectory",
    files: [{ uri: file.uri, fileName: `freetune-import-${Date.now()}.txt` }]
  });
  if (copy.status !== "success") throw new Error("FileReadError");
  try {
    const stat = await FileSystem.stat(copy.localUri);
    if (stat.size > limit) throw new Error("FileTooLarge");
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

export type BackupAudio = Omit<AudioSong, "songId" | "fileName" | "updatedAt">;
export interface BackupSong {
  title: string;
  content: string;
  band_name: string;
  youtube_music: string;
  youtobe_lesson: string;
  preferences: SongPreferences;
  audio?: BackupAudio;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseBackupAudio(value: unknown): BackupAudio {
  if (
    !record(value) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.originalName !== "string" ||
    !value.originalName.trim() ||
    value.originalName.length > 1024 ||
    typeof value.mimeType !== "string" ||
    ![
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a"
    ].includes(value.mimeType) ||
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0 ||
    value.bytes > 256 * 1024 * 1024 ||
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    value.duration > 7200 ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.manuallyEdited !== "boolean"
  )
    throw new Error("BackupInvalid");
  try {
    const analysis =
      value.analysis === null ? null : validateSongAnalysis(value.analysis);
    const generatedAnalysis =
      value.generatedAnalysis === null
        ? null
        : validateSongAnalysis(value.generatedAnalysis);
    if (
      [analysis, generatedAnalysis].some(
        (item) =>
          item && Math.abs(item.duration - (value.duration as number)) > 0.5
      )
    )
      throw new Error("BackupInvalid");
    return {
      sha256: value.sha256,
      originalName: value.originalName,
      mimeType: value.mimeType,
      bytes: value.bytes,
      duration: value.duration,
      revision: value.revision,
      manuallyEdited: value.manuallyEdited,
      analysis,
      generatedAnalysis
    };
  } catch {
    throw new Error("BackupInvalid");
  }
}

export function parseLibraryBackup(text: string): BackupSong[] {
  if (text.length > maxBackupBytes) throw new Error("FileTooLarge");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("BackupInvalid");
  }
  if (
    !record(data) ||
    data.format !== "freetune-library" ||
    ![1, 2].includes(data.version as number) ||
    (data.version === 2 &&
      (data.audioIncluded !== false ||
        data.audioPolicy !== "relink-original-by-sha256")) ||
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
    const audio =
      data.version === 2 && song.audio !== undefined
        ? parseBackupAudio(song.audio)
        : undefined;
    if (!strings.title.trim() || (!strings.content.trim() && !audio))
      throw new Error("BackupInvalid");
    return {
      title: strings.title,
      content: strings.content,
      band_name: strings.band_name,
      youtube_music: strings.youtube_music,
      youtobe_lesson: strings.youtobe_lesson,
      preferences: normalizeSongPreferences(song.preferences),
      ...(audio ? { audio } : {})
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
    ) > maxBackupBytes
  )
    throw new Error("FileTooLarge");
  const preferences = usePreferences.getState().songs;
  if ((await audioBackupFootprint()) > maxBackupBytes)
    throw new Error("FileTooLarge");
  const audio = new Map(
    (await listAudioSongs()).map((song) => [song.songId, song])
  );
  const text = JSON.stringify(
    {
      format: "freetune-library",
      version: 2,
      // JSON preserves notation and edits. Recordings stay on this device.
      // Restoring elsewhere requires selecting the exact original file by hash.
      audioIncluded: false,
      audioPolicy: "relink-original-by-sha256",
      createdAt: new Date().toISOString(),
      songs: songs.map((song) => {
        const stored = audio.get(song.id);
        return {
          title: song.title,
          content: song.content,
          band_name: song.band_name,
          youtube_music: song.youtube_music ?? "",
          youtobe_lesson: song.youtobe_lesson ?? "",
          preferences: normalizeSongPreferences(preferences[song.id]),
          ...(stored
            ? {
                audio: {
                  sha256: stored.sha256,
                  originalName: stored.originalName,
                  mimeType: stored.mimeType,
                  bytes: stored.bytes,
                  duration: stored.duration,
                  analysis: stored.analysis,
                  generatedAnalysis: stored.generatedAnalysis,
                  revision: stored.revision,
                  manuallyEdited: stored.manuallyEdited
                }
              }
            : {})
        };
      })
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
    if ((await FileSystem.stat(path)).size > maxBackupBytes)
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
              song.audio
                ? "SELECT song_id AS id FROM song_audio WHERE sha256 = ? LIMIT 1"
                : "SELECT songs.id FROM songs LEFT JOIN bands ON bands.id = songs.band_id LEFT JOIN song_audio ON song_audio.song_id = songs.id WHERE song_audio.song_id IS NULL AND title = ? AND content = ? AND COALESCE(bands.name, '') = ? AND COALESCE(youtube_music, '') = ? AND COALESCE(youtobe_lesson, '') = ? LIMIT 1",
              song.audio
                ? [song.audio.sha256]
                : [title, content, band_name, youtube_music, youtobe_lesson],
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
                      if (song.audio) {
                        const audio = song.audio;
                        tx.executeSql(
                          "INSERT INTO song_audio (song_id, sha256, file_name, original_name, mime_type, byte_size, duration, analysis_json, generated_json, revision, manually_edited, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                          [
                            result.insertId,
                            audio.sha256,
                            audio.originalName,
                            audio.mimeType,
                            audio.bytes,
                            audio.duration,
                            audio.analysis
                              ? JSON.stringify(audio.analysis)
                              : null,
                            audio.generatedAnalysis
                              ? JSON.stringify(audio.generatedAnalysis)
                              : null,
                            audio.revision,
                            audio.manuallyEdited ? 1 : 0,
                            Date.now()
                          ]
                        );
                      }
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
