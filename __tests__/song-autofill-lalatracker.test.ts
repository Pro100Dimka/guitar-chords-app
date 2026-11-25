import { parseDocument, DomUtils } from "htmlparser2";
import type { ChordProviderContext } from "../src/components/song-autofill/chord-provider-context";
import type { LyricsOption } from "../src/components/song-autofill/lyrics";

describe("LalaTracker corroborated catalogue provider", () => {
  const originalFetch = globalThis.fetch;
  let lookup: typeof import("../src/components/song-autofill/lyrics").lookupSongContent;
  let request: jest.MockedFunction<typeof fetch>;
  const origin = "https://lalatracker.com";
  const title = "Проверочная баллада";
  const artist = "Иван Примеров";
  const publishedArtist = "Примеров Иван";
  const performerURL = `${origin}/chords/1123456789abcdef01234567-example-performer`;
  const chartURL = `${origin}/chords/example-performer/0123456789abcdef01234567-synthetic-song`;
  const searchURL = `${origin}/search?${new URLSearchParams({ name: title })}`;
  const lines = [
    "Первый придуманный куплет для проверки",
    "Второй придуманный куплет звучит иначе",
    "Третий искусственный текст продолжает песню",
    "Четвертая выдуманная строка завершает куплет"
  ];
  const extraLines = [
    "Совершенно другая история останется здесь",
    "Дополнительная проверочная фраза звучит сегодня",
    "Следующий синтетический пример меняет смысл",
    "Последняя новая мысль дополняет рассказ",
    "Еще одна самостоятельная фраза завершает рассказ"
  ];
  const markup = (words = lines) =>
    words.map((line) => `<b>Am</b>\n${line}`).join("\n");
  const search = (name = title, performer = publishedArtist, url = chartURL) =>
    `<main><ul><li><a href="${url}">${name}<span>${performer}</span></a></li></ul></main>`;
  const page = (
    content = markup(),
    name = title,
    performer = publishedArtist
  ) => {
    const breadcrumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Главная", item: `${origin}/` },
        { position: 2, name: "Исполнители", item: `${origin}/artists` },
        { position: 3, name: performer, item: performerURL },
        { position: 4, name, item: chartURL }
      ]
    };
    return `<script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script><script type="application/ld+json">${JSON.stringify({ "@type": "MusicComposition", name, url: chartURL })}</script><main><nav aria-label="Хлебные крошки"><a href="${performerURL}">${performer}</a><span aria-current="page">${name}</span></nav><h1>Аккорды к песне ${performer} — ${name}</h1><pre id="song-text">${content}</pre></main>`;
  };
  const reference = (
    words = lines,
    name = title,
    performer = artist,
    id = 1
  ) => ({
    id,
    trackName: name,
    artistName: performer,
    plainLyrics: words.join("\n")
  });
  const empty = (url: string) =>
    new Response(url.startsWith("https://lrclib.net/") ? "[]" : "", {
      status: url.startsWith("https://lrclib.net/") ? 200 : 404
    });
  const urls = () => request.mock.calls.map(([url]) => String(url));
  const respond = (
    detail = page(),
    listing = search(),
    references: ReturnType<typeof reference>[] = [reference()]
  ) => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url === searchURL) return new Response(listing);
      if (url === chartURL) return new Response(detail);
      if (url.startsWith("https://lrclib.net/"))
        return new Response(JSON.stringify(references));
      return empty(url);
    });
  };
  const finish = async (name = title, performer = artist) => {
    const pending = lookup(name, performer);
    await jest.runAllTimersAsync();
    return pending;
  };
  const lalaOptions = (options: LyricsOption[]) =>
    options.filter((option) => option.source === "LalaTracker");

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

  it("imports only corroborated chart instructions, independently of page controls", async () => {
    respond(
      page(`Темп: 106\nПеребор: восьмёрка\n${markup()}`) +
        '<aside>Tempo: 180<br>Бой: четверка</aside><input value="18">'
    );
    const options = lalaOptions(await finish());
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      tempo: 106,
      rhythm: { strumPreset: "pick-eight", strum: "B3231323" },
      identityReference: { matchedLines: 4, candidateLines: 4 }
    });
    expect(options[0].content).toContain("Темп: 106");
    expect(urls().filter((url) => url.startsWith(origin))).toEqual([
      searchURL,
      chartURL
    ]);
  });

  it("corroborates a complete reversed name and keeps all chart content from its source", async () => {
    respond(page(markup([...lines, extraLines[0]])));
    const options = lalaOptions(await finish());
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      title,
      artist,
      sourceArtist: publishedArtist,
      source: "LalaTracker",
      url: chartURL,
      hasChords: true,
      identityReference: {
        source: "LRCLIB",
        url: "https://lrclib.net/api/get/1",
        matchedLines: 4,
        candidateLines: 5
      }
    });
    expect(options[0].content).toContain(extraLines[0]);
    expect(options[0].content).toContain(`[Am]\n${lines[0]}`);
    expect(urls().filter((url) => url.startsWith(origin))).toEqual([
      searchURL,
      chartURL
    ]);
    expect(
      urls().filter((url) => url.startsWith("https://lrclib.net/"))
    ).toHaveLength(1);
  });

  it("corroborates exact artist names too and preserves their published identity", async () => {
    respond(page(markup(), title, artist), search(title, artist));
    const options = lalaOptions(await finish());
    expect(options).toHaveLength(1);
    expect(options[0].artist).toBe(artist);
    expect(options[0].sourceArtist).toBeUndefined();
    expect(options[0].identityReference).toEqual({
      source: "LRCLIB",
      url: "https://lrclib.net/api/get/1",
      matchedLines: 4,
      candidateLines: 4
    });
    expect(
      urls().filter((url) => url.startsWith("https://lrclib.net/"))
    ).toHaveLength(1);
  });

  it("rejects an exact artist identity without an independent lyric reference", async () => {
    respond(page(markup(), title, artist), search(title, artist), []);
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it("rejects another song's body even when every artist and title label matches", async () => {
    respond(page(markup(extraLines), title, artist), search(title, artist));
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it.each([
    ["no reference", []],
    ["another reference artist", [reference(lines, title, "Петр Иванов")]],
    ["another reference title", [reference(lines, "Другая песня")]],
    ["a translated reference", [reference(lines, `${title} (UA Version)`)]],
    ["only three distinct lines", [reference(lines.slice(0, 3))]],
    [
      "matches spread across different references",
      [
        reference(lines.slice(0, 2)),
        reference(lines.slice(2), title, artist, 2)
      ]
    ]
  ])("does not verify the reversed artist with %s", async (_, references) => {
    respond(page(), search(), references);
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it("accepts four distinct matching lines at exactly half the eligible chart", async () => {
    respond(page(markup([...lines, ...extraLines.slice(0, 4)])));
    expect(lalaOptions(await finish())[0]).toMatchObject({
      identityReference: { matchedLines: 4, candidateLines: 8 }
    });
  });

  it("rejects four matching lines when most of the chart differs", async () => {
    respond(page(markup([...lines, ...extraLines])));
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it("does not count repetitions of a shared hook as distinct evidence", async () => {
    const repeated = Array(8).fill(lines[0]);
    respond(page(markup(repeated)), search(), [reference(repeated)]);
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it("requires substantive lines rather than several short generic phrases", async () => {
    const short = ["Да я тут", "Нет не он", "И все же", "Ты и я"];
    respond(page(markup(short)), search(), [reference(short)]);
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it("does not count section headings, credits or chord rows as independent lyric matches", async () => {
    const headers = [
      "[A sufficiently long synthetic section heading]",
      "Artist: A sufficiently long synthetic artist credit",
      "Arranged by a sufficiently long synthetic editor name",
      "Куплет: Достаточно длинное пояснение к разделу",
      "Am Dm G C"
    ];
    respond(page(markup([...headers, ...lines])), search(), [
      reference(headers)
    ]);
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it.each([
    "Примеров Петр",
    "Примеров Ив",
    "Примеров, Иван",
    "Примеров Иван (кавер)",
    "Примеров Иван Петрович",
    "Example Performer"
  ])(
    "does not treat %s as the requested full reversed name",
    async (performer) => {
      respond(page(markup(), title, performer), search(title, performer));
      expect(lalaOptions(await finish())).toEqual([]);
      expect(urls()).not.toContain(chartURL);
    }
  );

  it.each([
    `${origin}/chords/../0123456789abcdef01234567-synthetic-song`,
    `${origin}/chords/%2e%2e/0123456789abcdef01234567-synthetic-song`,
    `${origin}/chords/example%2fother/0123456789abcdef01234567-synthetic-song`,
    `${origin}/chords/example/0123456789abcdef01234567-${"x".repeat(1100)}`,
    "https://example.com/chords/example/0123456789abcdef01234567-synthetic-song",
    "//example.com/chords/example/0123456789abcdef01234567-synthetic-song"
  ])("does not fetch a noncanonical candidate URL %s", async (url) => {
    respond(page(), search(title, publishedArtist, url));
    expect(lalaOptions(await finish())).toEqual([]);
    expect(urls().filter((value) => value.startsWith(origin))).toEqual([
      searchURL
    ]);
  });

  it.each(["script", "style", "button", "span", "iframe"])(
    "rejects non-chart %s elements even when their text resembles lyrics",
    async (tag) => {
      respond(
        page(`<b>Am</b>\n<${tag}>${lines.join("\n")}</${tag}>`, title, artist),
        search(title, artist),
        []
      );
      expect(lalaOptions(await finish())).toEqual([]);
    }
  );

  it.each([
    [
      "translated title",
      page(markup(), `${title} (UA Version)`, publishedArtist)
    ],
    [
      "conflicting visible artist",
      page().replace(
        `<a href="${performerURL}">${publishedArtist}</a>`,
        `<a href="${performerURL}">Другой Исполнитель</a>`
      )
    ],
    [
      "conflicting visible title",
      page().replace(
        `<span aria-current="page">${title}</span>`,
        '<span aria-current="page">Другая песня</span>'
      )
    ],
    [
      "conflicting heading",
      page().replace(
        `Аккорды к песне ${publishedArtist} — ${title}`,
        "Аккорды к песне другой исполнитель"
      )
    ],
    [
      "malformed artist metadata URL",
      page().replaceAll(
        performerURL,
        `${origin}/chords/../1123456789abcdef01234567-example`
      )
    ],
    ["chords only", page("<b>Am</b> <b>C</b>\n<b>Dm</b> <b>G</b>")],
    ["lyrics only", page(lines.join("\n"))],
    ["unsupported chord label", page(`<b>Hm</b>\n${lines.join("\n")}`)],
    ["nested chord markup", page(`<b><b>Am</b></b>\n${lines.join("\n")}`)]
  ])("rejects %s", async (_, detail) => {
    respond(detail);
    expect(lalaOptions(await finish())).toEqual([]);
  });

  it("cancels while waiting for the existing reference promise", async () => {
    const {
      lookupLalaTracker
    } = require("../src/components/song-autofill/lalatracker");
    const controller = new AbortController();
    const context: ChordProviderContext = {
      fetchSource: async (url) => (url === searchURL ? search() : page()),
      parseSource: async (html) => parseDocument(html),
      sourceBody: async (body) => DomUtils.textContent(body),
      normalizeSourceText: async (text) => text.trim(),
      sourceWork: () => () => undefined,
      matchingIdentity: (expected, actual) => expected === actual,
      sameArtist: (expected, actual) => expected === actual,
      trackTitle: (value) => value,
      primaryArtist: (value) => value
    };
    const pending = lookupLalaTracker(
      title,
      artist,
      controller.signal,
      context,
      new Promise(() => {})
    );
    const rejected = expect(pending).rejects.toThrow("Cancelled");
    await jest.runAllTimersAsync();
    controller.abort();
    await rejected;
  });
});
