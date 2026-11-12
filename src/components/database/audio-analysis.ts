import { SQLTransaction } from "react-native-sqlite-2";
import { db } from "./index";
import { SongAnalysis, validateSongAnalysis } from "../song-analysis/types";

export interface AudioImportMetadata {
  fileName: string;
  originalName: string;
  mimeType: string;
  sha256: string;
  bytes: number;
  durationMs: number;
}

export interface AudioSong {
  songId: number;
  sha256: string;
  fileName: string | null;
  originalName: string;
  mimeType: string;
  bytes: number;
  duration: number;
  analysis: SongAnalysis | null;
  generatedAnalysis: SongAnalysis | null;
  revision: number;
  manuallyEdited: boolean;
  updatedAt: number;
}

export type AnalysisJobStatus =
  | "queued"
  | "uploading"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface AnalysisJob {
  id: string;
  songId: number;
  status: AnalysisJobStatus;
  stage: string;
  progress: number;
  serverJobId: string | null;
  serverUrl: string;
  error: string | null;
  attempt: number;
  updatedAt: number;
}

const active = "('queued', 'uploading', 'running')";
type Row = Record<string, any>;

function transaction<T>(
  work: (tx: SQLTransaction, done: (value: T) => void) => void
) {
  return new Promise<T>((resolve, reject) => {
    let result: T;
    db.transaction(
      (tx) =>
        work(tx, (value) => {
          result = value;
        }),
      reject,
      () => resolve(result)
    );
  });
}

function rows(sql: string, parameters: (string | number | null)[] = []) {
  return transaction<Row[]>((tx, done) => {
    tx.executeSql(sql, parameters, (_, result) => {
      const values = [];
      for (let i = 0; i < result.rows.length; i++)
        values.push(result.rows.item(i));
      done(values);
    });
  });
}

const audioFromRow = (row: Row): AudioSong => ({
  songId: row.song_id,
  sha256: row.sha256,
  fileName: row.file_name,
  originalName: row.original_name,
  mimeType: row.mime_type,
  bytes: row.byte_size,
  duration: row.duration,
  analysis: row.analysis_json
    ? validateSongAnalysis(JSON.parse(row.analysis_json))
    : null,
  generatedAnalysis: row.generated_json
    ? validateSongAnalysis(JSON.parse(row.generated_json))
    : null,
  revision: row.revision,
  manuallyEdited: row.manually_edited === 1,
  updatedAt: row.updated_at
});

const jobFromRow = (row: Row): AnalysisJob => ({
  id: row.id,
  songId: row.song_id,
  status: row.status,
  stage: row.stage,
  progress: row.progress,
  serverJobId: row.server_job_id,
  serverUrl: row.server_url,
  error: row.error,
  attempt: row.attempt,
  updatedAt: row.updated_at
});

function validateMetadata(metadata: AudioImportMetadata) {
  if (
    !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
    !new RegExp(`^${metadata.sha256}\\.(mp3|wav|m4a)$`).test(
      metadata.fileName
    ) ||
    typeof metadata.originalName !== "string" ||
    !metadata.originalName.trim() ||
    metadata.originalName.length > 1024 ||
    ![
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a"
    ].includes(metadata.mimeType) ||
    !Number.isSafeInteger(metadata.bytes) ||
    metadata.bytes <= 0 ||
    metadata.bytes > 256 * 1024 * 1024 ||
    !Number.isFinite(metadata.durationMs) ||
    metadata.durationMs <= 0 ||
    metadata.durationMs > 7200000
  )
    throw new Error("AudioMetadataInvalid");
}

/** Import is atomic and content-addressed; a repeat or relink cannot create a second song. */
export function createAudioSong(metadata: AudioImportMetadata, title?: string) {
  validateMetadata(metadata);
  const name = (
    title?.trim() ||
    metadata.originalName.replace(/\.[^.]+$/, "") ||
    "Audio"
  ).slice(0, 1000);
  const now = Date.now();
  return transaction<{ songId: number; created: boolean }>((tx, done) => {
    tx.executeSql(
      "SELECT song_id FROM song_audio WHERE sha256 = ?",
      [metadata.sha256],
      (_, existing) => {
        if (existing.rows.length) {
          const songId = existing.rows.item(0).song_id;
          tx.executeSql(
            "UPDATE song_audio SET file_name = ?, updated_at = ? WHERE song_id = ?",
            [metadata.fileName, now, songId]
          );
          done({ songId, created: false });
          return;
        }
        tx.executeSql(
          "INSERT INTO songs (title, content, search_text_lower) VALUES (?, ?, ?)",
          [name, "", name.toLowerCase()],
          (_, song) => {
            tx.executeSql(
              "INSERT INTO song_audio (song_id, sha256, file_name, original_name, mime_type, byte_size, duration, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [
                song.insertId,
                metadata.sha256,
                metadata.fileName,
                metadata.originalName,
                metadata.mimeType,
                metadata.bytes,
                metadata.durationMs / 1000,
                now
              ]
            );
            done({ songId: song.insertId, created: true });
          }
        );
      }
    );
  });
}

export async function getAudioSong(songId: number) {
  const [row] = await rows("SELECT * FROM song_audio WHERE song_id = ?", [
    songId
  ]);
  return row ? audioFromRow(row) : null;
}

export async function listAudioSongs() {
  return (await rows("SELECT * FROM song_audio")).map(audioFromRow);
}

/** Startup cleanup must not load every transcript into the JavaScript heap. */
export async function listAudioFileNames(): Promise<string[]> {
  return (
    await rows("SELECT file_name FROM song_audio WHERE file_name IS NOT NULL")
  ).map((row) => row.file_name);
}

export async function audioBackupFootprint(): Promise<number> {
  const [row] = await rows(
    "SELECT COALESCE(SUM(LENGTH(CAST(COALESCE(analysis_json, '') AS BLOB)) + LENGTH(CAST(COALESCE(generated_json, '') AS BLOB)) + LENGTH(CAST(original_name AS BLOB)) + 1024), 0) AS size FROM song_audio"
  );
  return row.size;
}

export async function getAnalysisJob(songId: number) {
  const [row] = await rows(
    "SELECT * FROM audio_analysis_jobs WHERE song_id = ?",
    [songId]
  );
  return row ? jobFromRow(row) : null;
}

export async function listAnalysisJobs() {
  return (
    await rows("SELECT * FROM audio_analysis_jobs ORDER BY updated_at DESC")
  ).map(jobFromRow);
}

/** Each attempt has a new identity; stale responses from previous attempts cannot publish. */
export function beginAnalysis(songId: number, serverUrl: string) {
  if (!serverUrl || serverUrl.length > 2000)
    throw new Error("AnalysisServerInvalid");
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${songId}`;
  const now = Date.now();
  return transaction<AnalysisJob>((tx, done) => {
    tx.executeSql(
      "SELECT file_name FROM song_audio WHERE song_id = ?",
      [songId],
      (_, audio) => {
        if (!audio.rows.length || !audio.rows.item(0).file_name)
          throw new Error("AudioFileMissing");
        tx.executeSql(
          "SELECT * FROM audio_analysis_jobs WHERE song_id = ?",
          [songId],
          (_, previous) => {
            const old = previous.rows.length ? previous.rows.item(0) : null;
            if (old && ["queued", "uploading", "running"].includes(old.status))
              throw new Error("AnalysisAlreadyRunning");
            const attempt = (old?.attempt ?? 0) + 1;
            tx.executeSql(
              "INSERT OR REPLACE INTO audio_analysis_jobs (id, song_id, status, stage, progress, server_url, attempt, updated_at) VALUES (?, ?, 'queued', 'queued', 0, ?, ?, ?)",
              [id, songId, serverUrl, attempt, now]
            );
            done({
              id,
              songId,
              status: "queued",
              stage: "queued",
              progress: 0,
              serverJobId: null,
              serverUrl,
              error: null,
              attempt,
              updatedAt: now
            });
          }
        );
      }
    );
  });
}

type JobPatch = Partial<
  Pick<AnalysisJob, "status" | "stage" | "progress" | "serverJobId" | "error">
>;
export function updateAnalysisJob(id: string, patch: JobPatch) {
  if (
    patch.progress !== undefined &&
    (!Number.isFinite(patch.progress) ||
      patch.progress < 0 ||
      patch.progress > 1)
  )
    throw new Error("AnalysisInvalidProgress");
  if (
    patch.status &&
    ![
      "queued",
      "uploading",
      "running",
      "failed",
      "cancelled",
      "interrupted"
    ].includes(patch.status)
  )
    throw new Error("AnalysisInvalidStatus");
  const columns = {
    status: "status",
    stage: "stage",
    progress: "progress",
    serverJobId: "server_job_id",
    error: "error"
  };
  const entries = Object.entries(patch).filter(
    ([, value]) => value !== undefined
  );
  const values = entries.map(([, value]) => value as string | number | null);
  return transaction<boolean>((tx, done) => {
    tx.executeSql(
      `UPDATE audio_analysis_jobs SET ${entries
        .map(([key]) => `${columns[key as keyof JobPatch]} = ?`)
        .concat("updated_at = ?")
        .join(", ")} WHERE id = ? AND status IN ${active}`,
      [...values, Date.now(), id],
      (_, result) => done(result.rowsAffected > 0)
    );
  });
}

export const cancelAnalysis = (id: string) =>
  updateAnalysisJob(id, {
    status: "cancelled",
    stage: "cancelled",
    error: null
  });

function checkDuration(analysis: SongAnalysis, duration: number) {
  // Container duration and decoded PCM duration can differ by a codec frame.
  if (Math.abs(analysis.duration - duration) > 0.5)
    throw new Error("AnalysisDurationMismatch");
}

function contentFromAnalysis(analysis: SongAnalysis) {
  return analysis.lyrics.map((line) => line.text).join("\n");
}

export function completeAnalysis(
  id: string,
  value: SongAnalysis,
  partial = false
) {
  const analysis = validateSongAnalysis(value);
  const json = JSON.stringify(analysis);
  return transaction<{ applied: boolean; preservedManual: boolean }>(
    (tx, done) => {
      tx.executeSql(
        `SELECT a.* FROM audio_analysis_jobs j JOIN song_audio a ON a.song_id = j.song_id WHERE j.id = ? AND j.status IN ${active}`,
        [id],
        (_, result) => {
          if (!result.rows.length) {
            done({ applied: false, preservedManual: false });
            return;
          }
          const audio = result.rows.item(0);
          checkDuration(analysis, audio.duration);
          const preservedManual =
            audio.manually_edited === 1 && !!audio.analysis_json;
          const now = Date.now();
          tx.executeSql(
            preservedManual
              ? "UPDATE song_audio SET generated_json = ?, revision = revision + 1, updated_at = ? WHERE song_id = ?"
              : "UPDATE song_audio SET analysis_json = ?, generated_json = ?, revision = revision + 1, updated_at = ? WHERE song_id = ?",
            preservedManual
              ? [json, now, audio.song_id]
              : [json, json, now, audio.song_id]
          );
          if (!preservedManual)
            tx.executeSql("UPDATE songs SET content = ? WHERE id = ?", [
              contentFromAnalysis(analysis),
              audio.song_id
            ]);
          tx.executeSql(
            "UPDATE audio_analysis_jobs SET status = ?, stage = 'completed', progress = 1, error = NULL, updated_at = ? WHERE id = ?",
            [partial ? "partial" : "completed", now, id]
          );
          done({ applied: true, preservedManual });
        }
      );
    }
  );
}

function editAnalysis(
  songId: number,
  expectedRevision: number,
  value: SongAnalysis | null
) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("AnalysisRevisionConflict");
  const manual = value ? validateSongAnalysis(value) : null;
  return transaction<number>((tx, done) => {
    tx.executeSql(
      "SELECT * FROM song_audio WHERE song_id = ?",
      [songId],
      (_, result) => {
        if (
          !result.rows.length ||
          result.rows.item(0).revision !== expectedRevision
        )
          throw new Error("AnalysisRevisionConflict");
        const audio = result.rows.item(0);
        const analysis =
          manual ??
          (audio.generated_json
            ? validateSongAnalysis(JSON.parse(audio.generated_json))
            : null);
        if (!analysis) throw new Error("AnalysisResultMissing");
        checkDuration(analysis, audio.duration);
        tx.executeSql(
          "UPDATE song_audio SET analysis_json = ?, manually_edited = ?, revision = revision + 1, updated_at = ? WHERE song_id = ? AND revision = ?",
          [
            JSON.stringify(analysis),
            manual ? 1 : 0,
            Date.now(),
            songId,
            expectedRevision
          ],
          (_tx, changed) => {
            if (!changed.rowsAffected)
              throw new Error("AnalysisRevisionConflict");
          }
        );
        tx.executeSql("UPDATE songs SET content = ? WHERE id = ?", [
          contentFromAnalysis(analysis),
          songId
        ]);
        done(expectedRevision + 1);
      }
    );
  });
}

export const saveManualAnalysis = (
  songId: number,
  value: SongAnalysis,
  expectedRevision: number
) => editAnalysis(songId, expectedRevision, value);
export const acceptGeneratedAnalysis = (
  songId: number,
  expectedRevision: number
) => editAnalysis(songId, expectedRevision, null);

/** Call once at startup, before starting new work, never during active processing. */
export function recoverInterruptedJobs() {
  return transaction<number>((tx, done) => {
    tx.executeSql(
      `UPDATE audio_analysis_jobs SET status = 'interrupted', stage = 'interrupted', error = 'AnalysisInterrupted', updated_at = ? WHERE status IN ${active}`,
      [Date.now()],
      (_, result) => done(result.rowsAffected)
    );
  });
}
