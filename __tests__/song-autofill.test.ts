import { lookupLyrics, matchingIdentity } from "../src/components/song-autofill/lyrics";

describe("lyrics-only fallback", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); });

  it("compares artist and title independently", () => {
    expect(matchingIdentity("Океан Ельзи", "ОКЕАН-ЕЛЬЗИ")).toBe(true);
    expect(matchingIdentity("Океан Ельзи", "Скрябін")).toBe(false);
  });

  it("rejects different performers and preserves exact lyrics line breaks", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [
        { id: 1, trackName: "Весна", artistName: "Другой", plainLyrics: "Неверно" },
        { id: 2, trackName: "Весна", artistName: "Скрябін", plainLyrics: "Рядок 1\nРядок 2" }
      ]
    }) as typeof fetch;
    const options = await lookupLyrics("Весна", "Скрябін");
    expect(options).toHaveLength(1);
    expect(options[0].content).toBe("Рядок 1\nРядок 2");
    expect(options[0].source).toBe("LRCLIB");
    expect(options[0].content).not.toContain("[Am]");
  });

  it("returns no result if no verified match exists", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as typeof fetch;
    await expect(lookupLyrics("Весна", "Скрябін")).resolves.toEqual([]);
  });
  it("reports rate limits without returning dummy results", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as typeof fetch;
    await expect(lookupLyrics("Весна", "Скрябін")).rejects.toThrow("RateLimited");
  });


});
