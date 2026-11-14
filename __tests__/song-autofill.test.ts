import {
  lookupLyrics,
  matchingIdentity
} from "../src/components/song-autofill/lyrics";

describe("lyrics-only fallback", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("compares artist and title independently", () => {
    expect(matchingIdentity("Океан Ельзи", "ОКЕАН-ЕЛЬЗИ")).toBe(true);
    expect(matchingIdentity("Океан Ельзи", "Скрябін")).toBe(false);
  });

  it("rejects different performers and preserves exact lyrics line breaks", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 1,
          trackName: "Весна",
          artistName: "Другой",
          plainLyrics: "Неверно"
        },
        {
          id: 2,
          trackName: "Весна",
          artistName: "Скрябін",
          plainLyrics: "Рядок 1\nРядок 2"
        }
      ]
    }) as typeof fetch;
    const options = await lookupLyrics("Весна", "Скрябін");
    expect(options).toHaveLength(1);
    expect(options[0].content).toBe("Рядок 1\nРядок 2");
    expect(options[0].source).toBe("LRCLIB");
    expect(options[0].content).not.toContain("[Am]");
  });

  it("returns no result if no verified match exists", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] }) as typeof fetch;
    await expect(lookupLyrics("Весна", "Скрябін")).resolves.toEqual([]);
  });
  it("reports rate limits without returning dummy results", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 429 }) as typeof fetch;
    await expect(lookupLyrics("Весна", "Скрябін")).rejects.toThrow(
      "RateLimited"
    );
  });
});

describe("content provider failover", () => {
  const originalFetch = globalThis.fetch;
  let lookup: typeof import("../src/components/song-autofill/lyrics").lookupSongContent;
  let lyrics: typeof import("../src/components/song-autofill/lyrics").lookupLyrics;
  let request: jest.MockedFunction<typeof fetch>;
  const title = "Don't Look Back in Anger";
  const artist = "Oasis";
  const chart = `<h1>${title}</h1><h2>${artist}</h2><pre>Am       C\nOriginal example words</pre>`;
  const response = (url: string) =>
    new Response(url.startsWith("https://lrclib.net/") ? "[]" : "", {
      status: url.startsWith("https://lrclib.net/") ? 200 : 404
    });

  beforeEach(() => {
    jest.resetModules();
    ({
      lookupSongContent: lookup,
      lookupLyrics: lyrics
    } = require("../src/components/song-autofill/lyrics"));
    jest.useFakeTimers({ now: 100000 });
    request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    request.mockImplementation(async (url) => response(String(url)));
    globalThis.fetch = request;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("preserves source capo and tuning alongside canonical sounding chords", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(
            `<h1>${title}</h1><h2>${artist}</h2><div>Capo: <button data-anchor="--chord-capo">2.º traste</button></div><div data-tuning="E A D G B E"></div><pre>Em7 G D4 A7(4)\nExample words</pre>`
          )
        : response(String(url))
    );
    const pending = lookup(title, artist);
    await jest.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(result[0]).toMatchObject({
      capo: 2,
      tuning: "E A D G B E",
      hasChords: true
    });
    const { songChordSequence } = require("../src/screens/song/chords");
    expect(songChordSequence(result[0].content)).toEqual([
      "F#m7",
      "A",
      "Esus4",
      "B7sus4"
    ]);
  });

  it.each([true, false])(
    "Pisennyk normalizes remasters and validates the page performer (matching: %s)",
    async (matching) => {
      const candidate = "https://pisennyk.com.ua/test-artist/test-song";
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { "@type": "MusicGroup", name: matching ? artist : "Another performer" } })}</script><div class="interpretation-content"><code data-chord="Am">Am</code>Example words</div>`
              )
            : response(String(url))
      );
      const pending = lookup(`${title} (2011 Remaster)`, artist);
      await jest.advanceTimersByTimeAsync(10000);
      const result = await pending;
      expect(
        request.mock.calls.some(([url]) => String(url) === candidate)
      ).toBe(true);
      if (!matching) {
        expect(result.some((option) => option.source === "Пісенник")).toBe(
          false
        );
        return;
      }
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "Пісенник", hasChords: true })
        ])
      );
    }
  );
  it.each([
    [
      "E-Chords",
      "https://www.e-chords.com/en/chords/oasis/dont-look-back-in-anger/"
    ],
    ["Cifras", "https://www.cifras.com.br/cifra/oasis/dont-look-back-in-anger/"]
  ])(
    "uses %s after another chord provider is blocked",
    async (source, canonical) => {
      request.mockImplementation(async (url) => {
        if (String(url) === canonical) return new Response(chart);
        if (String(url).includes("cifraclub.com"))
          return new Response("", { status: 403 });
        return response(String(url));
      });
      const result = lookup(title, artist);
      await jest.advanceTimersByTimeAsync(0);
      await expect(result).resolves.toEqual([
        expect.objectContaining({ source, url: canonical, hasChords: true })
      ]);
    }
  );

  it("uses the canonical Eagles artist path for Hotel California", async () => {
    const canonical = "https://www.cifraclub.com/the-eagles/hotel-california/";
    request.mockImplementation(async (url) =>
      String(url) === canonical
        ? new Response(
            "<h1>Hotel California</h1><h2>Eagles</h2><pre>Bm F#7\nOriginal example words</pre>"
          )
        : response(String(url))
    );
    const result = lookup("Hotel California", "Eagles");
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual([
      expect.objectContaining({
        source: "Cifra Club",
        url: canonical,
        hasChords: true
      })
    ]);
  });

  it("finds a verified GuitareTab arrangement when the other chord sites are blocked", async () => {
    const canonical = "https://www.guitaretab.com/o/oasis/123.html";
    const search = `<div class="gt-list__row"><a href="/x/other/">Other artist</a><a href="/x/other/456.html">${title} chords</a></div>
      <div class="gt-list__row"><a href="/o/oasis/">Oasis</a><a href="/o/oasis/123.html">${title} chords</a></div>`;
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("https://www.guitaretab.com/fetch/?"))
        return new Response(search);
      if (value === canonical)
        return new Response(
          `<script type="application/ld+json">${JSON.stringify({
            "@type": "MusicRecording",
            name: title,
            byArtist: { name: artist }
          })}</script><pre class="js-tab-fit-to-screen"><div class="js-text-tab"><span class="js-tab-row"><span class="gt-chord">Am</span> C</span><span class="js-tab-row">Original example words</span></div></pre>`
        );
      if (
        ["cifraclub.com", "e-chords.com", "cifras.com.br"].some((host) =>
          value.includes(host)
        )
      )
        return new Response("", { status: 403 });
      return response(value);
    });
    const result = lookup(title, artist);
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual([
      expect.objectContaining({
        source: "GuitareTab",
        url: canonical,
        hasChords: true,
        content: "Am C\nOriginal example words"
      })
    ]);
    expect(
      request.mock.calls.some(([url]) => String(url).includes("456.html"))
    ).toBe(false);
  });

  it("does not keep requesting a provider during its access-denied cooldown", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("e-chords.com")
        ? new Response("", { status: 403 })
        : response(String(url))
    );
    const first = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(0);
    await first;
    request.mockClear();
    const second = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(10000);
    await second;
    expect(
      request.mock.calls.some(([url]) => String(url).includes("e-chords.com"))
    ).toBe(false);
    await jest.advanceTimersByTimeAsync(290000);
    request.mockClear();
    const third = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(0);
    await third;
    expect(
      request.mock.calls.some(([url]) => String(url).includes("e-chords.com"))
    ).toBe(true);
  });

  it.each(["different artist", "external link"])(
    "rejects a GuitareTab %s instead of importing an unrelated chart",
    async (failure) => {
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://www.guitaretab.com/fetch/?"))
          return new Response(
            `<div class="gt-list__row"><a href="/o/oasis/">Oasis</a><a href="${failure === "external link" ? "https://example.com/song" : "/o/oasis/123.html"}">${title} chords</a></div>`
          );
        if (value === "https://www.guitaretab.com/o/oasis/123.html")
          return new Response(
            `<script type="application/ld+json">${JSON.stringify({
              "@type": "MusicRecording",
              name: title,
              byArtist: { name: "Other artist" }
            })}</script><pre>Am C\nOriginal example words</pre>`
          );
        return response(value);
      });
      const result = lookup(title, artist);
      await jest.advanceTimersByTimeAsync(0);
      await expect(result).resolves.toEqual([]);
      expect(
        request.mock.calls.some(([url]) => String(url).includes("example.com"))
      ).toBe(false);
    }
  );

  it("retries a title search when the artist-filtered results do not match", async () => {
    request.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify([
            {
              id: 1,
              trackName: "Sample",
              artistName: String(url).includes("artist_name=")
                ? "Other artist"
                : artist,
              plainLyrics: "Original example words"
            }
          ])
        )
    );
    const result = await lyrics("Sample", artist);
    expect(result).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the lyrics fallback when chord providers are unavailable", async () => {
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("https://lrclib.net/"))
        return new Response(
          JSON.stringify([
            {
              id: 1,
              trackName: title,
              artistName: artist,
              plainLyrics: "Original example words"
            }
          ])
        );
      return new Response("", { status: 503 });
    });
    const result = lookup(title, artist);
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual([
      expect.objectContaining({
        source: "LRCLIB",
        content: "Original example words"
      })
    ]);
  });

  it("uses lyrics.ovh when the primary lyrics service is unavailable", async () => {
    request.mockImplementation(async (url) =>
      String(url).startsWith("https://api.lyrics.ovh/")
        ? new Response(JSON.stringify({ lyrics: "Original example words" }))
        : new Response("", { status: 503 })
    );
    const result = lookup(title, artist);
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual([
      expect.objectContaining({
        source: "lyrics.ovh",
        content: "Original example words"
      })
    ]);
  });

  it("returns no match rather than a service error when another provider answered normally", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response("", { status: 403 })
        : response(String(url))
    );
    const result = lookup("Sample", artist);
    const settled = result.then(
      (value) => value,
      (error) => error
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(await settled).toEqual([]);
  });

  it("does not reserve a crawl-delay slot for a cancelled request", async () => {
    const firstController = new AbortController();
    const first = lookup("Sample", artist, firstController.signal).catch(
      (error) => error
    );
    firstController.abort();
    await jest.advanceTimersByTimeAsync(0);
    expect(await first).toEqual(new Error("Cancelled"));
    request.mockClear();
    const secondController = new AbortController();
    const second = lookup("Sample", artist, secondController.signal).catch(
      (error) => error
    );
    try {
      await jest.advanceTimersByTimeAsync(0);
      expect(
        request.mock.calls.some(([url]) =>
          String(url).includes("pisennyk.com.ua")
        )
      ).toBe(true);
    } finally {
      secondController.abort();
      await second;
    }
  });

  it("keeps the crawl delay after a request actually reaches the provider", async () => {
    const first = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(0);
    await first;
    request.mockClear();
    const second = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(9999);
    expect(
      request.mock.calls.some(([url]) =>
        String(url).includes("pisennyk.com.ua")
      )
    ).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await second;
    expect(
      request.mock.calls.some(([url]) =>
        String(url).includes("pisennyk.com.ua")
      )
    ).toBe(true);
  });

  it("does not wait for a crawl slot when Pisennyk is already in cooldown", async () => {
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes("pisennyk.com.ua"))
        return new Response("", { status: 403 });
      if (value.includes("lrclib.net"))
        return new Response(
          JSON.stringify([
            {
              id: 1,
              trackName: "Sample",
              artistName: artist,
              plainLyrics: "Original words"
            }
          ])
        );
      return response(value);
    });
    const first = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(0);
    await first;
    request.mockClear();
    let done = false;
    const second = lookup("Sample", artist).then((value) => {
      done = true;
      return value;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(
      request.mock.calls.some(([url]) =>
        String(url).includes("pisennyk.com.ua")
      )
    ).toBe(false);
    await jest.advanceTimersByTimeAsync(10000);
    await second;
  });

  it.each([
    ["Sample", artist],
    ["Весна", "Виконавець"]
  ])(
    "reports an outage when every applicable provider fails for %s",
    async (track, performer) => {
      request.mockRejectedValue(new Error("Network unavailable"));
      const result = lookup(track, performer).catch((error) => error);
      await jest.advanceTimersByTimeAsync(0);
      expect(await result).toBeInstanceOf(Error);
    }
  );

  it("does not combine a song title with an artist from an unrelated metadata entry", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        {
          "@type": "MusicRecording",
          name: "Sample",
          byArtist: { name: "Other artist" }
        },
        { "@type": "Organization", byArtist: { name: artist } }
      ]
    })}</script><pre>Am       C\nOriginal example words</pre>`;
    request.mockImplementation(async (url) =>
      String(url).includes("e-chords.com")
        ? new Response(html)
        : response(String(url))
    );
    const result = lookup("Sample", artist);
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual([]);
  });
});
