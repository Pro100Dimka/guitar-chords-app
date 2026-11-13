import { lookupLyrics } from "../src/components/song-autofill/lyrics";

describe("LRCLIB selection metadata", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  it("keeps studio and live versions independently, with album and duration", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [
        { id: 1, trackName: "Весна", artistName: "Скрябін", albumName: "Studio", duration: 180, plainLyrics: "one" },
        { id: 2, trackName: "Весна", artistName: "Скрябін", albumName: "Live", duration: 220, plainLyrics: "two" }
      ]
    }) as typeof fetch;
    const results = await lookupLyrics("Весна", "Скрябін");
    expect(results.map(item => item.album)).toEqual(["Studio", "Live"]);
    expect(results.map(item => item.duration)).toEqual([180, 220]);
    expect(results.map(item => item.content)).toEqual(["one", "two"]);
  });
  it("cancels before requesting network data", async () => {
    const abort = new AbortController();
    abort.abort();
    const mocked = jest.fn();
    globalThis.fetch = mocked as typeof fetch;
    await expect(lookupLyrics("Весна", "Скрябін", abort.signal)).rejects.toThrow("Cancelled");
    expect(mocked).not.toHaveBeenCalled();
  });
});
