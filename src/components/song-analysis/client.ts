import { db } from "../database";
import { getAllItems } from "../database/crud";
import {
  beginAnalysis,
  cancelAnalysis,
  completeAnalysis,
  getAnalysisJob,
  getAudioSong,
  updateAnalysisJob
} from "../database/audio-analysis";
import { Dirs } from "react-native-file-access";
import { validateSongAnalysis } from "./types";

export interface AnalysisSettings {
  url: string;
  token: string;
  language: "auto" | "uk" | "ru" | "en";
}
export const defaultAnalysisSettings: AnalysisSettings = {
  url: "",
  token: "",
  language: "auto"
};

/** HTTPS, or explicitly configured local HTTP. Never a bundled public service. */
export function analysisServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("AnalysisInvalidServer");
  }
  const host = url.hostname.toLowerCase();
  const local =
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^(127|10)\.(\d{1,3}\.){2}\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("AnalysisInvalidServer");
  return url.toString().replace(/\/+$/, "");
}

export async function loadAnalysisSettings(): Promise<AnalysisSettings> {
  const [row] = await getAllItems<{ value: string }>({
    tableName: "settings",
    filters: "key = ?",
    parameters: ["audio_analysis_server"]
  });
  if (!row) return defaultAnalysisSettings;
  try {
    const value = JSON.parse(row.value) as Partial<AnalysisSettings>;
    return {
      url: typeof value.url === "string" ? value.url : "",
      token: typeof value.token === "string" ? value.token : "",
      language: ["uk", "ru", "en"].includes(value.language ?? "")
        ? (value.language as AnalysisSettings["language"])
        : "auto"
    };
  } catch {
    return defaultAnalysisSettings;
  }
}

export async function saveAnalysisSettings(settings: AnalysisSettings) {
  const normalized = { ...settings, url: analysisServerUrl(settings.url) };
  // App-private settings; server credentials are deliberately excluded from backups.
  await new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) =>
        tx.executeSql(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          ["audio_analysis_server", JSON.stringify(normalized)]
        ),
      reject,
      resolve
    );
  });
  return normalized;
}

type RemoteJob = {
  id: string;
  audio_sha256: string;
  idempotency_key: string;
  status: string;
  stage: string;
  progress: number;
  error?: string | null;
  result?: unknown;
};
type Running = {
  jobId: string;
  settings: AnalysisSettings;
  remoteId?: string;
  abort: AbortController;
};
const running = new Map<number, Running>();
const listeners = new Set<() => void>();
export function subscribeAnalysis(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const notify = () => listeners.forEach((listener) => listener());
export const analysisIsRunning = (songId: number) => running.has(songId);

function remoteJob(
  value: unknown,
  expected: { sha256: string; key: string; id?: string }
): RemoteJob {
  if (!value || typeof value !== "object")
    throw new Error("AnalysisInvalidResponse");
  const job = value as RemoteJob;
  if (
    typeof job.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(job.id) ||
    job.audio_sha256 !== expected.sha256 ||
    job.idempotency_key !== expected.key ||
    (expected.id !== undefined && job.id !== expected.id) ||
    ![
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
      "cancelled",
      "interrupted"
    ].includes(job.status) ||
    typeof job.stage !== "string" ||
    job.stage.length > 80 ||
    !Number.isFinite(job.progress) ||
    job.progress < 0 ||
    job.progress > 1
  )
    throw new Error("AnalysisInvalidResponse");
  return job;
}

async function request(
  settings: AnalysisSettings,
  path: string,
  signal: AbortSignal,
  init: NonNullable<Parameters<typeof fetch>[1]> = {},
  timeoutMs = 30000
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${analysisServerUrl(settings.url)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(settings.token
          ? { Authorization: `Bearer ${settings.token}` }
          : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "AnalysisUnauthorized"
          : response.status === 413
            ? "AudioTooLarge"
            : response.status === 503
              ? "AnalysisModelsMissing"
              : "AnalysisServerError";
      throw new Error(code);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("AnalysisCancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1500);
    signal.addEventListener("abort", abort);
    if (signal.aborted) abort();
  });
}

async function discardRemote(state: Running) {
  if (!state.remoteId) return;
  const controller = new AbortController();
  try {
    await request(
      state.settings,
      `/v1/jobs/${state.remoteId}`,
      controller.signal,
      { method: "DELETE" },
      5000
    );
  } catch {
    // Server retention policy is the fallback when the phone loses its connection.
  }
}

/** Call ONLY after the user confirms the destination and upload. */
export async function startSongAnalysis(
  songId: number,
  settings: AnalysisSettings
) {
  if (running.has(songId)) throw new Error("AnalysisAlreadyRunning");
  const normalized = { ...settings, url: analysisServerUrl(settings.url) };
  // Register before any asynchronous setup so a fast cancellation cannot race
  // settings reads and start uploading after the user has already cancelled.
  const state: Running = {
    jobId: "",
    settings: normalized,
    abort: new AbortController()
  };
  running.set(songId, state);
  notify();
  try {
    await saveAnalysisSettings(normalized);
    if (state.abort.signal.aborted) return;
    const audio = await getAudioSong(songId);
    if (state.abort.signal.aborted) return;
    if (!audio?.fileName) throw new Error("AudioMissing");
    const previous = await getAnalysisJob(songId);
    if (state.abort.signal.aborted) return;
    // A failed network request may have left an older server job; do not reuse its
    // generation or overwrite the current editable result with a late response.
    if (previous?.serverJobId && previous.serverUrl === normalized.url) {
      await discardRemote({
        jobId: previous.id,
        remoteId: previous.serverJobId,
        settings: normalized,
        abort: new AbortController()
      });
    }
    if (state.abort.signal.aborted) return;
    const job = await beginAnalysis(songId, normalized.url);
    state.jobId = job.id;
    if (state.abort.signal.aborted) {
      await cancelAnalysis(job.id);
      return;
    }
    const health = (await request(
      normalized,
      "/health",
      state.abort.signal
    )) as { ready?: boolean };
    if (state.abort.signal.aborted) return;
    if (health.ready !== true) throw new Error("AnalysisModelsMissing");
    await updateAnalysisJob(job.id, {
      status: "uploading",
      stage: "uploading",
      progress: 0
    });
    notify();
    const form = new FormData();
    form.append("file", {
      uri: `file://${Dirs.DocumentDir}/FreeTuneAudio/${audio.fileName}`,
      // Android providers can omit or mislabel the display-name extension.
      // The stable basename was chosen from verified file magic during import.
      name: audio.fileName,
      type: audio.mimeType
    } as unknown as Blob);
    form.append("language", normalized.language);
    form.append("idempotency_key", job.id);
    form.append("audio_sha256", audio.sha256);
    const expected = { sha256: audio.sha256, key: job.id };
    let remote = remoteJob(
      await request(
        normalized,
        "/v1/jobs",
        state.abort.signal,
        { method: "POST", body: form },
        10 * 60 * 1000
      ),
      expected
    );
    state.remoteId = remote.id;
    if (state.abort.signal.aborted) return;
    await updateAnalysisJob(job.id, { serverJobId: remote.id });
    for (;;) {
      if (state.abort.signal.aborted) return;
      if (remote.status === "completed" || remote.status === "partial") {
        const result = validateSongAnalysis(remote.result);
        if (Math.abs(result.duration - audio.duration) > 0.5) {
          throw new Error("AnalysisDurationMismatch");
        }
        await completeAnalysis(job.id, result, remote.status === "partial");
        return;
      }
      if (["failed", "cancelled", "interrupted"].includes(remote.status)) {
        // A worker can run out of memory after chords were persisted. Keep that
        // useful, validated partial instead of discarding the successful stage.
        if (remote.status !== "cancelled" && remote.result) {
          let partial;
          try {
            partial = validateSongAnalysis(remote.result);
          } catch {
            /* no valid partial */
          }
          if (partial && (partial.lyrics.length || partial.chords.length)) {
            if (Math.abs(partial.duration - audio.duration) > 0.5)
              throw new Error("AnalysisDurationMismatch");
            partial.warnings = [
              ...partial.warnings,
              "AnalysisPartialResult"
            ].slice(-128);
            await completeAnalysis(job.id, partial, true);
            return;
          }
        }
        throw new Error(
          remote.error && /^Analysis[A-Za-z]+$/.test(remote.error)
            ? remote.error
            : "AnalysisFailed"
        );
      }
      await updateAnalysisJob(job.id, {
        status: "running",
        stage: remote.stage,
        progress: remote.progress
      });
      notify();
      await waitForPoll(state.abort.signal);
      remote = remoteJob(
        await request(
          normalized,
          `/v1/jobs/${state.remoteId}`,
          state.abort.signal
        ),
        { ...expected, id: state.remoteId }
      );
    }
  } catch (error) {
    if (!state.abort.signal.aborted) {
      if (!state.jobId) throw error;
      const message = error instanceof Error ? error.message : "AnalysisFailed";
      await updateAnalysisJob(state.jobId, {
        status: "failed",
        stage: "failed",
        error: /^(Analysis|Audio)[A-Za-z]+$/.test(message)
          ? message
          : "AnalysisConnectionLost"
      });
    }
  } finally {
    // Preserve the local result before deleting temporary server audio/results.
    await discardRemote(state);
    if (running.get(songId) === state) running.delete(songId);
    notify();
  }
}

export async function cancelSongAnalysis(songId: number) {
  const state = running.get(songId);
  if (state) state.abort.abort();
  const job = await getAnalysisJob(songId);
  if (job) await cancelAnalysis(job.id);
  // Local cancellation is durable before slow best-effort server cleanup;
  // a new retry gets its own generation and need not wait for a dead server.
  if (state && running.get(songId) === state) running.delete(songId);
  notify();
  if (state) await discardRemote(state);
}
