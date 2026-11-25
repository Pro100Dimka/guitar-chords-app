describe("Musicaccord public chord provider", () => {
  const originalFetch = globalThis.fetch;
  let lookup: typeof import("../src/components/song-autofill/lyrics").lookupSongContent;
  let request: jest.MockedFunction<typeof fetch>;
  const origin = "https://musicaccord.ru";
  const candidate = `${origin}/songs/synthetic-chart/`;
  const title = "Гранули",
    artist = "ТНМК";
  const searchURL = (value: string) =>
    `${origin}/?${new URLSearchParams({ s: value })}`;
  const combined = searchURL(`${title} ${artist}`),
    titleOnly = searchURL(title);
  const card = (url = candidate, name = title, performer = artist) =>
    `<article class="group grid-item song type-song"><h2 class="post-title entry-title"><a href="${url}">${performer} - ${name}: аккорды на гитаре</a></h2></article>`;
  const body = `<div class="musicaccord-song"><p><span class="ch" data-c="Am">Am</span> <span class="ch" data-c="C">C</span><br>Перший вигаданий тестовий рядок<br><span class="ch" data-c="Dm">Dm</span> <span class="ch" data-c="G">G</span><br>Другий вигаданий тестовий рядок</p></div>`;
  const page = (
    content = body,
    name = title,
    performer = artist,
    credit = performer
  ) =>
    `<article class="song type-song"><nav class="song-breadcrumbs"><a href="${origin}/artists/example/">${credit}</a></nav><h1 class="post-title entry-title">${performer} - ${name}: аккорды на гитаре</h1>${content}</article>`;
  const empty = (url: string) =>
    new Response(url.startsWith("https://lrclib.net/") ? "[]" : "", {
      status: url.startsWith("https://lrclib.net/") ? 200 : 404
    });
  const urls = () => request.mock.calls.map(([url]) => String(url));
  const musicURLs = () => urls().filter((url) => url.startsWith(`${origin}/`));
  const finish = async (track = title, performer = artist) => {
    const pending = lookup(track, performer);
    await jest.runAllTimersAsync();
    return pending;
  };

  beforeEach(() => {
    jest.resetModules();
    ({
      lookupSongContent: lookup
    } = require("../src/components/song-autofill/lyrics"));
    jest.useFakeTimers({ now: 100000 });
    request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    request.mockImplementation(async (url) => empty(String(url)));
    globalThis.fetch = request;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    [title, artist],
    ["Synthetic Ballad", "Example Performer"]
  ])(
    "returns a verified arrangement for %s, including Cyrillic and Latin identities",
    async (track, performer) => {
      const search = searchURL(`${track} ${performer}`);
      request.mockImplementation(async (input) => {
        const url = String(input);
        if (url === search)
          return new Response(card(candidate, track, performer));
        if (url === candidate)
          return new Response(page(body, track, performer));
        return empty(url);
      });
      const options = await finish(track, performer);
      expect(options).toHaveLength(1);
      expect(options[0]).toMatchObject({
        title: track,
        artist: performer,
        source: "Musicaccord.ru",
        url: candidate,
        hasChords: true
      });
      expect(options[0].content).toContain(
        "Am C\nПерший вигаданий тестовий рядок"
      );
      expect(options[0].content).toContain(
        "Dm G\nДругий вигаданий тестовий рядок"
      );
      expect(options[0].content).not.toContain("<span");
      expect(musicURLs()).toEqual([search, candidate]);
    }
  );

  it("retries the title only after zero verified combined-query candidates", async () => {
    const wrong = `${origin}/songs/another-performer/`;
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined)
        return new Response(card(wrong, title, "Другий виконавець"));
      if (url === titleOnly) return new Response(card());
      if (url === candidate) return new Response(page());
      return empty(url);
    });
    expect(await finish()).toEqual([
      expect.objectContaining({ hasChords: true, source: "Musicaccord.ru" })
    ]);
    expect(musicURLs()).toEqual([combined, titleOnly, candidate]);
    expect(urls()).not.toContain(wrong);
  });

  it.each([
    ["wrong title", () => page(body, "Інша пісня")],
    [
      "wrong h1 performer",
      () => page(body, title, "Другий виконавець", artist)
    ],
    [
      "wrong breadcrumb performer",
      () => page(body, title, artist, "Другий виконавець")
    ],
    [
      "foreign breadcrumb URL",
      () =>
        page().replace(
          `${origin}/artists/example/`,
          "https://example.org/artists/example/"
        )
    ],
    [
      "editor instead of performer",
      () =>
        page().replace(
          /<nav[\s\S]*?<\/nav>/,
          `<script type="application/ld+json">{"@type":"Article","author":{"name":"${artist}"}}</script>`
        )
    ],
    [
      "diagrams without a song container",
      () =>
        page(
          `<div class="musicaccord-chords">Am C Dm G</div><p>Окремі тестові слова за межами розбору</p>`
        )
    ],
    [
      "lyrics without chords",
      () =>
        page(
          `<div class="musicaccord-song">Тільки вигадані слова тестової пісні</div>`
        )
    ],
    [
      "chords without lyrics",
      () =>
        page(
          `<div class="musicaccord-song"><span class="ch" data-c="Am">Am</span> C Dm G</div>`
        )
    ]
  ])(
    "rejects %s without substituting another page block",
    async (_, detail) => {
      request.mockImplementation(async (input) => {
        const url = String(input);
        if (url === combined) return new Response(card());
        if (url === candidate) return new Response(detail());
        return empty(url);
      });
      expect(await finish()).toEqual([]);
      expect(musicURLs()).toEqual([combined, candidate]);
    }
  );

  it.each([
    "https://musicaccord.ru.example.org/songs/synthetic-chart/",
    "https://example.org/songs/synthetic-chart/",
    "https://musicaccord.ru/artists/example/",
    "http://musicaccord.ru/songs/synthetic-chart/"
  ])(
    "does not fetch a candidate outside the song URL allowlist: %s",
    async (foreign) => {
      request.mockImplementation(async (input) => {
        const url = String(input);
        if ([combined, titleOnly].includes(url))
          return new Response(card(foreign));
        return empty(url);
      });
      expect(await finish()).toEqual([]);
      expect(musicURLs()).toEqual([combined, titleOnly]);
      expect(urls()).not.toContain(foreign);
    }
  );

  it("does not treat sidebar links on an empty search page as results", async () => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if ([combined, titleOnly].includes(url))
        return new Response(
          `<h1>0 Результаты поиска</h1><aside><h2 class="entry-title"><a href="${candidate}">${artist} - ${title}: аккорды на гитаре</a></h2></aside>`
        );
      return empty(url);
    });
    expect(await finish()).toEqual([]);
    expect(musicURLs()).toEqual([combined, titleOnly]);
    expect(urls()).not.toContain(candidate);
  });

  it("visits at most three distinct verified details and does not repeat the search", async () => {
    const details = Array.from(
      { length: 4 },
      (_, index) => `${origin}/songs/synthetic-${index}/`
    );
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined)
        return new Response(
          [...details, details[0]].map((link) => card(link)).join("")
        );
      if (details.includes(url)) return new Response(page(""));
      return empty(url);
    });
    expect(await finish()).toEqual([]);
    expect(musicURLs()).toEqual([combined, ...details.slice(0, 3)]);
  });
});
