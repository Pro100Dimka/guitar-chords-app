import { db } from "../src/components/database";
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
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  globalThis.fetch = fetchMock;
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({ executeSql: jest.fn() });
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
