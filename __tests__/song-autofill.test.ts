import {
  lookupLyrics,
  matchingIdentity,
  preferredSongContent,
  publishedArtistNames
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
    expect(matchingIdentity("Live Forever", "Forever")).toBe(false);
    expect(matchingIdentity("Song (Part II)", "Song")).toBe(false);
    expect(matchingIdentity("Song (Remix)", "Song")).toBe(false);
    expect(matchingIdentity("Вахтерам", "Вахтёрам")).toBe(true);
    expect(publishedArtistNames("UV (UA Version)")).toEqual([
      "UV (UA Version)"
    ]);
    expect(publishedArtistNames("CB (Cover Band)")).toEqual([
      "CB (Cover Band)"
    ]);
  });

  it("matches exact cross-script transliterations without guessing aliases or same-script spellings", () => {
    for (const [latin, cyrillic] of [
      ["Okean Elzy", "Океан Ельзи"],
      ["Skryabin", "Скрябін"],
      ["Kino", "Кино"],
      ["Antytila", "Антитіла"],
      ["Obiymy", "Обійми"],
      ["Кораблі", "Кораблi"],
      ["KAZKA", "КАZКА"]
    ]) {
      expect(matchingIdentity(latin, cyrillic)).toBe(true);
      expect(matchingIdentity(cyrillic, latin)).toBe(true);
    }
    for (const [expected, actual] of [
      ["Boombox", "Бумбокс"],
      ["Skryabin", "Skriabin"],
      ["Скрябін", "Скрябин"],
      ["Антитіла", "Антітіла"],
      ["Кораблі", "Корабли"],
      ["ABBA", "АВВА"],
      ["Okean Elzy", "Океан Ельзи Cover"],
      ["Kino", "Кино и друзья"]
    ])
      expect(matchingIdentity(expected, actual)).toBe(false);
  });

  it("accepts only explicitly published title acronyms with matching initials", () => {
    const published = "TDME (Там Де Ми Є)";
    for (const expected of ["ТДМЕ", "TDME", "Там Де Ми Є"])
      expect(matchingIdentity(expected, published)).toBe(true);
    for (const [expected, actual] of [
      ["ТДМЕ", "TDME (Там Де Ми Разом)"],
      ["ТДМЕ", "TDME (UA Version)"],
      ["ТДМЕ", "TDME (Там Де Ми Є) (UA Version)"],
      ["Дежавю", "Дежавю (UA Version)"],
      ["UV", "UV (UA Version)"],
      ["IT", "IT (Italian Translation)"],
      ["RA", "RA (Remix Arrangement)"],
      ["CB", "CB (Cover Band)"],
      ["КВ", "КВ (Кавер Версия)"],
      ["Там Де Ми Є", "ABCD (Там Де Ми Є)"],
      ["Там Де Ми Е", published],
      ["ТДМЄ", published],
      ["Є", "Е"]
    ])
      expect(matchingIdentity(expected, actual)).toBe(false);
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

  it.each([
    ["Akkords.pro", false],
    ["Akkords.pro", true],
    ["Пісенник", false],
    ["Пісенник", true]
  ])(
    "imports scoped metadata once and preserves conflicts through the cache: %s / %s",
    async (source, conflict) => {
      const track = "Обійми",
        performer = "Океан Ельзи";
      const candidate =
        source === "Akkords.pro"
          ? "https://akkords.pro/songs/okean-elzi/obiymi/"
          : "https://pisennyk.com.ua/okean-elzi/obiymi";
      request.mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith("https://akkords.pro/?") && source === "Akkords.pro")
          return new Response(
            `<a href="${candidate}"><span class="apx-top-songs__title">${track}</span><span class="apx-top-songs__artist">${performer}</span></a>`
          );
        if (
          url.startsWith("https://pisennyk.com.ua/search") &&
          source === "Пісенник"
        )
          return new Response(
            `<a href="${candidate}">${track} - ${performer}</a>`
          );
        if (url === candidate)
          return new Response(
            `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: track, byArtist: { name: performer } })}</script>` +
              '<div class="song-metadata"><p>BPM: 96</p><p>Бой: четверка</p></div>' +
              `<p class="${source === "Akkords.pro" ? "chords" : "interpretation-content"}">Tempo: ${conflict ? 120 : 96}<br>Бой: ${conflict ? "шестёрка" : "четверка"}<br>Am C<br>Тестовий рядок для перевірки</p>` +
              "<aside>Tempo: 180<br>Бой: восьмерка</aside>"
          );
        return response(url);
      });
      const pending = lookup(track, performer);
      await jest.runAllTimersAsync();
      const options = await pending;
      expect(options).toHaveLength(1);
      expect(options[0].source).toBe(source);
      expect(options[0].tempo).toBe(conflict ? undefined : 96);
      expect(options[0].rhythm?.strumPreset).toBe(
        conflict ? undefined : "four"
      );
      const count = request.mock.calls.length;
      expect(await lookup(track, performer)).toEqual(options);
      expect(request).toHaveBeenCalledTimes(count);
    }
  );

  it("finds Pisennyk charts hidden by the combined query's limited results", async () => {
    const track = "Обійми";
    const performer = "Океан Ельзи";
    const candidate = "https://pisennyk.com.ua/okean-elzi/obiymi";
    const wrongArtist = "https://pisennyk.com.ua/another-artist/obiymi";
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("https://pisennyk.com.ua/search"))
        return new Response(
          new URL(value).searchParams.get("q") === track
            ? `<a href="${wrongArtist}">${track} - Інший виконавець</a><a href="${candidate}">${track} - ${performer}</a>`
            : Array.from(
                { length: 50 },
                (_, index) =>
                  `<a href="https://pisennyk.com.ua/okean-elzi/other-${index}">Інша пісня ${index} - ${performer}</a>`
              ).join("")
        );
      if (value === candidate)
        return new Response(
          `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: track, byArtist: { name: performer } })}</script><div class="interpretation-content"><code data-chord="Am">Am</code>Тестовий рядок для перевірки</div>`
        );
      return response(value);
    });
    const pending = lookup(track, performer);
    await jest.runAllTimersAsync();
    expect(await pending).toEqual([
      expect.objectContaining({
        source: "Пісенник",
        url: candidate,
        hasChords: true
      })
    ]);
    expect(
      request.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.startsWith("https://pisennyk.com.ua/search"))
        .map((url) => new URL(url).searchParams.get("q"))
    ).toEqual([`${track} ${performer}`, track]);
    expect(request.mock.calls.some(([url]) => url === wrongArtist)).toBe(false);
  });

  it.each(["Akkords.pro", "Пісенник"])(
    "finds the official mixed-script Apple identity through %s without accepting a different performer",
    async (source) => {
      const candidate =
        source === "Akkords.pro"
          ? "https://akkords.pro/songs/okean-elzi/obiymi/"
          : "https://pisennyk.com.ua/okean-elzi/obiymi";
      const wrongArtist = candidate.replace("okean-elzi", "another-artist");
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (
          source === "Akkords.pro" &&
          value.startsWith("https://akkords.pro/?")
        )
          return new Response(
            new URL(value).searchParams.get("s") === "Обійми"
              ? `<a href="${wrongArtist}"><span class="apx-top-songs__title">Обійми</span><span class="apx-top-songs__artist">Інший виконавець</span></a><a href="${candidate}"><span class="apx-top-songs__title">Обійми</span><span class="apx-top-songs__artist">Океан Ельзи</span></a>`
              : "<p>No results</p>"
          );
        if (
          source === "Пісенник" &&
          value.startsWith("https://pisennyk.com.ua/search")
        )
          return new Response(
            `<a href="${wrongArtist}">Обійми - Інший виконавець</a><a href="${candidate}">Обійми - Океан Ельзи</a>`
          );
        if (value === candidate)
          return new Response(
            `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: "Обійми", byArtist: { name: "Океан Ельзи" } })}</script><p class="${source === "Akkords.pro" ? "chords" : "interpretation-content"}">Am C<br>Тестовий рядок для перевірки</p>`
          );
        return response(value);
      });
      const pending = lookup("Обійми", "Okean Elzy");
      await jest.runAllTimersAsync();
      expect(await pending).toEqual([
        expect.objectContaining({ source, url: candidate, hasChords: true })
      ]);
      expect(request.mock.calls.some(([url]) => url === wrongArtist)).toBe(
        false
      );
    }
  );

  it("preserves spaced hyphens inside Pisennyk titles and performer names", async () => {
    const candidate = "https://pisennyk.com.ua/rok-hurt/noviy-den";
    request.mockImplementation(async (url) =>
      String(url).startsWith("https://pisennyk.com.ua/search")
        ? new Response(`<a href="${candidate}">Новий - день - Рок - Гурт</a>`)
        : String(url) === candidate
          ? new Response(
              `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: "Новий - день", byArtist: { name: "Рок - Гурт" } })}</script><p class="interpretation-content"><code data-chord="Am">Am</code>Тестовий рядок для перевірки</p>`
            )
          : response(String(url))
    );
    const pending = lookup("Новий - день", "Rok - Hurt");
    await jest.runAllTimersAsync();
    expect(await pending).toEqual([
      expect.objectContaining({
        source: "Пісенник",
        hasChords: true,
        url: candidate
      })
    ]);
  });

  it.each([
    ["ВВ (Воплі Відоплясова)", true],
    ["ВВ (Володимир Васильків)", false],
    ["АБ (Воплі Відоплясова)", false],
    ["Воплі Відоплясова (Україномовна версія від іншого виконавця)", false],
    ["ВВ (feat. Воплі Відоплясова)", false]
  ])(
    "verifies the published artist abbreviation %s",
    async (pageArtist, matches) => {
      const candidate = "https://pisennyk.com.ua/vv-vopli-vidoplyasova/vesna";
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(`<a href="${candidate}">Весна - ${pageArtist}</a>`)
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: "Весна", byArtist: { name: pageArtist } })}</script><p class="interpretation-content"><code data-chord="Am">Am</code>Тестовий рядок для перевірки</p>`
              )
            : response(String(url))
      );
      const pending = lookup("Весна", "Воплі Відоплясова");
      await jest.runAllTimersAsync();
      if (matches)
        expect(await pending).toEqual([
          expect.objectContaining({
            source: "Пісенник",
            artist: pageArtist,
            hasChords: true
          })
        ]);
      else expect(await pending).toEqual([]);
    }
  );

  it.each([
    ["TDME (Там Де Ми Є)", "Антитіла", true],
    ["TDME (Там Де Ми Разом)", "Антитіла", false],
    ["TDME (UA Version)", "Антитіла", false],
    ["TDME (Там Де Ми Є)", "Інший гурт", false]
  ])(
    "verifies the published title acronym %s and page performer %s",
    async (pageTitle, pageArtist, matches) => {
      const candidate = "https://pisennyk.com.ua/antitila/tdme-tam-de-mi-ye";
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(
              `<a href="${candidate}">TDME (Там Де Ми Є) - Антитіла</a>`
            )
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: pageTitle, byArtist: { name: pageArtist } })}</script><p class="interpretation-content"><code data-chord="Am">Am</code>Тестовий рядок для перевірки</p>`
              )
            : response(String(url))
      );
      const pending = lookup("ТДМЕ", "Антитіла");
      await jest.runAllTimersAsync();
      if (matches)
        expect(await pending).toEqual([
          expect.objectContaining({
            source: "Пісенник",
            title: pageTitle,
            artist: pageArtist,
            hasChords: true
          })
        ]);
      else expect(await pending).toEqual([]);
    }
  );

  it.each([
    [
      "Кораблі",
      "The Hardkiss",
      "Кораблi",
      "The Hardkiss",
      "the-hardkiss/korabli"
    ],
    ["Плакала", "KAZKA", "Плакала", "КАZКА", "kazka/plakala"]
  ])(
    "accepts exact mixed-script source labels for %s",
    async (track, performer, pageTitle, pageArtist, path) => {
      const candidate = `https://pisennyk.com.ua/${path}`;
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(
              `<a href="${candidate}">${pageTitle} - ${pageArtist}</a>`
            )
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: pageTitle, byArtist: { name: pageArtist } })}</script><p class="interpretation-content"><code data-chord="Am">Am</code>Тестовий рядок для перевірки</p>`
              )
            : response(String(url))
      );
      const pending = lookup(track, performer);
      await jest.runAllTimersAsync();
      expect(await pending).toEqual([
        expect.objectContaining({
          source: "Пісенник",
          hasChords: true,
          url: candidate
        })
      ]);
    }
  );

  it.each([
    ["Кукушка", "Полина Гагарина", "Кукушка", "polina-gagarina/kukushka-2"],
    ["Хочешь?", "Земфира", "Хочешь", "zemfira/hochesh"],
    [
      "Don't Stop - Go?!",
      "Test Artist",
      "Don't Stop - Go",
      "test-artist/dont-stop-go"
    ]
  ])(
    "retries Akkords by title after the combined search omits %s",
    async (track, performer, searchTitle, path) => {
      const candidate = `https://akkords.pro/songs/${path}/`;
      const wrongArtist =
        "https://akkords.pro/songs/another-artist/same-title/";
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://akkords.pro/?"))
          return new Response(
            new URL(value).searchParams.get("s") === searchTitle
              ? `<a href="${wrongArtist}"><span class="apx-top-songs__title">${searchTitle}</span><span class="apx-top-songs__artist">Другой артист</span></a><a href="${candidate}"><span class="apx-top-songs__title">${searchTitle}</span><span class="apx-top-songs__artist">${performer}</span></a>`
              : "<p>No results</p>"
          );
        if (value === candidate)
          return new Response(
            `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: searchTitle, byArtist: { name: performer } })}</script><p class="chords">Am C\nOriginal example words</p>`
          );
        return response(value);
      });
      const pending = lookup(track, performer);
      await jest.runAllTimersAsync();
      expect(await pending).toEqual([
        expect.objectContaining({
          source: "Akkords.pro",
          hasChords: true,
          url: candidate
        })
      ]);
      expect(
        request.mock.calls
          .map(([url]) => String(url))
          .filter((url) => url.startsWith("https://akkords.pro/?"))
          .map((url) => new URL(url).searchParams.get("s"))
      ).toEqual([`${track} ${performer}`, searchTitle]);
      expect(request.mock.calls.some(([url]) => url === wrongArtist)).toBe(
        false
      );
    }
  );

  it("keeps a successful mixed-script combined search instead of broadening it", async () => {
    const candidate = "https://akkords.pro/songs/the-hardkiss/korabli/";
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("https://akkords.pro/?"))
        return new Response(
          new URL(value).searchParams.get("s") === "Кораблі The Hardkiss"
            ? `<a href="${candidate}"><span class="apx-top-songs__title">Кораблі</span><span class="apx-top-songs__artist">The Hardkiss</span></a>`
            : "<p>No results</p>"
        );
      if (value === candidate)
        return new Response(
          `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: "Кораблі", byArtist: { name: "The Hardkiss" } })}</script><p class="chords">Am C\nOriginal example words</p>`
        );
      return response(value);
    });
    const pending = lookup("Кораблі", "The Hardkiss");
    await jest.runAllTimersAsync();
    expect(await pending).toEqual([
      expect.objectContaining({ source: "Akkords.pro", hasChords: true })
    ]);
    expect(
      request.mock.calls.filter(([url]) =>
        String(url).startsWith("https://akkords.pro/?")
      )
    ).toHaveLength(1);
  });

  it.each([
    [
      "Группа крови",
      "Кино",
      "Группа крови",
      "Кино (Виктор Цой)",
      "kino/gruppa-krovi"
    ],
    ["Вахтерам", "Бумбокс", "Вахтёрам", "Бумбокс", "bumboks/vaxteram"],
    [
      "Hotel California",
      "Eagles",
      "Hotel California",
      "Eagles",
      "eagles/hotel-california"
    ]
  ])(
    "finds lyrics with chords for %s through the public Akkords.pro search",
    async (track, performer, pageTitle, pageArtist, path) => {
      const candidate = `https://akkords.pro/songs/${path}/`;
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://akkords.pro/?"))
          return new Response(
            `<a href="${candidate}"><span class="apx-top-songs__title">${pageTitle}</span><span class="apx-top-songs__artist">${pageArtist}</span></a>`
          );
        if (value === candidate)
          return new Response(
            `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": ["MusicRecording", "Article"], name: pageTitle, byArtist: { name: pageArtist } }] })}</script><div class="core"><pre>Am C\nUnrelated sidebar example</pre></div><p class="chords"><b>Куплет 1:</b>\n<span>Am</span>       <span>C</span>\nOriginal example words\n<span>G</span>\nТестовий рядок для перевірки</p>`
          );
        return response(value);
      });
      const pending = lookup(track, performer);
      await jest.runAllTimersAsync();
      expect(await pending).toEqual([
        expect.objectContaining({
          source: "Akkords.pro",
          url: candidate,
          title: pageTitle,
          artist: pageArtist,
          hasChords: true,
          content: expect.stringContaining("Am       C\nOriginal example words")
        })
      ]);
      expect(
        request.mock.calls
          .map(([url]) => String(url))
          .filter((url) => url.startsWith("https://akkords.pro/?"))
          .map((url) => new URL(url).searchParams.get("s"))
      ).toEqual([`${track} ${performer}`]);
    }
  );

  it.each([
    "search performer",
    "page performer",
    "foreign URL",
    "missing chart body",
    "chords without lyrics"
  ])("rejects an Akkords.pro result with %s", async (invalid) => {
    const candidate = "https://akkords.pro/songs/kino/gruppa-krovi/";
    const linkedUrl =
      invalid === "foreign URL"
        ? candidate.replace("akkords.pro", "example.org")
        : candidate;
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("https://akkords.pro/?"))
        return new Response(
          `<a href="${linkedUrl}"><span class="apx-top-songs__title">Группа крови</span><span class="apx-top-songs__artist">${invalid === "search performer" ? "Другой артист" : "Кино (Виктор Цой)"}</span></a>`
        );
      if (value === candidate)
        return new Response(
          `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": ["MusicRecording", "Article"], name: "Группа крови", byArtist: { name: invalid === "page performer" ? "Другой артист" : "Кино (Виктор Цой)" } }] })}</script><pre>Am C\nUnrelated sidebar example</pre><p class="${invalid === "missing chart body" ? "unrelated" : "chords"}">Am C\n${invalid === "chords without lyrics" ? "[Chorus]\nG F" : "Original example words"}</p>`
        );
      return response(value);
    });
    const pending = lookup("Группа крови", "Кино");
    await jest.runAllTimersAsync();
    expect(await pending).toEqual([]);
    if (["search performer", "foreign URL"].includes(invalid))
      expect(request.mock.calls.some(([url]) => url === linkedUrl)).toBe(false);
  });

  it("reuses completed chord results when the same song is searched again", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(chart)
        : response(String(url))
    );
    const first = lookup(title, artist);
    await jest.runAllTimersAsync();
    const options = await first;
    const count = request.mock.calls.length;
    expect(await lookup(title, artist)).toEqual(options);
    expect(request).toHaveBeenCalledTimes(count);
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
    await jest.runAllTimersAsync();
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

  it.each([
    "3 ладу",
    "третьому ладу (або тональність +3 для оригінального звучання без капо)"
  ])(
    "Pisennyk capo instruction preserves sounding pitch and playable shapes: %s",
    async (instruction) => {
      const candidate = "https://pisennyk.com.ua/test-artist/test-song";
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { "@type": "MusicGroup", name: artist } })}</script><div class="interpretation-content">Каподастр на ${instruction}<br><code data-chord="Gm">Gm</code>Example words</div>`
              )
            : response(String(url))
      );
      const pending = lookup(title, artist);
      await jest.runAllTimersAsync();
      const options = await pending;
      const option = options.find((entry) => entry.source === "Пісенник")!;
      expect(option.capo).toBe(3);
      const {
        songChordSequence,
        transposeSong
      } = require("../src/screens/song/chords");
      expect(songChordSequence(option.content)).toEqual(["A#m"]);
      expect(
        songChordSequence(transposeSong(option.content, -option.capo!))
      ).toEqual(["Gm"]);
    }
  );

  it.each([
    "Під капотом стало тихо",
    "Un capolavoro senza nome",
    "We sing capo in the song"
  ])(
    "Pisennyk preserves ordinary lyrics with capo-like words: %s",
    async (words) => {
      const candidate = "https://pisennyk.com.ua/test-artist/test-song";
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { name: artist } })}</script><div class="song-metadata">Каподастр: 2</div><div class="interpretation-content"><code data-chord="Am">Am</code>${words}<br>Capo: 2<br><code data-chord="C">C</code>Next line</div>`
              )
            : response(String(url))
      );
      const pending = lookup(title, artist);
      await jest.runAllTimersAsync();
      const option = (await pending).find(
        (entry) => entry.source === "Пісенник"
      )!;
      expect(option.content).toContain(words);
      expect(option.content).not.toContain("Capo: 2");
      expect(option.capo).toBe(2);
    }
  );

  it.each([2, 3])(
    "Pisennyk reads capo %s from adjacent page metadata",
    async (capo) => {
      const candidate = "https://pisennyk.com.ua/test-artist/test-song";
      request.mockImplementation(async (url) =>
        String(url).startsWith("https://pisennyk.com.ua/search")
          ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
          : String(url) === candidate
            ? new Response(
                `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { name: artist } })}</script><div class="song-metadata">Каподастр: ${capo}</div><div class="interpretation-content"><code data-chord="Am">Am</code>Example words</div>`
              )
            : response(String(url))
      );
      const pending = lookup(title, artist);
      await jest.runAllTimersAsync();
      const option = (await pending).find(
        (entry) => entry.source === "Пісенник"
      )!;
      expect(option.capo).toBe(capo);
      const { songChordSequence } = require("../src/screens/song/chords");
      expect(songChordSequence(option.content)).toEqual([
        capo === 2 ? "Bm" : "Cm"
      ]);
    }
  );

  it.each(["cifraclub.com", "e-chords.com", "cifras.com.br", "guitaretab.com"])(
    "symbols do not disable source %s",
    async (domain) => {
      const name = "1+1";
      const performer = "Florence + The Machine";
      request.mockImplementation(async (url) =>
        String(url).includes(domain)
          ? new Response(
              `<h1>${name}</h1><h2>${performer}</h2><pre>Am C\nExample words</pre>`
            )
          : response(String(url))
      );
      const pending = lookup(name, performer);
      await jest.advanceTimersByTimeAsync(20000);
      await pending;
      expect(
        request.mock.calls.some(([url]) => String(url).includes(domain))
      ).toBe(true);
    }
  );

  it("Pisennyk keeps lyric paragraphs after a spelled capo instruction", async () => {
    const candidate = "https://pisennyk.com.ua/test-artist/test-song";
    request.mockImplementation(async (url) =>
      String(url).startsWith("https://pisennyk.com.ua/search")
        ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
        : String(url) === candidate
          ? new Response(
              `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { "@type": "MusicGroup", name: artist } })}</script><div class="interpretation-content"><p>Каподастр на третьому ладу</p><p><code data-chord="Gm">Gm</code>Example words</p></div>`
            )
          : response(String(url))
    );
    const pending = lookup(title, artist);
    await jest.runAllTimersAsync();
    expect(
      (await pending).find((option) => option.source === "Пісенник")
    ).toMatchObject({
      capo: 3,
      content: expect.stringContaining("Example words")
    });
  });

  it("Pisennyk identifies plain chord rows as a chart without code tags", async () => {
    const candidate = "https://pisennyk.com.ua/test-artist/plain-chart";
    request.mockImplementation(async (url) =>
      String(url).startsWith("https://pisennyk.com.ua/search")
        ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
        : String(url) === candidate
          ? new Response(
              `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { name: artist } })}</script><div class="interpretation-content"><p>Am C</p><p>Example words</p></div>`
            )
          : response(String(url))
    );
    const result = lookup(title, artist);
    await jest.runAllTimersAsync();
    expect((await result)[0].hasChords).toBe(true);
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
      await jest.runAllTimersAsync();
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
      await jest.runAllTimersAsync();
      await expect(result).resolves.toEqual([
        expect.objectContaining({ source, url: canonical, hasChords: true })
      ]);
    }
  );

  it("collects a slightly later chord chart instead of discarding it", async () => {
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes("cifraclub.com")) return new Response(chart);
      if (
        value ===
        "https://www.e-chords.com/en/chords/oasis/dont-look-back-in-anger/"
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
        return new Response(chart.replace("Am       C", "Em       G"));
      }
      return response(value);
    });
    const result = lookup(title, artist);
    await jest.advanceTimersByTimeAsync(500);
    expect((await result).map((option) => option.source)).toEqual(
      expect.arrayContaining(["Cifra Club", "E-Chords"])
    );
  });

  it.each([true, false])(
    "the chart collection window is bounded and cancellable: %s",
    async (cancel) => {
      const controller = new AbortController();
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.includes("cifraclub.com")) return new Response(chart);
        if (value.includes("e-chords.com")) return new Promise(() => {});
        return response(value);
      });
      let done = false;
      const result = lookup(title, artist, controller.signal).then(
        (value) => {
          done = true;
          return value;
        },
        (error) => {
          done = true;
          return error;
        }
      );
      await jest.advanceTimersByTimeAsync(100);
      expect(done).toBe(false);
      if (cancel) controller.abort();
      await jest.advanceTimersByTimeAsync(cancel ? 0 : 1500);
      expect(done).toBe(true);
      const value = await result;
      if (cancel) expect(value).toEqual(new Error("Cancelled"));
      else
        expect(value).toEqual([
          expect.objectContaining({ source: "Cifra Club" })
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
    await jest.runAllTimersAsync();
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
    await jest.runAllTimersAsync();
    await expect(result).resolves.toEqual([
      expect.objectContaining({
        source: "GuitareTab",
        url: canonical,
        hasChords: true,
        content: expect.any(String)
      })
    ]);
    expect(
      request.mock.calls.some(([url]) => String(url).includes("456.html"))
    ).toBe(false);
    expect(
      require("../src/screens/song/chords").chordsAboveLyrics(
        (await result)[0].content
      )
    ).toBe("Am C\nOriginal example words");
  });

  it.each([
    [
      "Shape of You",
      "Ed Sheeran",
      "Shape Of You tab",
      "/e/ed-sheeran/389466.html"
    ],
    ["Caruso", "Lucio Dalla", "Caruso tab", "/l/lucio-dalla/33843.html"]
  ])(
    "checks the detail for a matching GuitareTab tab listing: %s",
    async (track, performer, label, path) => {
      const canonical = `https://www.guitaretab.com${path}`;
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://www.guitaretab.com/fetch/?"))
          return new Response(
            `<div class="gt-list__row"><a href="${path.slice(0, path.lastIndexOf("/") + 1)}">${performer}</a><a href="${path}">${label}</a></div>`
          );
        if (value === canonical)
          return new Response(
            `<h1>${track}</h1><h2>${performer}</h2><pre>Am C\nOriginal synthetic example words</pre>`
          );
        return response(value);
      });
      const result = lookup(track, performer);
      await jest.runAllTimersAsync();
      expect(await result).toEqual([
        expect.objectContaining({
          source: "GuitareTab",
          url: canonical,
          hasChords: true
        })
      ]);
      expect(request.mock.calls.some(([url]) => url === canonical)).toBe(true);
    }
  );

  it.each([
    ["tab-only", "e|--0--2--3--|\nB|--1--3--0--|"],
    ["lyrics-only", "Original synthetic example words"]
  ])(
    "does not mark a GuitareTab %s detail as lyrics and chords",
    async (_, body) => {
      const canonical = "https://www.guitaretab.com/o/oasis/123.html";
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://www.guitaretab.com/fetch/?"))
          return new Response(
            `<div class="gt-list__row"><a href="/o/oasis/">${artist}</a><a href="/o/oasis/123.html">${title} tab</a></div>`
          );
        if (value === canonical)
          return new Response(
            `<h1>${title}</h1><h2>${artist}</h2><pre>${body}</pre>`
          );
        return response(value);
      });
      const result = lookup(title, artist);
      await jest.runAllTimersAsync();
      expect(await result).toEqual([
        expect.objectContaining({
          source: "GuitareTab",
          url: canonical,
          hasChords: false
        })
      ]);
    }
  );

  it.each([false, true])(
    "limits GuitareTab tab fallback to three details and prefers any chords listing: %s",
    async (hasChordListing) => {
      const ids = [101, 102, 103, 104];
      const search =
        ids
          .map(
            (id) =>
              `<div class="gt-list__row"><a href="/o/oasis/">${artist}</a><a href="/o/oasis/${id}.html">${title} tab (ver ${id})</a></div>`
          )
          .join("") +
        (hasChordListing
          ? `<div class="gt-list__row"><a href="/o/oasis/">${artist}</a><a href="/o/oasis/999.html">${title} chords</a></div>`
          : "");
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://www.guitaretab.com/fetch/?"))
          return new Response(search);
        if (/^https:\/\/www\.guitaretab\.com\/o\/oasis\/\d+\.html$/.test(value))
          return new Response(chart);
        return response(value);
      });
      const result = lookup(title, artist);
      await jest.runAllTimersAsync();
      expect((await result).every((option) => option.hasChords)).toBe(true);
      expect(
        request.mock.calls
          .map(([url]) => String(url))
          .filter((url) =>
            /^https:\/\/www\.guitaretab\.com\/o\/oasis\/\d+\.html$/.test(url)
          )
      ).toEqual(
        (hasChordListing ? [999] : ids.slice(0, 3)).map(
          (id) => `https://www.guitaretab.com/o/oasis/${id}.html`
        )
      );
    }
  );

  it("tries another verified arrangement when the first version has no chords", async () => {
    const search = [123, 456]
      .map(
        (id) =>
          `<div class="gt-list__row"><a href="/o/oasis/">Oasis</a><a href="/o/oasis/${id}.html">${title} chords</a></div>`
      )
      .join("");
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("https://www.guitaretab.com/fetch/?"))
        return new Response(search);
      if (value.endsWith("123.html"))
        return new Response(
          `<h1>${title}</h1><h2>${artist}</h2><pre>Only words</pre>`
        );
      if (value.endsWith("456.html")) return new Response(chart);
      return response(value);
    });
    const result = lookup(title, artist);
    await jest.runAllTimersAsync();
    expect(await result).toEqual([
      expect.objectContaining({
        hasChords: true,
        url: "https://www.guitaretab.com/o/oasis/456.html"
      })
    ]);
  });

  it("yields and allows cancellation while parsing a large provider page", async () => {
    let clock = 100000;
    jest.spyOn(Date, "now").mockImplementation(() => (clock += 3));
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(
            `<div>${"<span>Example</span>".repeat(20000)}</div>${chart}`
          )
        : response(String(url))
    );
    const controller = new AbortController();
    let settled = false;
    const result = lookup(title, artist, controller.signal).catch((error) => {
      settled = true;
      return error;
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(settled).toBe(false);
    controller.abort();
    await expect(result).resolves.toEqual(new Error("Cancelled"));
    await jest.runAllTimersAsync();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["cifraclub.com", "e-chords.com", "cifras.com.br"])(
    "extracts decoded entities and displayed rows without reparsing %s",
    async (domain) => {
      const body =
        '<span class="js-tab-row"><b>Am</b>&nbsp;&nbsp;C</span>' +
        '<span class="js-tab-row">Fish &amp; chips &lt;br&gt;</span><br>' +
        "<span>G</span>\r\u200b\nNext&nbsp;line";
      request.mockImplementation(async (url) =>
        String(url).includes(domain)
          ? new Response(
              `<h1>${title}</h1><h2>${artist}</h2><pre>${body}</pre>`
            )
          : response(String(url))
      );
      const pending = lookup(title, artist);
      await jest.runAllTimersAsync();
      const { transposeSong } = require("../src/screens/song/chords");
      expect((await pending)[0].content).toBe(
        transposeSong("Am  C\nFish & chips <br>\nG\nNext line", 0)
      );
    }
  );

  it("Pisennyk keeps nested chord tags, entities and paragraph spacing", async () => {
    const candidate = "https://pisennyk.com.ua/test-artist/nested-chart";
    request.mockImplementation(async (url) =>
      String(url).startsWith("https://pisennyk.com.ua/search")
        ? new Response(`<a href="${candidate}">${title} ${artist}</a>`)
        : String(url) === candidate
          ? new Response(
              `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicRecording", name: title, byArtist: { name: artist } })}</script>` +
                '<div class="interpretation-content"><p><code data-chord="Am"><b>Am</b></code>Fish &amp; chips&nbsp;today<br> next\n  line</p><p><code data-chord="C">C</code>End</p></div>'
            )
          : response(String(url))
    );
    const pending = lookup(title, artist);
    await jest.runAllTimersAsync();
    const { transposeSong } = require("../src/screens/song/chords");
    expect((await pending)[0].content).toBe(
      transposeSong("[Am]Fish & chips today\n nextline\n[C]End", 0)
    );
  });

  it("normalization keeps a legal chart whose source text exceeds the content limit", async () => {
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(
            `<h1>${title}</h1><h2>${artist}</h2><pre>${"\u200b".repeat(220000)}Am C\nExample words</pre>`
          )
        : response(String(url))
    );
    const pending = lookup(title, artist);
    await jest.runAllTimersAsync();
    const { transposeSong } = require("../src/screens/song/chords");
    expect((await pending)[0].content).toBe(
      transposeSong("Am C\nExample words", 0)
    );
  });

  it("text normalization preserves a CRLF separated by removed characters at a work boundary", async () => {
    const text = "Am C\n" + "x".repeat(16378) + "\r\u200b\nG\r\nLast&nbsp;line";
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(`<h1>${title}</h1><h2>${artist}</h2><pre>${text}</pre>`)
        : response(String(url))
    );
    const pending = lookup(title, artist);
    await jest.runAllTimersAsync();
    const { transposeSong } = require("../src/screens/song/chords");
    expect((await pending)[0].content).toBe(
      transposeSong("Am C\n" + "x".repeat(16378) + "\nG\nLast line", 0)
    );
  });

  it("cancelling decoded chart traversal stops before the remaining nodes and does not cache a partial result", async () => {
    const { DomUtils } = require("htmlparser2");
    const isText = DomUtils.isText;
    const controller = new AbortController();
    let visited = 0;
    const textNodes = jest
      .spyOn(DomUtils, "isText")
      .mockImplementation((node) => {
        const text = isText(node);
        if (text && ++visited === 1) setTimeout(() => controller.abort(), 0);
        return text;
      });
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(
            `<h1>${title}</h1><h2>${artist}</h2><pre>${"<span>Am C</span><br><span>Words</span><br>".repeat(12000)}</pre>`
          )
        : response(String(url))
    );
    const pending = lookup(title, artist, controller.signal).catch(
      (error) => error
    );
    await jest.runAllTimersAsync();
    expect(await pending).toEqual(new Error("Cancelled"));
    expect(visited).toBeGreaterThan(0);
    expect(visited).toBeLessThan(1000);
    expect(jest.getTimerCount()).toBe(0);
    textNodes.mockRestore();
    request.mockClear();
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(chart)
        : response(String(url))
    );
    const retry = lookup(title, artist);
    await jest.runAllTimersAsync();
    expect((await retry)[0].content).toContain("Original example words");
    expect(request).toHaveBeenCalled();
  });

  it("cancelling text normalization stops before the remaining extracted chunks", async () => {
    const controller = new AbortController();
    let clock = 100000;
    jest.spyOn(Date, "now").mockImplementation(() => (clock += 2));
    const original = String.prototype.replace;
    let chunks = 0;
    jest.spyOn(String.prototype, "replace").mockImplementation(function (
      this: string,
      pattern,
      replacement
    ) {
      if (
        pattern instanceof RegExp &&
        pattern.source === "\\u200b" &&
        ++chunks === 1
      )
        setTimeout(() => controller.abort(), 0);
      return original.call(this, pattern, replacement);
    });
    request.mockImplementation(async (url) =>
      String(url).includes("cifraclub.com")
        ? new Response(
            `<h1>${title}</h1><h2>${artist}</h2><pre>${"\u200b".repeat(600000)}Am C\nWords</pre>`
          )
        : response(String(url))
    );
    const pending = lookup(title, artist, controller.signal).catch(
      (error) => error
    );
    await jest.runAllTimersAsync();
    expect(await pending).toEqual(new Error("Cancelled"));
    expect(chunks).toBeGreaterThan(0);
    expect(chunks).toBeLessThan(5);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("finds a noncanonical song slug in the artist catalog and verifies the page", async () => {
    request.mockImplementation(async (url) => {
      const value = String(url);
      if (value === "https://www.cifraclub.com/oasis/")
        return new Response(`<a href="/oasis/dont-look-back/">${title}</a>`);
      if (value === "https://www.cifraclub.com/oasis/dont-look-back/")
        return new Response(chart);
      return response(value);
    });
    const result = lookup(title, artist);
    await jest.runAllTimersAsync();
    expect(await result).toEqual([
      expect.objectContaining({
        hasChords: true,
        url: "https://www.cifraclub.com/oasis/dont-look-back/"
      })
    ]);
  });

  it.each([
    [
      "Shallow",
      "Lady Gaga & Bradley Cooper",
      "lady-gaga",
      "Shallow (feat. Bradley Cooper)"
    ],
    [
      "Lovely",
      "Billie Eilish & Khalid",
      "billie-eilish",
      "Lovely (feat. Khalid)"
    ],
    ["Decode (Acoustic Version)", "Paramore", "paramore", "Decode"]
  ])(
    "finds credited performers and recording editions: %s",
    async (name, performer, path, heading) => {
      const pageArtist = performer.split(" & ")[0];
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value === `https://www.cifraclub.com/${path}/`)
          return new Response(
            `<a href="/${path}/published-song/"><p>05</p><p class="primaryLabel"><span>${heading}</span></p><span>228 options</span></a>`
          );
        if (value === `https://www.cifraclub.com/${path}/published-song/`)
          return new Response(
            `<h1>${heading}</h1><h2>${pageArtist}</h2><pre>Am C\nExample words</pre>`
          );
        return response(value);
      });
      const result = lookup(name, performer);
      await jest.runAllTimersAsync();
      expect(
        (await result).filter((option) => option.hasChords).length
      ).toBeGreaterThan(0);
    }
  );

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

  it.each([
    ["chords", "different artist"],
    ["chords", "external link"],
    ["tab", "different artist"],
    ["tab", "external link"]
  ])(
    "rejects a GuitareTab %s %s instead of importing an unrelated chart",
    async (kind, failure) => {
      request.mockImplementation(async (url) => {
        const value = String(url);
        if (value.startsWith("https://www.guitaretab.com/fetch/?"))
          return new Response(
            `<div class="gt-list__row"><a href="/o/oasis/">Oasis</a><a href="${failure === "external link" ? "https://example.com/song" : "/o/oasis/123.html"}">${title} ${kind}</a></div>`
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
      expect(
        request.mock.calls.some(
          ([url]) =>
            String(url) === "https://www.guitaretab.com/o/oasis/123.html"
        )
      ).toBe(failure === "different artist");
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

  it.each([true, false])(
    "distinguishes a chord service outage from no match despite healthy lyrics (outage: %s)",
    async (outage) => {
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
        return new Response("", {
          status:
            !outage && value.startsWith("https://akkords.pro/") ? 404 : 503
        });
      });
      const result = lookup(title, artist).catch((error) => error);
      await jest.advanceTimersByTimeAsync(0);
      if (outage) {
        expect(await result).toEqual(new Error("ChordSourcesUnavailable"));
      } else {
        expect(await result).toEqual([
          expect.objectContaining({
            source: "LRCLIB",
            content: "Original example words"
          })
        ]);
      }
    }
  );

  it("uses lyrics.ovh when the primary lyrics service is unavailable", async () => {
    request.mockImplementation(async (url) =>
      String(url).startsWith("https://api.lyrics.ovh/")
        ? new Response(JSON.stringify({ lyrics: "Original example words" }))
        : new Response("", {
            status: String(url).startsWith("https://lrclib.net/") ? 503 : 404
          })
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

test("known duration separates equally ranked lyric versions", () => {
  const base = {
    title: "Track",
    artist: "Artist",
    source: "LRCLIB" as const,
    album: "Studio"
  };
  const options = [
    { ...base, id: 1, duration: 300, content: "Live version" },
    { ...base, id: 2, duration: 201, content: "Studio version" }
  ];
  expect(preferredSongContent(options, "Studio", 200)).toEqual([options[1]]);
  expect(preferredSongContent(options, "Studio")).toEqual(options);
});
