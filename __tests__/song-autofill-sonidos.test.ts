import { DomUtils, parseDocument } from "htmlparser2";
import { lookupSonidos } from "../src/components/song-autofill/sonidos";
import type { ChordProviderContext } from "../src/components/song-autofill/chord-provider-context";
import { matchingIdentity } from "../src/components/song-autofill/lyrics";

describe("Sonidos public arrangement provider", () => {
  const origin = "https://www.sonidos.com.br";
  const title = "Caminho Inventado",
    artist = "Músico Exemplo";
  const artistPath = "/musico-exemplo",
    path = `${artistPath}/caminho-inventado`;
  const query = (value: string) =>
    `${origin}/busca?${new URLSearchParams({ q: value })}`;
  const combined = query(`${title} ${artist}`),
    titleOnly = query(title);
  const card = (target = path, name = title, performer = artist) =>
    `<section class="sn-card new-artist"><header class="new-artist-head"><a class="new-artist-link" href="${artistPath}"><div><h3>${performer}</h3><span>1 música</span></div></a></header><a class="new-song-title" href="${target}">${name}</a></section>`;
  const row = (chord = "Am", lyric = "Uma linha inventada para testar") =>
    `<pre class="cifra-pre"><span class="cifra-chord" data-chord="${chord}">${chord}</span>      <span class="cifra-chord" data-chord="C">C</span>\n${lyric}</pre>`;
  const page = (body = row(), name = title, performer = artist) =>
    `<div class="song-head-titles"><h1 class="song-sticky-title">${name}</h1><div class="song-head-meta-line"><a href="${artistPath}">${performer}</a></div></div><span data-capo>sem capo</span><div class="song-cifra" data-cifra><section><h3>Primeira Parte</h3>${body}</section></div>`;
  let request: jest.MockedFunction<ChordProviderContext["fetchSource"]>;
  let context: ChordProviderContext;
  const finish = (signal?: AbortSignal) =>
    lookupSonidos(title, artist, signal, context);
  beforeEach(() => {
    request = jest.fn().mockImplementation(async (url) => {
      if (url === combined) return card();
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

  it("imports instructions inside the chart without treating toolbar numbers as tempo", async () => {
    request.mockImplementation(async (url) =>
      url === combined
        ? card()
        : page(
            `<pre class="cifra-pre">Andamento: 96\nBatida: D-DU-UDU\nAm C\nUma linha inventada para testar</pre>`
          ) +
          '<aside>Tempo: 180</aside><select id="scrollSpeed"><option>120</option></select>'
    );
    const options = await finish();
    expect(options[0]).toMatchObject({
      tempo: 96,
      rhythm: { strumPreset: "six", strum: "D-DU-UDU" }
    });
    expect(options[0].content).toContain("Andamento: 96");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses public search and retains chord alignment with the verified lyric lines", async () => {
    const options = await finish();
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      title,
      artist,
      source: "Sonidos",
      url: `${origin}${path}`,
      capo: 0,
      hasChords: true
    });
    expect(options[0].content).toContain(
      "[Am]Uma linh[C]a inventada para testar"
    );
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      combined,
      `${origin}${path}`
    ]);
  });
  it("tries the title alone after combined search has no matching performer", async () => {
    request.mockImplementation(async (url) =>
      url === combined
        ? card(path, title, "Outro Artista")
        : url === titleOnly
          ? card()
          : page()
    );
    expect(await finish()).toHaveLength(1);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      combined,
      titleOnly,
      `${origin}${path}`
    ]);
  });
  it.each([
    ["Outra Canção", artist],
    [title, "Outro Artista"],
    [`${title} (Translation)`, artist]
  ])("rejects a different search identity %s / %s", async (name, performer) => {
    request.mockResolvedValue(card(path, name, performer));
    expect(await finish()).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    "https://other.example/musico-exemplo/caminho-inventado",
    "//other.example/musico-exemplo/caminho-inventado",
    "/outro-artista/caminho-inventado",
    "/musico-exemplo/../outside",
    "/musico-exemplo/caminho-inventado?preview=1",
    "/api/chart"
  ])("rejects an unrelated or unsupported result URL %s", async (target) => {
    request.mockResolvedValue(card(target));
    expect(await finish()).toEqual([]);
    expect(
      request.mock.calls.every(([url]) => url === combined || url === titleOnly)
    ).toBe(true);
  });
  it.each([
    ["Outra Canção", artist],
    [title, "Outro Artista"]
  ])("rechecks detail identity", async (name, performer) => {
    request.mockImplementation(async (url) =>
      url === combined ? card() : page(row(), name, performer)
    );
    expect(await finish()).toEqual([]);
  });
  it("does not import site UI or other page lyrics outside the chart", async () => {
    request.mockImplementation(async (url) =>
      url === combined
        ? card()
        : page("<pre class='cifra-pre'>Am C</pre>") + `<pre>${row()}</pre>`
    );
    expect(await finish()).toEqual([]);
  });
  it.each([
    "<pre class='cifra-pre'>Am C</pre>",
    "<pre class='cifra-pre'>Invented words without any chord</pre>",
    "<pre class='cifra-pre'>Tabbed by: Example Person\nAm C\ne|---0---|</pre>",
    row("Hm"),
    row().replace('data-chord="Am"', 'data-chord="Em"'),
    row().replace(">Am</span>", "><b>Am</b></span>"),
    row().replace(
      "Uma linha inventada para testar",
      "<script>Imagined script words</script>"
    ),
    row("Am", "x".repeat(200001))
  ])("requires real lyrics and valid chords inside the chart", async (body) => {
    request.mockImplementation(async (url) =>
      url === combined ? card() : page(body)
    );
    expect(await finish()).toEqual([]);
  });
  it("preserves intro chords once and normalizes the published diminished symbol", async () => {
    const intro = `<div class="cifra-intro-row"><span class="cifra-chord" data-chord="Cº"><span class="cifra-intro-name">Cº</span><span class="cifra-intro-fake" aria-hidden="true">Cº</span></span></div>`;
    request.mockImplementation(async (url) =>
      url === combined ? card() : page(intro + row())
    );
    expect((await finish())[0].content).toContain("C°\nAm      C");
    expect((await finish())[0].content).not.toContain("C°C°");
  });
  it("limits detail requests to three unique candidates", async () => {
    request.mockImplementation(async (url) =>
      url === combined
        ? Array.from({ length: 10 }, (_, i) => card(`${path}-${i}`)).join("")
        : page("<pre class='cifra-pre'>Invented words only</pre>")
    );
    expect(await finish()).toEqual([]);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      combined,
      ...[0, 1, 2].map((i) => `${origin}${path}-${i}`)
    ]);
  });
  it("transposes a numeric capo into the stored concert chords", async () => {
    request.mockImplementation(async (url) =>
      url === combined ? card() : page().replace("sem capo", "2")
    );
    const [option] = await finish();
    expect(option.capo).toBe(2);
    expect(option.content).toContain("Bm");
    expect(option.content).toContain("D");
  });
  it("honors cancellation before issuing requests", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(finish(controller.signal)).rejects.toThrow("Cancelled");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not hide fetch errors or retry a denied source", async () => {
    request.mockRejectedValue(new Error("LyricsServiceUnavailable"));
    await expect(finish()).rejects.toThrow("LyricsServiceUnavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
