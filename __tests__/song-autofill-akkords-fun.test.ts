describe("Akkords.fun public catalogue provider", () => {
  const originalFetch = globalThis.fetch;
  let lookup: typeof import("../src/components/song-autofill/lyrics").lookupSongContent;
  let request: jest.MockedFunction<typeof fetch>;
  const origin = "https://akkords.fun";
  const title = "Synthetic Song";
  const artist = "Example Performer";
  const performerURL = `${origin}/eng/example-performer/`;
  const songURL = `${performerURL}synthetic-song/`;
  const index = (name = artist, href = performerURL) =>
    `<h1>Зарубежные исполнители: A – Z</h1><ul class="af-names"><li><a href="${href}">${name}</a></li></ul>`;
  const catalogue = (name = title, performer = artist, href = songURL) =>
    `<h1>${performer} — аккорды и тексты песен</h1><ol class="af-list"><li><a href="${href}">${name}</a></li></ol>`;
  const rows = `<h3 class="af-part_h">Куплет 1</h3><p class="af-ln af-ln-ch"><span class="af-w"><b data-ch="Am">Am</b> A synthetic lyric for the test</span></p><p class="af-ln af-ln-ch">The next <span class="af-w"><b data-ch="Dm">Dm</b> invented line</span></p>`;
  const page = (
    content = rows,
    name = title,
    performer = artist,
    heading = `${name} (${performer}) — аккорды на гитаре`,
    creditURL = performerURL
  ) =>
    `<nav class="af-crumbs"><a href="${creditURL}">${performer}</a><span aria-current="page">${name}</span></nav><article class="af-song"><h1>${heading}</h1><div class="af-sheet" data-af-sheet>${content}</div></article>`;
  const empty = (url: string) =>
    new Response(url.startsWith("https://lrclib.net/") ? "[]" : "", {
      status: url.startsWith("https://lrclib.net/") ? 200 : 404
    });
  const urls = () =>
    request.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith(`${origin}/`));
  const finish = async (name = title, performer = artist) => {
    const pending = lookup(name, performer);
    await jest.runAllTimersAsync();
    return pending;
  };
  const respond = (detail = page(), listing = catalogue(), names = index()) => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === `${origin}/eng/`) return new Response(names);
      if (url === performerURL) return new Response(listing);
      if (url === songURL) return new Response(detail);
      return empty(url);
    });
  };

  beforeEach(() => {
    jest.resetModules();
    ({
      lookupSongContent: lookup
    } = require("../src/components/song-autofill/lyrics"));
    jest.useFakeTimers({ now: 100000 });
    request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    request.mockImplementation(async (input) => empty(String(input)));
    globalThis.fetch = request;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("imports chart instructions while retaining the original text and ignoring page tools", async () => {
    respond(
      page(
        `<p class="af-ln">Темп: 108</p><p class="af-ln">Рекомендуемый Бой: Восьмерка</p>${rows}`
      ) + '<div class="af-tools">Tempo: 180<br>Бой: четверка</div>'
    );
    const options = await finish();
    expect(options[0]).toMatchObject({
      tempo: 108,
      rhythm: { strumPreset: "eighth", strum: "DUDUDUDU" }
    });
    expect(options[0].content).toContain("Рекомендуемый Бой: Восьмерка");
    expect(urls()).toEqual([`${origin}/eng/`, performerURL, songURL]);
  });

  it("follows a verified artist and song without requesting the search endpoint", async () => {
    respond();
    const options = await finish();
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      title,
      artist,
      source: "Akkords.fun",
      url: songURL,
      hasChords: true
    });
    expect(options[0].content).toContain("[Am] A synthetic lyric for the test");
    expect(options[0].content).toContain("The next [Dm] invented line");
    expect(urls()).toEqual([`${origin}/eng/`, performerURL, songURL]);
  });

  it("uses the Cyrillic catalogue and preserves a credited collaborator", async () => {
    const name = "Вигадана пісня";
    const performer = "Григорий Пример";
    const performerPath = "/rus/example/";
    const chart = `${origin}${performerPath}synthetic/`;
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === `${origin}/rus/`)
        return new Response(index(performer, performerPath));
      if (url === `${origin}${performerPath}`)
        return new Response(catalogue(name, performer, chart));
      if (url === chart)
        return new Response(
          page(
            rows,
            name,
            performer,
            `${name} (${performer}) — аккорды на гитаре`,
            performerPath
          )
        );
      return empty(url);
    });
    expect(await finish(name, `${performer} & Example Rapper`)).toEqual([
      expect.objectContaining({ title: name, artist: performer, url: chart })
    ]);
  });

  it.each([
    ["different artist", index("Unrelated Performer"), catalogue()],
    ["different title", index(), catalogue("Another Song")],
    ["translated version", index(), catalogue(`${title} (UA Version)`)],
    [
      "foreign artist URL",
      index(artist, "https://example.com/eng/example/"),
      catalogue()
    ],
    [
      "foreign song URL",
      index(),
      catalogue(title, artist, "https://example.com/chart")
    ],
    [
      "another artist directory",
      index(),
      catalogue(title, artist, `${origin}/eng/other/chart/`)
    ]
  ])("rejects discovery with %s", async (_, names, listing) => {
    respond(page(), listing, names);
    expect(await finish()).toEqual([]);
    expect(urls()).not.toContain(songURL);
  });

  it.each([
    ["wrong detail title", page(rows, "Another Song")],
    ["wrong detail performer", page(rows, title, "Unrelated Performer")],
    ["conflicting heading", page(rows, title, artist, "Different chart")],
    [
      "wrong breadcrumb URL",
      page(
        rows,
        title,
        artist,
        `${title} (${artist}) — аккорды на гитаре`,
        `${origin}/eng/other/`
      )
    ],
    [
      "chords alone",
      page('<p class="af-ln"><b data-ch="Am">Am</b> <b data-ch="C">C</b></p>')
    ],
    [
      "lyrics alone",
      page('<p class="af-ln">A synthetic line with words only</p>')
    ],
    [
      "empty chord marker",
      page('<p class="af-ln"><b data-ch="">Am</b> A synthetic line</p>')
    ],
    [
      "mismatched chord marker",
      page('<p class="af-ln"><b data-ch="Am">Dm</b> A synthetic line</p>')
    ],
    [
      "malformed chord marker",
      page(
        '<p class="af-ln"><b data-ch="Am"><span>Am</span></b> A synthetic line</p>'
      )
    ],
    [
      "unsupported chord marker",
      page('<p class="af-ln"><b data-ch="Hm">Hm</b> A synthetic line</p>')
    ],
    [
      "diagrams outside chart",
      page('<p class="af-ln">A synthetic lyric</p>') +
        '<figure><b data-ch="Am">Am</b></figure>'
    ]
  ])("rejects %s", async (_, detail) => {
    respond(detail);
    expect(await finish()).toEqual([]);
  });

  it("does not count arbitrary source section headings as lyric text", async () => {
    respond(
      page(
        '<h3 class="af-part_h">An unusual arrangement section</h3><p class="af-ln"><b data-ch="Am">Am</b> <b data-ch="C">C</b></p>'
      )
    );
    expect(await finish()).toEqual([]);
  });

  it("does not cache a failed chart and reuses only its public artist index", async () => {
    respond(page('<p class="af-ln">Words without chords</p>'));
    expect(await finish()).toEqual([]);
    respond();
    expect(await finish()).toHaveLength(1);
    expect(urls().filter((url) => url === `${origin}/eng/`)).toHaveLength(1);
    expect(urls().filter((url) => url === songURL)).toHaveLength(2);
  });

  it("expires its bounded artist index cache", async () => {
    respond(page('<p class="af-ln">Words without chords</p>'));
    expect(await finish()).toEqual([]);
    await jest.advanceTimersByTimeAsync(600001);
    expect(await finish()).toEqual([]);
    expect(urls().filter((url) => url === `${origin}/eng/`)).toHaveLength(2);
  });

  it("caps detail requests at three even if more matching editions are listed", async () => {
    const links = Array.from(
      { length: 5 },
      (_, number) =>
        `<li><a href="${performerURL}edition-${number}/">${title}</a></li>`
    ).join("");
    respond(
      "",
      `<h1>${artist} — аккорды и тексты песен</h1><ul class="af-list">${links}</ul>`
    );
    expect(await finish()).toEqual([]);
    expect(urls().filter((url) => url.includes("/edition-"))).toHaveLength(3);
  });
});
