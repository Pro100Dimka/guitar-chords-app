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
import {
  AnalysisInstallation,
  AnalysisSettings,
  analysisDestination,
  analysisMode,
  analysisServerUrl,
  forgetAnalysisInstallation,
  loadAnalysisInstallation,
  saveAnalysisInstallation,
  saveAnalysisSettings,
  validInstallation,
  validateServiceHealth
} from "./service-config";
export {
  analysisDestination,
  analysisMode,
  analysisServerUrl,
  defaultAnalysisSettings,
  loadAnalysisSettings,
  saveAnalysisSettings
} from "./service-config";
export type { AnalysisSettings } from "./service-config";

type RemoteJob = {
  id: string;
  audio_sha256: string;
  idempotency_key: string;
  status: string;
  stage: string;
  progress: number;
  queuePosition?: number;
  error?: string | null;
  result?: unknown;
};
export interface AnalysisNetworkStatus {
  queuePosition?: number;
  retryAfterSeconds?: number;
  retryUntil?: number;
}
type Running = AnalysisNetworkStatus & {
  jobId: string;
  // This connection/owner is fixed before POST and never renewed within a job.
  settings: AnalysisSettings;
  remoteId?: string;
  uploadStarted?: boolean;
  abort: AbortController;
  cleanup?: Promise<void>;
  cancellation?: Promise<void>;
};
const running = new Map<number, Running>();
const backoff = new Map<number, number>();
const listeners = new Set<() => void>();
export function subscribeAnalysis(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const notify = () => listeners.forEach((listener) => listener());
export const analysisIsRunning = (songId: number) => running.has(songId);
export function analysisNetworkStatus(songId: number): AnalysisNetworkStatus {
  const state = running.get(songId);
  const retryUntil = state?.retryUntil ?? backoff.get(songId);
  const retryAfterSeconds = retryUntil
    ? Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000))
    : state?.retryAfterSeconds;
  if (retryAfterSeconds === 0) backoff.delete(songId);
  return {
    queuePosition: state?.queuePosition,
    retryAfterSeconds,
    retryUntil: retryAfterSeconds ? retryUntil : undefined
  };
}

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
    job.progress > 1 ||
    (job.queuePosition !== undefined &&
      (!Number.isSafeInteger(job.queuePosition) || job.queuePosition < 0))
  )
    throw new Error("AnalysisInvalidResponse");
  return job;
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}
export function analysisRetryAfter(
  value: string | null | undefined,
  now = Date.now()
) {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(86400, Math.max(1, Math.ceil(seconds)))
    : undefined;
}
async function request(
  settings: AnalysisSettings,
  path: string,
  signal: AbortSignal,
  init: NonNullable<Parameters<typeof fetch>[1]> = {},
  timeoutMs = 30000
): Promise<unknown> {
  if (signal.aborted) throw new Error("AnalysisCancelled");
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
      if (
        response.status === 401 &&
        analysisMode(settings) === "shared" &&
        settings.token
      )
        await forgetAnalysisInstallation(settings.url, settings.token);
      const code =
        response.status === 401 || response.status === 403
          ? analysisMode(settings) === "shared"
            ? "AnalysisAccessExpired"
            : "AnalysisUnauthorized"
          : response.status === 413
            ? "AnalysisUploadTooLarge"
            : response.status === 429
              ? "AnalysisRateLimited"
              : response.status === 503
                ? "AnalysisServiceBusy"
                : "AnalysisServerError";
      throw new RequestError(
        code,
        response.status,
        analysisRetryAfter(response.headers?.get("Retry-After"))
      );
    }
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw new Error("AnalysisCancelled");
    if (error instanceof RequestError) throw error;
    if (error instanceof SyntaxError)
      throw new Error("AnalysisInvalidResponse");
    throw new RequestError("AnalysisConnectionLost", 0);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Public metadata only: no registration and no audio is sent here. */
export async function inspectAnalysisService(
  settings: AnalysisSettings,
  signal = new AbortController().signal
) {
  const mode = analysisMode(settings);
  const connection = {
    ...settings,
    mode,
    url: analysisDestination(settings),
    token: mode === "shared" ? "" : settings.token
  };
  return validateServiceHealth(
    await request(connection, "/health", signal),
    mode === "shared"
  );
}
const registrations = new Map<string, Promise<AnalysisInstallation>>();
async function installation(url: string): Promise<AnalysisInstallation> {
  const pending = registrations.get(url);
  if (pending) return pending;
  const registration = (async () => {
    const stored = await loadAnalysisInstallation(url);
    if (stored && stored.expiresAt > Math.floor(Date.now() / 1000) + 60)
      return stored;
    // A registration can be shared by concurrent songs. Cancelling one song
    // must not abort another song's registration. Each caller checks cancellation
    // again after this promise resolves and before creating/uploading audio.
    const identity = await request(
      { mode: "shared", url, token: "", language: "auto" },
      "/v1/installations",
      new AbortController().signal,
      { method: "POST" }
    );
    if (
      !validInstallation(identity) ||
      identity.expiresAt <= Date.now() / 1000 ||
      identity.expiresAt > Date.now() / 1000 + 91 * 86400
    )
      throw new Error("AnalysisInvalidResponse");
    await saveAnalysisInstallation(url, identity);
    return identity;
  })();
  registrations.set(url, registration);
  try {
    return await registration;
  } finally {
    if (registrations.get(url) === registration) registrations.delete(url);
  }
}

function waitForPoll(signal: AbortSignal, milliseconds = 1500) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("AnalysisCancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort);
    if (signal.aborted) abort();
  });
}
async function pollRemote(state: Running): Promise<unknown> {
  for (let failures = 0; ; failures++) {
    try {
      const result = await request(
        state.settings,
        `/v1/jobs/${state.remoteId}`,
        state.abort.signal
      );
      state.retryAfterSeconds = undefined;
      state.retryUntil = undefined;
      return result;
    } catch (error) {
      // Only GET is retried. Never create a second remote job/generation after
      // a temporary polling failure, and never change its installation owner.
      if (
        !(error instanceof RequestError) ||
        ![0, 429, 503].includes(error.status) ||
        failures >= 4
      )
        throw error;
      state.retryAfterSeconds =
        error.retryAfterSeconds ?? Math.ceil((1500 * 2 ** failures) / 1000);
      state.retryUntil = Date.now() + state.retryAfterSeconds * 1000;
      notify();
      await waitForPoll(state.abort.signal, state.retryAfterSeconds * 1000);
    }
  }
}
async function discardRemote(state: Running) {
  if (state.cancellation) await state.cancellation;
  const path = state.remoteId
    ? `/v1/jobs/${state.remoteId}`
    : state.uploadStarted && state.jobId
      ? `/v1/job-requests/${state.jobId}`
      : null;
  if (!path) return;
  if (state.cleanup) return state.cleanup;
  state.cleanup = (async () => {
    try {
      await request(
        state.settings,
        path,
        new AbortController().signal,
        { method: "DELETE" },
        5000
      );
    } catch {
      // Server retention is the fallback when the phone loses its connection.
    }
  })();
  return state.cleanup;
}

/** Call ONLY after the user confirms the destination and complete-file upload. */
export async function startSongAnalysis(
  songId: number,
  settings: AnalysisSettings
) {
  if (running.has(songId)) throw new Error("AnalysisAlreadyRunning");
  const mode = analysisMode(settings);
  const normalized = {
    ...settings,
    mode,
    url: analysisDestination(settings),
    token: mode === "shared" ? "" : settings.token
  };
  // Register locally before any await so a quick cancellation cannot race setup.
  const state: Running = {
    jobId: "",
    settings: normalized,
    abort: new AbortController()
  };
  running.set(songId, state);
  backoff.delete(songId);
  notify();
  try {
    await saveAnalysisSettings(settings);
    if (state.abort.signal.aborted) return;
    const audio = await getAudioSong(songId);
    if (state.abort.signal.aborted) return;
    if (!audio?.fileName) throw new Error("AudioMissing");
    const previous = await getAnalysisJob(songId);
    if (state.abort.signal.aborted) return;
    const job = await beginAnalysis(songId, normalized.url);
    state.jobId = job.id;
    if (state.abort.signal.aborted) {
      await cancelAnalysis(job.id);
      return;
    }
    const health = validateServiceHealth(
      await request(normalized, "/health", state.abort.signal),
      mode === "shared"
    );
    if (state.abort.signal.aborted) return;
    if (!health.ready) throw new Error("AnalysisServiceNotReady");
    if (health.limits && audio.bytes > health.limits.uploadBytes)
      throw new Error("AnalysisUploadTooLarge");
    if (health.limits && audio.duration > health.limits.durationSeconds)
      throw new Error("AnalysisDurationLimit");
    if (mode === "shared") {
      const identity = await installation(normalized.url);
      if (state.abort.signal.aborted) return;
      state.settings = { ...normalized, token: identity.token };
    }
    // A previous failed upload may have left a remote job. Its local generation
    // stays distinct so a late response cannot replace the current editable result.
    if (previous?.serverJobId && previous.serverUrl === normalized.url) {
      await discardRemote({
        jobId: previous.id,
        remoteId: previous.serverJobId,
        settings: state.settings,
        abort: new AbortController()
      });
    }
    if (state.abort.signal.aborted) return;
    await updateAnalysisJob(job.id, {
      status: "uploading",
      stage: "uploading",
      progress: 0
    });
    if (state.abort.signal.aborted) return;
    notify();
    const form = new FormData();
    form.append("file", {
      uri: `file://${Dirs.DocumentDir}/FreeTuneAudio/${audio.fileName}`,
      name: audio.fileName,
      type: audio.mimeType
    } as unknown as Blob);
    form.append("language", normalized.language);
    form.append("idempotency_key", job.id);
    form.append("audio_sha256", audio.sha256);
    const expected = { sha256: audio.sha256, key: job.id };
    state.uploadStarted = true;
    let remote = remoteJob(
      await request(
        state.settings,
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
        if (Math.abs(result.duration - audio.duration) > 0.5)
          throw new Error("AnalysisDurationMismatch");
        await completeAnalysis(job.id, result, remote.status === "partial");
        return;
      }
      if (["failed", "cancelled", "interrupted"].includes(remote.status)) {
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
      state.queuePosition =
        remote.status === "queued" ? remote.queuePosition : undefined;
      await updateAnalysisJob(job.id, {
        status: remote.status === "queued" ? "queued" : "running",
        stage: remote.stage,
        progress: remote.progress
      });
      notify();
      await waitForPoll(state.abort.signal);
      remote = remoteJob(await pollRemote(state), {
        ...expected,
        id: state.remoteId
      });
    }
  } catch (error) {
    if (!state.abort.signal.aborted) {
      if (!state.jobId) throw error;
      if (error instanceof RequestError && error.retryAfterSeconds)
        backoff.set(songId, Date.now() + error.retryAfterSeconds * 1000);
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
    try {
      await discardRemote(state);
    } finally {
      if (running.get(songId) === state) running.delete(songId);
      notify();
    }
  }
}

export async function cancelSongAnalysis(songId: number) {
  const state = running.get(songId);
  const cancellation =
    state?.cancellation ??
    (async () => {
      if (state) {
        // Bind cancellation to the captured generation, never a later retry.
        // If setup has not created it yet, startSongAnalysis's abort guard
        // cancels the newly created local row before any audio is uploaded.
        if (state.jobId) await cancelAnalysis(state.jobId);
        return;
      }
      const job = await getAnalysisJob(songId);
      if (job && !running.has(songId)) await cancelAnalysis(job.id);
    })();
  if (state) {
    state.cancellation = cancellation;
    state.abort.abort();
  }
  await cancellation;
  backoff.delete(songId);
  // Local cancellation is durable first; DELETE uses a separate, bounded signal.
  if (state && running.get(songId) === state) running.delete(songId);
  notify();
  if (state) await discardRemote(state);
}
