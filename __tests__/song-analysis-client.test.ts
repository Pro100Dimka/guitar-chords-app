import { db } from "../src/components/database";
import { getAllItems } from "../src/components/database/crud";
import bundledService from "../src/config/analysis-service.json";
import {
  beginAnalysis,
  cancelAnalysis,
  completeAnalysis,
  getAnalysisJob,
  getAudioSong,
  updateAnalysisJob
} from "../src/components/database/audio-analysis";
import {
  analysisIsRunning,
  analysisServerUrl,
  analysisNetworkStatus,
  analysisRetryAfter,
  loadAnalysisSettings,
  saveAnalysisSettings,
  cancelSongAnalysis,
  startSongAnalysis
} from "../src/components/song-analysis/client";
import { SongAnalysis } from "../src/components/song-analysis/types";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));
jest.mock("react-native-file-access", () => ({
  Dirs: { DocumentDir: "/documents" }
}));
jest.mock("../src/components/database/audio-analysis", () => ({
  beginAnalysis: jest.fn(),
  cancelAnalysis: jest.fn(),
  completeAnalysis: jest.fn(),
  getAnalysisJob: jest.fn(),
  getAudioSong: jest.fn(),
  updateAnalysisJob: jest.fn()
}));

const settings = {
  url: "http://192.168.1.10:8765",
  token: "local-test-token",
  language: "uk" as const
};
const hash = "a".repeat(64);
const result: SongAnalysis = {
  version: 1,
  duration: 20,
  language: "uk",
  lyrics: [],
  chords: [{ start: 0, end: 20, label: "Am" }],
  warnings: [],
  model: { lyrics: "test", alignment: "test", chords: "test" }
};
const response = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response);
const remote = (patch: Record<string, unknown> = {}) => ({
  id: "remote-1",
  audio_sha256: hash,
  idempotency_key: "local-1",
  status: "completed",
  stage: "done",
  progress: 1,
  result,
  ...patch
});
const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;
const storedSettings = new Map<string, string>();
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  globalThis.fetch = fetchMock;
  bundledService.url = "";
  storedSettings.clear();
  jest
    .mocked(getAllItems)
    .mockImplementation(
      async ({ parameters = [] }) =>
        parameters.flatMap((key) =>
          storedSettings.has(String(key))
            ? [{ key, value: storedSettings.get(String(key)) }]
            : []
        ) as never
    );
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({
      executeSql: jest.fn((sql, parameters = [], callback) => {
        if (sql.startsWith("INSERT"))
          storedSettings.set(parameters[0], parameters[1]);
        if (sql.startsWith("SELECT")) {
          const value = storedSettings.get(parameters[0]);
          callback?.(
            { executeSql: jest.fn() },
            {
              rows: { length: value ? 1 : 0, item: () => ({ value }) },
              rowsAffected: 0,
              insertId: 0
            }
          );
        }
      })
    });
    success?.();
  });
  jest.mocked(getAudioSong).mockResolvedValue({
    songId: 7,
    sha256: hash,
    fileName: `${hash}.wav`,
    originalName: "provider display name without extension",
    mimeType: "audio/wav",
    bytes: 1000,
    duration: 20,
    analysis: result,
    generatedAnalysis: result,
    revision: 3,
    manuallyEdited: true,
    updatedAt: 1
  });
  jest.mocked(getAnalysisJob).mockResolvedValue(null);
  jest.mocked(beginAnalysis).mockResolvedValue({
    id: "local-1",
    songId: 7,
    status: "queued",
    stage: "queued",
    progress: 0,
    serverJobId: null,
    serverUrl: settings.url,
    error: null,
    attempt: 1,
    updatedAt: 1
  });
  jest.mocked(updateAnalysisJob).mockResolvedValue(true);
  jest.mocked(cancelAnalysis).mockResolvedValue(true);
  jest
    .mocked(completeAnalysis)
    .mockResolvedValue({ applied: true, preservedManual: true });
});
afterEach(() => {
  bundledService.url = "";
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test.each([
  "https://analysis.example.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://10.0.0.2",
  "http://172.16.1.2",
  "http://192.168.1.20",
  "http://[::1]:8765",
  "http://freetune.local:8765"
])("accepts explicitly configured secure/local endpoint %s", (url) => {
  expect(analysisServerUrl(url)).toBe(url);
});
test.each([
  "http://example.com",
  "http://172.32.0.1",
  "https://user:pass@example.com",
  "https://example.com?token=secret",
  "https://example.com#fragment",
  "file:///audio",
  "javascript:alert(1)"
])("rejects unsafe endpoint %s", (url) => {
  expect(() => analysisServerUrl(url)).toThrow("AnalysisInvalidServer");
});

test("sends exact local audio hash/current attempt, stores useful result before remote cleanup", async () => {
  const calls: string[] = [];
  const append = jest.spyOn(FormData.prototype, "append");
  jest.mocked(completeAnalysis).mockImplementation(async () => {
    calls.push("persist");
    return { applied: true, preservedManual: true };
  });
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") {
      calls.push("delete");
      return response({ ok: true });
    }
    const form = init?.body as FormData;
    const fields = form as unknown as {
      get?: (name: string) => unknown;
      getParts?: () => { fieldName: string; string?: string }[];
    };
    const field = (name: string) =>
      fields.get
        ? fields.get(name)
        : fields.getParts?.().find((part) => part.fieldName === name)?.string;
    expect(field("audio_sha256")).toBe(hash);
    expect(field("idempotency_key")).toBe("local-1");
    return response(remote());
  });
  await startSongAnalysis(7, settings);
  expect(completeAnalysis).toHaveBeenCalledWith("local-1", result, false);
  expect(append).toHaveBeenCalledWith("file", {
    uri: `file:///documents/FreeTuneAudio/${hash}.wav`,
    name: `${hash}.wav`,
    type: "audio/wav"
  });
  expect(calls).toEqual(["persist", "delete"]);
  expect(analysisIsRunning(7)).toBe(false);
});

test("cancel during asynchronous setup cannot later start upload", async () => {
  let resume!: () => void;
  jest.mocked(db.transaction).mockImplementation((_body, _error, success) => {
    resume = () => success?.();
  });
  const pending = startSongAnalysis(7, settings);
  expect(analysisIsRunning(7)).toBe(true);
  await expect(startSongAnalysis(7, settings)).rejects.toThrow(
    "AnalysisAlreadyRunning"
  );
  await cancelSongAnalysis(7);
  resume();
  await pending;
  expect(beginAnalysis).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(["health", "upload", "poll"])(
  "cancellation during %s aborts request and never applies a late completion",
  async (phase) => {
    let requested = false;
    fetchMock.mockImplementation((url, init) => {
      const path = String(url);
      if (init?.method === "DELETE") return response({ ok: true });
      const block =
        phase === "health"
          ? path.endsWith("/health")
          : phase === "upload"
            ? init?.method === "POST"
            : path.endsWith("/remote-1");
      if (block) {
        requested = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("Aborted"))
          );
        });
      }
      return path.endsWith("/health")
        ? response({ ready: true })
        : response(
            remote({
              status: "running",
              stage: "lyrics",
              progress: 0.5,
              result: null
            })
          );
    });
    const pending = startSongAnalysis(7, settings);
    await flush();
    if (phase === "poll") await jest.advanceTimersByTimeAsync(1500);
    expect(requested).toBe(true);
    await cancelSongAnalysis(7);
    await pending;
    expect(completeAnalysis).not.toHaveBeenCalled();
    expect(updateAnalysisJob).not.toHaveBeenCalledWith(
      "local-1",
      expect.objectContaining({ status: "failed" })
    );
    expect(analysisIsRunning(7)).toBe(false);
  }
);

test("a server's late response after cancellation is ignored even if transport does not abort", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") return response({ ok: true });
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const pending = startSongAnalysis(7, settings);
  await flush();
  await cancelSongAnalysis(7);
  finish(await response(remote()));
  await pending;
  expect(completeAnalysis).not.toHaveBeenCalled();
});

test.each([
  { audio_sha256: "b".repeat(64) },
  { idempotency_key: "stale-attempt" },
  { result: { ...result, duration: 21 } },
  { result: { ...result, chords: [{ start: 4, end: 2, label: "C" }] } },
  { status: "failed", result: { ...result, duration: 21 } },
  {
    status: "failed",
    result: { ...result, chords: [{ start: 4, end: 2, label: "C" }] }
  }
])(
  "wrong-source, stale or malformed output cannot overwrite stored manual data",
  async (patch) => {
    fetchMock.mockImplementation((url, init) =>
      String(url).endsWith("/health")
        ? response({ ready: true })
        : init?.method === "DELETE"
          ? response({ ok: true })
          : response(remote(patch))
    );
    await startSongAnalysis(7, settings);
    expect(completeAnalysis).not.toHaveBeenCalled();
    expect(updateAnalysisJob).toHaveBeenCalledWith(
      "local-1",
      expect.objectContaining({ status: "failed" })
    );
  }
);

test("a poll response for a different job id is rejected", async () => {
  fetchMock.mockImplementation((url, init) =>
    String(url).endsWith("/health")
      ? response({ ready: true })
      : init?.method === "DELETE"
        ? response({ ok: true })
        : init?.method === "POST"
          ? response(
              remote({
                status: "running",
                stage: "chords",
                progress: 0.2,
                result: null
              })
            )
          : response(remote({ id: "different-job" }))
  );
  const pending = startSongAnalysis(7, settings);
  await flush();
  await jest.advanceTimersByTimeAsync(1500);
  await pending;
  expect(completeAnalysis).not.toHaveBeenCalled();
});

test("worker failure retains a strictly validated successful stage as a reviewable partial", async () => {
  fetchMock.mockImplementation((url, init) =>
    String(url).endsWith("/health")
      ? response({ ready: true })
      : init?.method === "DELETE"
        ? response({ ok: true })
        : response(remote({ status: "failed", error: "worker_out_of_memory" }))
  );
  await startSongAnalysis(7, settings);
  expect(completeAnalysis).toHaveBeenCalledWith(
    "local-1",
    expect.objectContaining({
      chords: result.chords,
      warnings: ["AnalysisPartialResult"]
    }),
    true
  );
});

test("network failure marks the attempt retryable without erasing previous results", async () => {
  fetchMock.mockRejectedValue(new Error("Network unavailable"));
  await startSongAnalysis(7, settings);
  expect(completeAnalysis).not.toHaveBeenCalled();
  expect(updateAnalysisJob).toHaveBeenCalledWith("local-1", {
    status: "failed",
    stage: "failed",
    error: "AnalysisConnectionLost"
  });
});

test("a stalled health request times out and becomes a retryable failure", async () => {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("Aborted"))
        );
      })
  );
  const pending = startSongAnalysis(7, settings);
  await flush();
  await jest.advanceTimersByTimeAsync(30000);
  await pending;
  expect(analysisIsRunning(7)).toBe(false);
  expect(completeAnalysis).not.toHaveBeenCalled();
  expect(updateAnalysisJob).toHaveBeenCalledWith(
    "local-1",
    expect.objectContaining({ status: "failed" })
  );
});

const shared = {
  mode: "shared" as const,
  url: "",
  token: "",
  language: "en" as const
};
const sharedUrl = "https://freetune.test";
const sharedHealth = {
  ready: true,
  serviceMode: "shared",
  authentication: "installation",
  limits: {
    uploadBytes: 256 * 1024 * 1024,
    durationSeconds: 1800,
    activeJobsPerInstallation: 2,
    jobsPerDay: 20
  },
  privacy: { audioDeletion: "after_processing", resultRetentionHours: 24 }
};
const identity = () => ({
  installationId: "installation-1",
  token: `ft1_${"c".repeat(64)}`,
  expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400
});
const storeIdentity = (value = identity()) =>
  storedSettings.set(
    "audio_analysis_installation",
    JSON.stringify({ version: 1, installations: { [sharedUrl]: value } })
  );
const storedIdentity = () =>
  JSON.parse(storedSettings.get("audio_analysis_installation") ?? "{}")
    .installations?.[sharedUrl];
const responseWithRetry = (status: number, retry: string) =>
  Promise.resolve({
    ok: false,
    status,
    headers: { get: (key: string) => (key === "Retry-After" ? retry : null) },
    json: async () => ({})
  } as Response);

test("empty release URL fails explicitly before registration or upload", async () => {
  await expect(startSongAnalysis(7, shared)).rejects.toThrow(
    "AnalysisServiceUnavailable"
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(beginAnalysis).not.toHaveBeenCalled();
});

test("legacy private settings and language survive switching between shared and private modes", async () => {
  storedSettings.set("audio_analysis_server", JSON.stringify(settings));
  expect(await loadAnalysisSettings()).toEqual({
    ...settings,
    mode: "private"
  });
  await saveAnalysisSettings({ ...settings, mode: "shared", language: "ru" });
  expect(storedSettings.get("audio_analysis_server")).toBe(
    JSON.stringify(settings)
  );
  expect(await loadAnalysisSettings()).toEqual({
    ...settings,
    mode: "shared",
    language: "ru"
  });
  await saveAnalysisSettings({ ...settings, mode: "private", language: "en" });
  expect(await loadAnalysisSettings()).toEqual({
    ...settings,
    mode: "private",
    language: "en"
  });
});

test("simultaneous songs share one persisted registration and attach its bearer token only to job requests", async () => {
  bundledService.url = sharedUrl;
  let finishRegistration!: (value: Response) => void;
  let registrations = 0;
  const posts: string[] = [];
  jest.mocked(beginAnalysis).mockImplementation(async (songId) => ({
    id: `local-${songId}`,
    songId,
    status: "queued",
    stage: "queued",
    progress: 0,
    serverJobId: null,
    serverUrl: sharedUrl,
    error: null,
    attempt: 1,
    updatedAt: 1
  }));
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) {
      expect(init?.headers).toEqual({});
      return response(sharedHealth);
    }
    if (String(url).endsWith("/installations")) {
      registrations++;
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toEqual({});
      return new Promise((resolve) => {
        finishRegistration = resolve;
      });
    }
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${identity().token}`
    });
    if (init?.method === "DELETE") return response({ ok: true });
    const form = init?.body as unknown as {
      get?: (name: string) => string;
      getParts?: () => { fieldName: string; string?: string }[];
    };
    const key = form.get
      ? form.get("idempotency_key")
      : form.getParts!().find((part) => part.fieldName === "idempotency_key")!
          .string!;
    posts.push(key);
    return response(remote({ id: `remote-${key}`, idempotency_key: key }));
  });
  const first = startSongAnalysis(7, shared);
  const second = startSongAnalysis(8, shared);
  await flush();
  expect(registrations).toBe(1);
  expect(posts).toEqual([]);
  finishRegistration(await response(identity(), 201));
  await Promise.all([first, second]);
  expect(posts.sort()).toEqual(["local-7", "local-8"]);
  expect(storedIdentity()).toEqual(identity());
  expect(completeAnalysis).toHaveBeenCalledTimes(2);
});

test("cancelling while registration is pending never uploads audio after the identity arrives", async () => {
  bundledService.url = sharedUrl;
  let finish!: (value: Response) => void;
  fetchMock.mockImplementation((url) =>
    String(url).endsWith("/health")
      ? response(sharedHealth)
      : new Promise((resolve) => {
          finish = resolve;
        })
  );
  const pending = startSongAnalysis(7, shared);
  await flush();
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/installations"))
  ).toBe(true);
  await cancelSongAnalysis(7);
  finish(await response(identity(), 201));
  await pending;
  expect(storedIdentity()).toEqual(identity());
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/jobs"))
  ).toBe(false);
  expect(completeAnalysis).not.toHaveBeenCalled();
});

test.each([
  { ready: false },
  { authentication: "none" },
  { privacy: { audioDeletion: "never", resultRetentionHours: 24 } },
  { limits: { ...sharedHealth.limits, durationSeconds: 10 } },
  { limits: { ...sharedHealth.limits, uploadBytes: 10 } }
])(
  "unready, incompatible or exceeded shared limits prevent both registration and upload",
  async (patch) => {
    bundledService.url = sharedUrl;
    fetchMock.mockImplementation(() => response({ ...sharedHealth, ...patch }));
    await startSongAnalysis(7, shared);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(completeAnalysis).not.toHaveBeenCalled();
    expect(updateAnalysisJob).toHaveBeenCalledWith(
      "local-1",
      expect.objectContaining({ status: "failed" })
    );
  }
);

test("a 401 on an accepted job forgets only its token and requires an explicit new attempt", async () => {
  bundledService.url = sharedUrl;
  storeIdentity();
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response(sharedHealth);
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${identity().token}`
    });
    if (init?.method === "DELETE") return response({ ok: true });
    if (init?.method === "POST")
      return response(
        remote({
          status: "queued",
          stage: "queued",
          progress: 0,
          queuePosition: 2,
          result: null
        })
      );
    return response({}, 401);
  });
  const pending = startSongAnalysis(7, shared);
  await flush();
  await jest.advanceTimersByTimeAsync(1500);
  await pending;
  expect(storedIdentity()).toBeUndefined();
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/installations"))
  ).toBe(false);
  expect(beginAnalysis).toHaveBeenCalledTimes(1);
  expect(updateAnalysisJob).toHaveBeenCalledWith(
    "local-1",
    expect.objectContaining({
      status: "failed",
      error: "AnalysisAccessExpired"
    })
  );
  expect(completeAnalysis).not.toHaveBeenCalled();
});

test("a late 401 cannot erase replacement access or switch the accepted job owner", async () => {
  bundledService.url = sharedUrl;
  const original = identity();
  const replacement = { ...identity(), token: `ft1_${"d".repeat(64)}` };
  storeIdentity(original);
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response(sharedHealth);
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${original.token}`
    });
    if (init?.method === "DELETE") return response({ ok: true });
    if (init?.method === "POST")
      return response(
        remote({ status: "running", progress: 0.2, result: null })
      );
    storeIdentity(replacement);
    return response({}, 401);
  });
  const pending = startSongAnalysis(7, shared);
  await flush();
  await jest.advanceTimersByTimeAsync(1500);
  await pending;
  expect(storedIdentity()).toEqual(replacement);
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/installations"))
  ).toBe(false);
});

test.each([0, 429, 503])(
  "a transient poll error %s retries the same job and generation, honoring Retry-After",
  async (status) => {
    let polls = 0;
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith("/health")) return response({ ready: true });
      if (init?.method === "DELETE") return response({ ok: true });
      if (init?.method === "POST")
        return response(
          remote({
            status: "queued",
            stage: "queued",
            progress: 0,
            queuePosition: 4,
            result: null
          })
        );
      polls++;
      if (polls === 1)
        return status === 0
          ? Promise.reject(new Error("network"))
          : responseWithRetry(status, "3");
      return response(remote());
    });
    const pending = startSongAnalysis(7, settings);
    await flush();
    expect(analysisNetworkStatus(7).queuePosition).toBe(4);
    await jest.advanceTimersByTimeAsync(1500);
    const delay = status === 0 ? 2 : 3;
    expect(analysisNetworkStatus(7).retryAfterSeconds).toBe(delay);
    await jest.advanceTimersByTimeAsync(delay * 1000 - 1);
    expect(polls).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(polls).toBe(2);
    expect(beginAnalysis).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(1);
    expect(completeAnalysis).toHaveBeenCalledWith("local-1", result, false);
  }
);

test("polling retries are bounded and never reupload after a prolonged failure", async () => {
  let polls = 0;
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") return response({ ok: true });
    if (init?.method === "POST")
      return response(
        remote({ status: "running", progress: 0.2, result: null })
      );
    polls++;
    return responseWithRetry(503, "1");
  });
  const pending = startSongAnalysis(7, settings);
  await flush();
  await jest.advanceTimersByTimeAsync(6000);
  await pending;
  expect(polls).toBe(5);
  expect(beginAnalysis).toHaveBeenCalledTimes(1);
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
  ).toHaveLength(1);
  expect(updateAnalysisJob).toHaveBeenCalledWith(
    "local-1",
    expect.objectContaining({ status: "failed", error: "AnalysisServiceBusy" })
  );
});

test("Retry-After accepts both HTTP dates and seconds and ignores malformed values", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  expect(analysisRetryAfter("7", now)).toBe(7);
  expect(analysisRetryAfter("Fri, 13 Nov 2026 12:00:09 GMT", now)).toBe(9);
  expect(analysisRetryAfter("yesterday", now)).toBeUndefined();
  expect(analysisRetryAfter("-1", now)).toBeUndefined();
});

test("cancellation commits locally before DELETE, which uses its own live bounded signal", async () => {
  let finishCancellation!: () => void;
  let deletes = 0;
  jest.mocked(getAnalysisJob).mockResolvedValue({
    id: "local-1",
    songId: 7,
    status: "running",
    stage: "lyrics",
    progress: 0.2,
    serverJobId: null,
    serverUrl: settings.url,
    error: null,
    attempt: 1,
    updatedAt: 1
  });
  jest.mocked(cancelAnalysis).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishCancellation = () => resolve(true);
      })
  );
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") {
      deletes++;
      expect(init.signal?.aborted).toBe(false);
      return response({ ok: true });
    }
    return response(remote({ status: "running", progress: 0.2, result: null }));
  });
  const pending = startSongAnalysis(7, settings);
  await flush();
  const cancelled = cancelSongAnalysis(7);
  await flush();
  expect(deletes).toBe(0);
  finishCancellation();
  await Promise.all([cancelled, pending]);
  expect(deletes).toBe(1);
  expect(completeAnalysis).not.toHaveBeenCalled();
});

test("cancellation uses the captured generation even if a delayed latest-job read would return a new attempt", async () => {
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") return response({ ok: true });
    return response(
      remote({ status: "queued", stage: "queued", progress: 0, result: null })
    );
  });
  const pending = startSongAnalysis(7, settings);
  await flush();
  jest.mocked(getAnalysisJob).mockClear();
  jest.mocked(getAnalysisJob).mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              id: "new-attempt",
              songId: 7,
              status: "running",
              stage: "lyrics",
              progress: 0,
              serverJobId: "remote-new",
              serverUrl: settings.url,
              error: null,
              attempt: 2,
              updatedAt: 2
            }),
          1000
        );
      })
  );
  const cancelled = cancelSongAnalysis(7);
  await flush();
  await jest.advanceTimersByTimeAsync(1000);
  await Promise.all([cancelled, pending]);
  expect(getAnalysisJob).not.toHaveBeenCalled();
  expect(cancelAnalysis).toHaveBeenCalledWith("local-1");
  expect(cancelAnalysis).not.toHaveBeenCalledWith("new-attempt");
});

test("an aborted accepted upload with no response cancels by the known local request key and original owner", async () => {
  const order: string[] = [];
  jest.mocked(cancelAnalysis).mockImplementation(async () => {
    order.push("local-cancel");
    return true;
  });
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") {
      order.push("remote-cancel");
      expect(String(url)).toBe(`${settings.url}/v1/job-requests/local-1`);
      expect(init.headers).toEqual({
        Authorization: `Bearer ${settings.token}`
      });
      expect(init.signal?.aborted).toBe(false);
      return response({
        cancellationRecorded: true,
        idempotency_key: "local-1",
        jobId: null,
        jobStatus: null
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("Aborted"))
      );
    });
  });
  const pending = startSongAnalysis(7, settings);
  await flush();
  await cancelSongAnalysis(7);
  await pending;
  expect(order).toEqual(["local-cancel", "remote-cancel"]);
  expect(completeAnalysis).not.toHaveBeenCalled();
});

test("an upload quota Retry-After remains visible after failure and expires without another POST", async () => {
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/health")) return response({ ready: true });
    if (init?.method === "DELETE") return response({ ok: true });
    return responseWithRetry(429, "5");
  });
  await startSongAnalysis(7, settings);
  expect(analysisIsRunning(7)).toBe(false);
  expect(analysisNetworkStatus(7).retryAfterSeconds).toBe(5);
  await jest.advanceTimersByTimeAsync(2000);
  expect(analysisNetworkStatus(7).retryAfterSeconds).toBe(3);
  await jest.advanceTimersByTimeAsync(3000);
  expect(analysisNetworkStatus(7).retryAfterSeconds).toBe(0);
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
  ).toHaveLength(1);
});
