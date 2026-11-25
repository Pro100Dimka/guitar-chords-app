describe("WeingGuitar public Korean chord provider", () => {
  const originalFetch = globalThis.fetch;
  let lookup: typeof import("../src/components/song-autofill/lyrics").lookupSongContent;
  let request: jest.MockedFunction<typeof fetch>;
  const origin = "https://guitar.weingchicken.com";
  const title = "가상 노래";
  const artist = "ABC";
  const credit = "가상가수(ABC)";
  const candidate = `${origin}/scores/147`;
  const searchURL = (query: string) =>
    `${origin}/scores?${new URLSearchParams({ query })}`;
  const combined = searchURL(`${title} ${artist}`);
  const titleOnly = searchURL(title);
  const link = (path = "/scores/147", performer = credit, track = title) =>
    `<a class="font-weight-bold" href="${path}">${performer} - ${track}</a>`;
  const search = (links = link()) =>
    `<table><tbody><tr><td>${links}</td></tr></tbody></table>`;
  const piece = (chord = "Am", words?: string) =>
    `<div class="score-piece-wrapper float-left"><div class="chord-wrapper">${chord ? `<a href="javascript:" data-chord="${chord}"><span class="chord">${chord}</span></a>` : "&nbsp;"}</div>${words === undefined ? "" : `<div class="lyrics divide-button">${words}</div>`}</div>`;
  const body =
    `<div id="scoreBodyWrapper"><div class="score-paragraph">` +
    piece("Am") +
    piece("C") +
    '<div class="clearfix"></div><br>' +
    piece("", "가상") +
    piece("Am", "의 테스트 ") +
    piece("C", "가사입니다") +
    '<div class="clearfix"></div>' +
    piece("G", "다른 테스트 가사입니다") +
    '<div class="clearfix"></div></div><script>Injected text must not be imported</script></div>';
  const page = (content = body, performer = credit, track = title) =>
    `<main><h4 class="font-weight-bold">${performer} - ${track}</h4>${content}</main>`;
  const empty = (url: string) =>
    new Response(url.startsWith("https://lrclib.net/") ? "[]" : "", {
      status: url.startsWith("https://lrclib.net/") ? 200 : 404
    });
  const urls = () => request.mock.calls.map(([url]) => String(url));
  const weingURLs = () => urls().filter((url) => url.startsWith(origin));
  const finish = async (track = title, performer = artist) => {
    const pending = lookup(track, performer);
    await jest.runAllTimersAsync();
    return pending;
  };
  const mockPages = (searchHTML = search(), detail = page()) =>
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined) return new Response(searchHTML);
      if (url === candidate) return new Response(detail);
      return empty(url);
    });

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

  it.each([credit, "ABC(가상가수)", "ABC"])(
    "verifies the published artist credit %s and preserves native lyric fragments",
    async (performer) => {
      mockPages(search(link("/scores/147", performer)), page(body, performer));
      const options = await finish();
      expect(options).toEqual([
        expect.objectContaining({
          title,
          artist,
          source: "WeingGuitar",
          hasChords: true,
          url: candidate,
          content:
            "[Am] [C] \n\n가상[Am]의 테스트 [C]가사입니다\n[G]다른 테스트 가사입니다"
        })
      ]);
      expect(weingURLs()).toEqual([combined, candidate]);
    }
  );

  it("matches the Korean name in the same published alias pair", async () => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === searchURL(`${title} 가상가수`)) return new Response(search());
      if (url === candidate) return new Response(page());
      return empty(url);
    });
    expect(await finish(title, "가상가수")).toEqual([
      expect.objectContaining({ artist: "가상가수", hasChords: true })
    ]);
  });

  it("tries a bounded title-only search while retaining performer verification", async () => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined)
        return new Response(search(link("/scores/999", "Other Artist")));
      if (url === titleOnly) return new Response(search());
      if (url === candidate) return new Response(page());
      return empty(url);
    });
    expect(await finish()).toEqual([
      expect.objectContaining({ url: candidate, hasChords: true })
    ]);
    expect(weingURLs()).toEqual([combined, titleOnly, candidate]);
  });

  it.each([
    "Other Artist",
    "Unknown(ABC)",
    "가상가수(XYZ)",
    "가상가수(ABC Cover)",
    "가상가수 커버(ABC)",
    "가상가수(ABC) & Other Artist",
    "가상가수 feat. ABC"
  ])("rejects unrelated or qualified credits: %s", async (performer) => {
    mockPages(search(link("/scores/147", performer)), page(body, performer));
    expect(await finish()).toEqual([]);
    expect(weingURLs()).not.toContain(candidate);
  });

  it.each([
    `${title} (Japanese Version)`,
    `${title} (일본어 버전)`,
    `${title} (Remix)`,
    "Translated Song"
  ])("rejects a translated or different title: %s", async (track) => {
    mockPages(search(), page(body, credit, track));
    expect(await finish()).toEqual([]);
  });

  it("verifies the detail performer independently of the search label", async () => {
    mockPages(search(), page(body, "다른가수(XYZ)"));
    expect(await finish()).toEqual([]);
    expect(weingURLs()).toEqual([combined, candidate]);
  });

  it.each([
    "https://example.com/scores/147",
    "//example.com/scores/147",
    "/scores/147?redirect=another",
    "/scores/147#unrelated",
    "/scores/../147"
  ])("does not follow an unapproved detail URL: %s", async (path) => {
    mockPages(search(link(path)));
    expect(await finish()).toEqual([]);
    expect(weingURLs()).toEqual([combined, titleOnly]);
    expect(urls().some((url) => url.includes("example.com"))).toBe(false);
  });

  it("ignores matching navigation links outside search result tables", async () => {
    mockPages(`<nav>${link()}</nav><table><tbody></tbody></table>`);
    expect(await finish()).toEqual([]);
    expect(weingURLs()).not.toContain(candidate);
  });

  it.each([
    piece("Am") + piece("C"),
    piece("", "가상의 테스트 가사입니다"),
    piece("Am", "후렴"),
    piece("Am", "Intro"),
    piece("Am", "Artist: Synthetic credit"),
    piece("Am", "e|--0--2--3--|")
  ])(
    "requires real lyric text and chords in the scoped score",
    async (pieces) => {
      mockPages(
        search(),
        page(
          `<div id="scoreBodyWrapper"><div class="score-paragraph">${pieces}</div></div>`
        )
      );
      expect(await finish()).toEqual([]);
    }
  );

  it.each([
    body.replace('data-chord="Am"', 'data-chord="Dm"'),
    body.replace(
      '<span class="chord">Am</span>',
      '<span class="chord">Hm</span>'
    ),
    body.replace(
      '<span class="chord">Am</span>',
      '<span class="chord"><b>Am</b></span>'
    ),
    body.replace(
      '<div class="lyrics divide-button">가상</div>',
      '<div class="lyrics divide-button"><script>fake lyric evidence</script></div>'
    )
  ])(
    "rejects inconsistent or malformed source chord and lyric markup",
    async (content) => {
      mockPages(search(), page(content));
      expect(await finish()).toEqual([]);
    }
  );

  it("does not use page headings, diagrams or unrelated lyrics as score content", async () => {
    mockPages(
      search(),
      page(
        '<div class="score-paragraph">' +
          piece("Am", "가상의 테스트 가사입니다") +
          '</div><div id="scoreBodyWrapper">Unrelated text</div>'
      )
    );
    expect(await finish()).toEqual([]);
  });

  it("caps distinct details at three across multiple result tables", async () => {
    const tables =
      search([147, 148, 149, 149].map((id) => link(`/scores/${id}`)).join("")) +
      search(link("/scores/150"));
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === combined) return new Response(tables);
      if (/\/scores\/\d+$/.test(url)) return new Response(page(""));
      return empty(url);
    });
    expect(await finish()).toEqual([]);
    expect(weingURLs()).toEqual([
      combined,
      candidate,
      `${origin}/scores/148`,
      `${origin}/scores/149`
    ]);
  });

  it("does not query the Korean catalogue for an unrelated script-only identity", async () => {
    expect(await finish("Synthetic Ballad", "Example Artist")).toEqual([]);
    expect(weingURLs()).toEqual([]);
  });
});
