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

  it("imports tempo and picking from the selected chart without reading page controls", async () => {
    const instructions = body.replace(
      '<div class="musicaccord-song">',
      '<div class="musicaccord-song">Темп: 92 BPM<br>Перебор: восьмёрка<br>'
    );
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined) return new Response(card());
      if (url === candidate)
        return new Response(
          page(instructions) +
            '<aside>Tempo: 180<br>Бой: четверка</aside><input value="120">'
        );
      return empty(url);
    });
    const options = await finish();
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      tempo: 92,
      rhythm: { strumPreset: "pick-eight", strum: "B3231323" }
    });
    expect(options[0].content).toContain("Темп: 92 BPM");
    expect(musicURLs()).toEqual([combined, candidate]);
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

  it("keeps marked chords when the source adds a footnote or an ellipsis", async () => {
    const annotated = `<div class="musicaccord-song"><p> <span class="ch" data-c="Am">Am</span>          <span class="ch" data-c="Em">Em</span>          <span class="ch" data-c="F">F</span>             <span class="ch" data-c="Em">Em</span>* …<br>Вигаданий рядок для перевірки акордового мотиву<br>Ще один вигаданий рядок</p></div>`;
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined) return new Response(card());
      if (url === candidate) return new Response(page(annotated));
      return empty(url);
    });
    const options = await finish();
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      hasChords: true,
      source: "Musicaccord.ru",
      content:
        "[Am]          [Em]          [F]             [Em]* …\nВигаданий рядок для перевірки акордового мотиву\nЩе один вигаданий рядок"
    });
  });

  it.each([
    '<span class="ch" data-c="Hm">Hm</span>',
    '<span class="ch" data-c="Am]">Am</span>',
    '<span class="ch" data-c="Am">Em</span>',
    '<span class="ch">Am</span>',
    '<span class="diagram" data-c="Am">Am</span>',
    '<span class="ch" data-c="Am"><b>Am</b></span>'
  ])("does not invent anchors from malformed markers: %s", async (marker) => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined) return new Response(card());
      if (url === candidate)
        return new Response(
          page(
            `<div class="musicaccord-song">${marker}* …<br>Вигаданий рядок без підтверджених акордів</div>`
          )
        );
      return empty(url);
    });
    expect(await finish()).toEqual([]);
  });

  it.each([false, true])(
    "requires actual lyrics with mixed valid and malformed chord markers: %s",
    async (hasLyrics) => {
      const lyric = "Вигаданий рядок для перевірки";
      const mixed = `<div class="musicaccord-song"><span class="ch" data-c="Am">Am</span> <span class="ch" data-c="Hm">Hm</span>${hasLyrics ? `<br>${lyric}` : ""}</div>`;
      request.mockImplementation(async (input) => {
        const url = String(input);
        if (url === combined) return new Response(card());
        if (url === candidate) return new Response(page(mixed));
        return empty(url);
      });
      const options = await finish();
      if (hasLyrics)
        expect(options).toEqual([
          expect.objectContaining({
            hasChords: true,
            content: `[Am] Hm\n${lyric}`
          })
        ]);
      else expect(options).toEqual([]);
    }
  );

  it("rejects malformed markers that leave the displayed chord row unparseable", async () => {
    const malformed = `<div class="musicaccord-song"><span class="ch" data-c="Am">[</span>Am<br>Вигаданий рядок для перевірки</div>`;
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined) return new Response(card());
      if (url === candidate) return new Response(page(malformed));
      return empty(url);
    });
    expect(await finish()).toEqual([]);
  });

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
    ],
    [
      "annotated chords without lyrics",
      () =>
        page(
          `<div class="musicaccord-song"><span class="ch" data-c="Am">Am</span> <span class="ch" data-c="Em">Em</span>* …</div>`
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
