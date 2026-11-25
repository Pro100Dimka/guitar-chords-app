describe("deferred chord catalogue fallbacks", () => {
  const originalFetch = globalThis.fetch;
  let lookup: typeof import("../src/components/song-autofill/lyrics").lookupSongContent;
  let request: jest.MockedFunction<typeof fetch>;
  const title = "Synthetic Ballad";
  const artist = "Example Performer";
  const firstURL =
    "https://www.cifraclub.com/example-performer/synthetic-ballad/";
  const extraOrigin = "https://www.chords-and-tabs.net";
  const extraSearch = `${extraOrigin}/songs/search/`;
  const extraPath = "/song/name/example-performer-synthetic-ballad";
  const extraURL = `${extraOrigin}${extraPath}`;
  const legacyHosts = new Set([
    "www.cifraclub.com",
    "www.e-chords.com",
    "www.cifras.com.br",
    "www.guitaretab.com",
    "akkords.pro",
    "pisennyk.com.ua",
    "musicaccord.ru"
  ]);
  const lyric = "Original synthetic words for this test";
  const chart = `<h1>${title}</h1><h2>${artist}</h2><pre>Am C\n${lyric}</pre>`;
  const extraCard = `<a href="${extraPath}"><span class="typechords">chords</span><b>${artist} - ${title}</b></a>`;
  const extraChart = `<script type="application/ld+json">${JSON.stringify({
    "@type": "MusicRecording",
    name: title,
    byArtist: { name: artist }
  })}</script><h1><a href="/songs/by/example-performer">${artist}</a> - <span itemprop="name">${title}</span></h1><div id="snippet--snippetXteView" class="xte-view"><div class="song"><sup>Am</sup>${lyric}</div></div>`;
  const lyricsResponse = () =>
    new Response(
      JSON.stringify([
        {
          id: 7,
          trackName: title,
          artistName: artist,
          plainLyrics: lyric
        }
      ])
    );
  const ordinaryResponse = (url: string) =>
    url.startsWith("https://lrclib.net/")
      ? lyricsResponse()
      : new Response("", { status: 404 });
  const calls = () => request.mock.calls.map(([url]) => String(url));
  // New providers must remain deferred regardless of how many are registered.
  const extraCalls = () =>
    calls().filter((url) => {
      const host = new URL(url).host;
      return (
        host !== "lrclib.net" &&
        host !== "api.lyrics.ovh" &&
        !legacyHosts.has(host)
      );
    });
  const blockedResponse = (signal?: AbortSignal | null) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new Error("Cancelled"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });

  beforeEach(() => {
    jest.resetModules();
    ({
      lookupSongContent: lookup
    } = require("../src/components/song-autofill/lyrics"));
    jest.useFakeTimers({ now: 100000 });
    request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    request.mockImplementation(async (url) => ordinaryResponse(String(url)));
    globalThis.fetch = request;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "does not contact extra catalogues after a primary chart succeeds, even with another primary pending: %s",
    async (hasPendingPrimary) => {
      let waitingSignal: AbortSignal | null | undefined;
      request.mockImplementation(async (input, options) => {
        const url = String(input);
        if (url === firstURL) return new Response(chart);
        if (hasPendingPrimary && url.startsWith("https://musicaccord.ru/")) {
          waitingSignal = options?.signal;
          return blockedResponse(waitingSignal);
        }
        return ordinaryResponse(url);
      });
      const pending = lookup(title, artist);
      await jest.runAllTimersAsync();
      expect(await pending).toEqual([
        expect.objectContaining({
          source: "Cifra Club",
          url: firstURL,
          hasChords: true
        })
      ]);
      expect(extraCalls()).toEqual([]);
      if (hasPendingPrimary) expect(waitingSignal?.aborted).toBe(true);
    }
  );

  it("waits for primary lookups, then replaces lyrics-only results with a verified fallback chart", async () => {
    let releasePrimary: (response: Response) => void = () => {};
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === firstURL)
        return new Response(
          `<h1>${title}</h1><h2>${artist}</h2><pre>${lyric}</pre>`
        );
      if (url.startsWith("https://akkords.pro/"))
        return new Promise((resolve) => {
          releasePrimary = resolve;
        });
      if (url === extraSearch) return new Response(extraCard);
      if (url === extraURL) return new Response(extraChart);
      return ordinaryResponse(url);
    });
    const pending = lookup(title, artist);
    await jest.advanceTimersByTimeAsync(100);
    expect(extraCalls()).toEqual([]);
    releasePrimary(new Response("", { status: 404 }));
    await jest.runAllTimersAsync();
    expect(await pending).toEqual([
      expect.objectContaining({
        source: "Chords & Tabs",
        url: extraURL,
        hasChords: true
      })
    ]);
    expect(extraCalls()).toContain(extraSearch);
    expect(extraCalls()).toContain(extraURL);
    expect((await pending).some((option) => option.source === "LRCLIB")).toBe(
      false
    );
  });

  it("reports a total chord-source outage even when the independent lyrics service succeeds", async () => {
    request.mockImplementation(async (input) =>
      String(input).startsWith("https://lrclib.net/")
        ? lyricsResponse()
        : new Response("", { status: 503 })
    );
    const pending = lookup(title, artist).catch((error) => error);
    await jest.runAllTimersAsync();
    expect(await pending).toEqual(new Error("ChordSourcesUnavailable"));
    expect(extraCalls()).toContain(extraSearch);
    expect(calls().some((url) => url.startsWith("https://lrclib.net/"))).toBe(
      true
    );
    expect(
      calls().some((url) => url.startsWith("https://api.lyrics.ovh/"))
    ).toBe(false);
  });

  it("cancels before the deferred stage without issuing new catalogue requests", async () => {
    const controller = new AbortController();
    const primarySignals: AbortSignal[] = [];
    request.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.startsWith("https://lrclib.net/")) return lyricsResponse();
      if (legacyHosts.has(new URL(url).host)) {
        if (options?.signal) primarySignals.push(options.signal);
        return blockedResponse(options?.signal);
      }
      return ordinaryResponse(url);
    });
    const pending = lookup(title, artist, controller.signal).catch(
      (error) => error
    );
    await jest.advanceTimersByTimeAsync(100);
    expect(primarySignals.length).toBeGreaterThan(0);
    expect(extraCalls()).toEqual([]);
    controller.abort();
    await jest.runAllTimersAsync();
    expect(await pending).toEqual(new Error("Cancelled"));
    expect(primarySignals.every((signal) => signal.aborted)).toBe(true);
    expect(extraCalls()).toEqual([]);
  });

  it.each(["pending", "late"])(
    "returns the first fallback chart within the collection window despite a %s fallback and preserves the completed cache",
    async (mode) => {
      let waitingSignal: AbortSignal | null | undefined;
      let releaseLate: (response: Response) => void = () => {};
      request.mockImplementation(async (input, options) => {
        const url = String(input);
        if (url === extraSearch) return new Response(extraCard);
        if (url === extraURL) return new Response(extraChart);
        if (url.startsWith("https://www.sonidos.com.br/busca?")) {
          waitingSignal = options?.signal;
          return mode === "pending"
            ? blockedResponse(waitingSignal)
            : new Promise((resolve) => {
                releaseLate = resolve;
              });
        }
        return ordinaryResponse(url);
      });
      let settled = false;
      let finishedAt: number | undefined;
      const began = Date.now();
      const pending = lookup(title, artist).then((options) => {
        settled = true;
        finishedAt = Date.now();
        return options;
      });
      await jest.advanceTimersByTimeAsync(100);
      expect(waitingSignal).toBeDefined();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1500);
      expect(settled).toBe(true);
      expect(finishedAt! - began).toBeGreaterThanOrEqual(1500);
      expect(finishedAt! - began).toBeLessThanOrEqual(1600);
      const result = await pending;
      expect(result).toEqual([
        expect.objectContaining({
          source: "Chords & Tabs",
          hasChords: true,
          url: extraURL
        })
      ]);
      expect(waitingSignal?.aborted).toBe(true);
      if (mode === "late") {
        releaseLate(
          new Response(
            `<section class="new-artist"><header class="new-artist-head"><a class="new-artist-link" href="/example-performer"><h3>${artist}</h3></a></header><a class="new-song-title" href="/example-performer/synthetic-ballad">${title}</a></section>`
          )
        );
        await jest.advanceTimersByTimeAsync(0);
        expect(calls()).not.toContain(
          "https://www.sonidos.com.br/example-performer/synthetic-ballad"
        );
      }
      request.mockClear();
      expect(await lookup(title, artist)).toEqual(result);
      expect(request).not.toHaveBeenCalled();
    }
  );
});
