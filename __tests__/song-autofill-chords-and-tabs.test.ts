import { DomUtils, parseDocument } from "htmlparser2";
import { lookupChordsAndTabs } from "../src/components/song-autofill/chords-and-tabs";
import type { ChordProviderContext } from "../src/components/song-autofill/chord-provider-context";
import { matchingIdentity } from "../src/components/song-autofill/lyrics";

describe("Chords & Tabs public arrangement provider", () => {
  const origin = "https://www.chords-and-tabs.net";
  const title = "Synthetic Ballad",
    artist = "Example Performer";
  const path = "/song/name/example-performer-synthetic-ballad";
  const chart = `Verse 1\n<div class="song">A<sup>Am</sup>n invented lyric line\nAnother <sup>C</sup>imagined line</div>\nUnchorded words stay here\n<div class="song"><sup>F</sup>A final invented line</div>`;
  const card = (
    target = path,
    name = title,
    performer = artist,
    kind = "chords"
  ) =>
    `<li><a href="${target}"><span class="songtype type${kind}">${kind}</span><b>${performer} - ${name}</b><span class="version">ver. 1</span></a></li>`;
  const page = (
    body = chart,
    name = title,
    performer = artist,
    metadataName = name,
    metadataPerformer = performer
  ) =>
    `<h1><a href="/songs/by/example-performer"><span itemprop="name">${performer}</span></a> - <span itemprop="name">${name}</span></h1><script type="application/ld+json">${JSON.stringify(
      {
        "@type": "MusicRecording",
        name: metadataName,
        byArtist: { name: metadataPerformer }
      }
    )}</script><div id="snippet--snippetXteView" class="xte-view">${body}</div>`;
  let request: jest.MockedFunction<ChordProviderContext["fetchSource"]>;
  let context: ChordProviderContext;
  const finish = (signal?: AbortSignal, name = title, performer = artist) =>
    lookupChordsAndTabs(name, performer, signal, context);

  beforeEach(() => {
    request = jest.fn().mockImplementation(async (url: string) => {
      if (url === `${origin}/songs/search/`) return card();
      if (url === `${origin}${path}`) return page();
      return null;
    });
    context = {
      fetchSource: request,
      parseSource: async (html) => parseDocument(html),
      sourceBody: async (body) => DomUtils.textContent(body),
      normalizeSourceText: async (text) => text.replace(/\r\n?/g, "\n").trim(),
      sourceWork: (signal) => () => {
        if (signal?.aborted) throw new Error("Cancelled");
      },
      matchingIdentity,
      sameArtist: matchingIdentity,
      trackTitle: (value) => value,
      primaryArtist: (value) => value
    };
  });

  it("imports explicit chart tempo and rhythm while excluding unrelated page instructions", async () => {
    request.mockImplementation(async (url) =>
      url === `${origin}/songs/search/`
        ? card()
        : page(`BPM: 104\nStrumming pattern: D-DU-UDU\n${chart}`) +
          "<aside>Tempo: 180<br>Strumming: four</aside>"
    );
    const options = await finish();
    expect(options[0]).toMatchObject({
      tempo: 104,
      rhythm: { strumPreset: "six", strum: "D-DU-UDU" }
    });
    expect(options[0].content).toContain("BPM: 104");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses the published form, verifies both identities, and preserves all chart lines", async () => {
    const result = await finish();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title,
      artist,
      source: "Chords & Tabs",
      url: `${origin}${path}`,
      hasChords: true
    });
    expect(result[0].content).toContain("A[Am]n invented lyric line");
    expect(result[0].content).toContain("Another [C]imagined line");
    expect(result[0].content).toContain("Unchorded words stay here");
    expect(request.mock.calls[0].slice(0, 3)).toEqual([
      `${origin}/songs/search/`,
      undefined,
      12000
    ]);
    expect(request.mock.calls[0][3]?.get("search")).toBe(`${artist} ${title}`);
  });

  it("uses at most one title-only fallback and keeps independent identity checks", async () => {
    request.mockImplementation(async (url, _signal, _timeout, form) => {
      if (url === `${origin}/songs/search/`)
        return form?.get("search") === title
          ? card(path, title, "Other Performer") + card()
          : "<p>No matching arrangements</p>";
      return page();
    });
    expect(await finish()).toHaveLength(1);
    expect(request.mock.calls.map((call) => call[3]?.get("search"))).toEqual([
      `${artist} ${title}`,
      title,
      undefined
    ]);
  });

  it.each([
    [title, "Other Performer"],
    ["Other Ballad", artist],
    [`${title} (Japanese Version)`, artist],
    [`${title} (Translation)`, artist]
  ])(
    "rejects a different search identity: %s / %s",
    async (name, performer) => {
      request.mockResolvedValue(card(path, name, performer));
      expect(await finish()).toEqual([]);
      expect(request).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ["Other Ballad", artist, title, artist],
    [title, "Other Performer", title, artist],
    [title, artist, "Other Ballad", artist],
    [title, artist, title, "Other Performer"]
  ])(
    "requires matching visible and structured identities",
    async (...identity) => {
      request.mockImplementation(async (url) =>
        url === `${origin}/songs/search/` ? card() : page(chart, ...identity)
      );
      expect(await finish()).toEqual([]);
    }
  );

  it.each([
    "https://other.example/song/name/example",
    "//other.example/song/name/example",
    "/song/name/example?do=change",
    "/song/name/example#comment",
    "/song/name/../outside",
    "/songs/by/example-performer"
  ])("does not fetch an unsupported search URL: %s", async (target) => {
    request.mockResolvedValue(card(target));
    expect(await finish()).toEqual([]);
    expect(
      request.mock.calls.every(([url]) => url === `${origin}/songs/search/`)
    ).toBe(true);
  });

  it("ignores tabs and bounds detail requests to three distinct matching charts", async () => {
    request.mockImplementation(async (url) => {
      if (url === `${origin}/songs/search/`)
        return (
          card(`${path}-tab`, title, artist, "tabs") +
          Array.from({ length: 10 }, (_, index) =>
            card(`${path}-${index}`)
          ).join("")
        );
      return page("Only invented words without a chord");
    });
    expect(await finish()).toEqual([]);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/songs/search/`,
      `${origin}${path}-0`,
      `${origin}${path}-1`,
      `${origin}${path}-2`
    ]);
  });

  it.each([
    "<sup>Am</sup> <sup>C</sup>",
    "Tabbed by: Example Person\nAm C\ne|---0---|",
    "<sup>Am</sup> <sup>Hm</sup>",
    "<sup><b>Am</b></sup> Invented words follow",
    "Invented words without chords",
    "<script>Am C\nInvented script lyrics</script>",
    "<sup>Am</sup>" + "x".repeat(200001)
  ])(
    "rejects chart content that cannot establish lyrics and chords",
    async (body) => {
      request.mockImplementation(async (url) =>
        url === `${origin}/songs/search/` ? card() : page(body)
      );
      expect(await finish()).toEqual([]);
    }
  );

  it("does not import unrelated lyrics or chords outside the dedicated chart", async () => {
    request.mockImplementation(async (url) =>
      url === `${origin}/songs/search/`
        ? card()
        : page("Am C") + "<pre>Other invented words</pre>"
    );
    expect(await finish()).toEqual([]);
  });

  it("applies the published capo using the existing absolute-chord convention", async () => {
    request.mockImplementation(async (url) =>
      url === `${origin}/songs/search/`
        ? card()
        : page() +
          '<span class="x-badge">Capo: 2</span><span class="x-badge">Tuning: E A D G B E</span>'
    );
    const [result] = await finish();
    expect(result.capo).toBe(2);
    expect(result.tuning).toBe("E A D G B E");
    expect(result.content).toContain("A[Bm]n invented lyric line");
  });

  it("cancels after a search response without starting a detail request", async () => {
    const controller = new AbortController();
    request.mockImplementation(async () => {
      controller.abort();
      return card();
    });
    await expect(finish(controller.signal)).rejects.toThrow("Cancelled");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
