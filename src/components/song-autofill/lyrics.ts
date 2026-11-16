import { songChords, transposeSong } from "../../screens/song/chords";
import { Parser, DomHandler, DomUtils } from "htmlparser2";
import { sourceArrangement } from "../../screens/song/rhythms";

export interface LyricsOption {
  id: number;
  title: string;
  artist: string;
  content: string;
  album: string;
  duration: number | null;
  capo?: number;
  tuning?: string;
  rhythm?: ReturnType<typeof sourceArrangement>;
  source:
    | "LRCLIB"
    | "Пісенник"
    | "lyrics.ovh"
    | "Cifra Club"
    | "E-Chords"
    | "Cifras"
    | "GuitareTab";
  url?: string;
  hasChords?: boolean;
}
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const trackTitle = (value: string) =>
  value
    .replace(
      /\s*[\[(](?:[^)\]]*remaster[^)\]]*|(?:feat\.?|ft\.?|featuring|with)[^)\]]*|official (?:audio|video)|(?:live|acoustic|unplugged|radio edit|album version|single version)(?:\s+[^)\]]*)?)[\])]\s*/gi,
      " "
    )
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*$/i, "")
    .trim();
const primaryArtist = (value: string) =>
  value.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "").trim();
const artistCredits = (value: string) => [
  ...new Set(
    [
      primaryArtist(value),
      ...value.split(/\s+(?:&|feat\.?|ft\.?|featuring|with)\s+/i)
    ]
      .map((name) => name.trim())
      .filter(Boolean)
  )
];
export const matchingIdentity = (expected: string, actual: string) =>
  !!normalize(trackTitle(expected)) &&
  normalize(trackTitle(expected)) === normalize(trackTitle(actual));

export function preferredSongContent(
  options: LyricsOption[],
  album = "",
  duration?: number
) {
  const score = (option: LyricsOption) =>
    (option.hasChords ? 1000 : 0) +
    (album && normalize(album) === normalize(option.album) ? 100 : 0) +
    (duration &&
    duration > 0 &&
    option.duration &&
    Math.abs(option.duration - duration) <= 5
      ? 50 - Math.abs(option.duration - duration)
      : 0);
  const best = Math.max(...options.map(score));
  const candidates = options.filter((option) => score(option) === best);
  return candidates.filter(
    (option, index) =>
      candidates.findIndex(
        (other) =>
          other.content === option.content && other.capo === option.capo
      ) === index
  );
}

const client =
  "FreeTune/0.0.1 (https://github.com/Pro100Dimka/guitar-chords-app)";
type LrcResult = {
  id?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  albumName?: unknown;
  duration?: unknown;
  plainLyrics?: unknown;
  syncedLyrics?: unknown;
  instrumental?: unknown;
};
let retryAfter = 0;
export async function lookupLyrics(
  title: string,
  artist: string,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  if (!title.trim() || !artist.trim()) throw new Error("MissingIdentity");
  if (signal?.aborted) throw new Error("Cancelled");
  if (Date.now() < retryAfter) throw new Error("RateLimited");
  const params = new URLSearchParams({
    track_name: trackTitle(title),
    artist_name: primaryArtist(artist)
  });
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  try {
    const search = async (query: URLSearchParams): Promise<LrcResult[]> => {
      const response = await fetch(`https://lrclib.net/api/search?${query}`, {
        headers: { "Lrclib-Client": client, Accept: "application/json" },
        signal: timeout.signal
      });
      if (response.status === 429) {
        const seconds = Number(response.headers?.get("Retry-After"));
        retryAfter =
          Date.now() +
          (Number.isFinite(seconds) && seconds > 0
            ? Math.min(seconds, 3600) * 1000
            : 30000);
        throw new Error("RateLimited");
      }
      if (!response.ok) throw new Error("LyricsServiceUnavailable");
      const payload: unknown = await response.json();
      if (timeout.signal.aborted) throw new Error("Cancelled");
      if (!Array.isArray(payload)) throw new Error("InvalidLyricsResponse");
      return payload;
    };
    const options = (payload: LrcResult[]) =>
      payload.flatMap((item) => {
        if (
          !item ||
          item.instrumental ||
          typeof item.id !== "number" ||
          typeof item.trackName !== "string" ||
          typeof item.artistName !== "string" ||
          !matchingIdentity(title, item.trackName) ||
          !sameArtist(artist, item.artistName)
        )
          return [];
        const content =
          typeof item.plainLyrics === "string" && item.plainLyrics.trim()
            ? item.plainLyrics
            : typeof item.syncedLyrics === "string"
              ? item.syncedLyrics.replace(/^\[[0-9:.]+\][ \t]*/gm, "")
              : "";
        if (!content.trim() || content.length > 200000) return [];
        return [
          {
            album: typeof item.albumName === "string" ? item.albumName : "",
            duration:
              typeof item.duration === "number" &&
              Number.isFinite(item.duration) &&
              item.duration >= 0
                ? item.duration
                : null,
            id: item.id,
            title: item.trackName,
            artist: item.artistName,
            content: content.replace(/\r\n?/g, "\n").trim(),
            source: "LRCLIB" as const,
            url: `https://lrclib.net/api/get/${item.id}`
          }
        ];
      });
    let matches = options(await search(params));
    if (!matches.length)
      matches = options(
        await search(new URLSearchParams({ q: trackTitle(title) }))
      );
    return matches;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const artistKey = (value: string) =>
  normalize(value.replace(/\s*&\s*/g, " and ")).replace(/ /g, "");
const sameArtist = (expected: string, actual: string) =>
  artistCredits(expected).some(
    (name) => artistKey(name) === artistKey(primaryArtist(actual))
  );

function chartRhythm(
  text: string,
  metadata?: Parameters<typeof DomUtils.getChildren>[0] | null
) {
  return sourceArrangement(
    [
      ...(metadata
        ? DomUtils.getChildren(metadata).map((node) =>
            DomUtils.textContent(node)
          )
        : []),
      text
    ].join("\n")
  );
}

const sourceCooldowns = new Map<string, number>();
async function parseSource(html: string, signal?: AbortSignal) {
  const handler = new DomHandler();
  const parser = new Parser(handler);
  let deadline = Date.now() + 2;
  for (let offset = 0; offset < html.length; offset += 8192) {
    if (signal?.aborted) throw new Error("Cancelled");
    parser.write(html.slice(offset, offset + 8192));
    if (Date.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      deadline = Date.now() + 2;
    }
  }
  if (signal?.aborted) throw new Error("Cancelled");
  parser.end();
  return handler.root;
}
async function fetchSource(url: string, signal?: AbortSignal, timeout = 12000) {
  if (signal?.aborted) throw new Error("Cancelled");
  const origin = new URL(url).origin;
  if (Date.now() < (sourceCooldowns.get(origin) ?? 0))
    throw new Error("LyricsServiceUnavailable");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return null;
    if ([403, 429].includes(response.status)) {
      const retry = Number(response.headers?.get("Retry-After"));
      sourceCooldowns.set(
        origin,
        Date.now() +
          (Number.isFinite(retry) && retry > 0
            ? Math.min(retry, 3600) * 1000
            : response.status === 403
              ? 300000
              : 30000)
      );
    }
    if (!response.ok) throw new Error("LyricsServiceUnavailable");
    const text = await response.text();
    if (text.length > 2000000) throw new Error("InvalidLyricsResponse");
    if (controller.signal.aborted) throw new Error("Cancelled");
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function lookupShazamTempo(
  title: string,
  artist: string,
  url: string,
  signal?: AbortSignal
) {
  if (
    !/^https:\/\/www\.shazam\.com\/(?:track|song)\/\d+(?:\/[^?#]*)?$/.test(url)
  )
    return;
  const html = await fetchSource(url, signal, 4000);
  if (!html) return;
  const document = await parseSource(html, signal);
  const verified = DomUtils.getElementsByTagName(
    "script",
    document.children
  ).some((script) => {
    if (script.attribs.type !== "application/ld+json") return false;
    try {
      const data = JSON.parse(DomUtils.textContent(script));
      const entries = Array.isArray(data) ? data : (data?.["@graph"] ?? [data]);
      return (
        Array.isArray(entries) &&
        entries.some((entry) => {
          const performers = Array.isArray(entry?.byArtist)
            ? entry.byArtist
            : [entry?.byArtist];
          return (
            entry?.["@type"] === "MusicRecording" &&
            typeof entry.name === "string" &&
            matchingIdentity(title, entry.name) &&
            performers.some(
              (performer: string | { name?: string } | undefined) =>
                sameArtist(
                  artist,
                  typeof performer === "string"
                    ? performer
                    : (performer?.name ?? "")
                )
            )
          );
        })
      );
    } catch {
      return false;
    }
  });
  if (!verified) return;
  const label = DomUtils.findOne(
    (element) =>
      element.name === "span" && DomUtils.textContent(element).trim() === "BPM",
    document.children
  );
  if (!label?.parent) return;
  const value = DomUtils.textContent(label.parent).match(
    /^BPM\s*(\d+(?:[.,]\d+)?)\s*$/i
  )?.[1];
  const tempo = Number(value?.replace(",", "."));
  if (Number.isFinite(tempo) && tempo >= 40 && tempo <= 200)
    return Math.round(tempo);
}

let nextPisennykRequest = 0;
async function fetchPisennyk(url: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Cancelled");
  const origin = new URL(url).origin;
  do {
    if (Date.now() < (sourceCooldowns.get(origin) ?? 0))
      throw new Error("LyricsServiceUnavailable");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        },
        Math.max(0, nextPisennykRequest - Date.now())
      );
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (signal?.aborted) throw new Error("Cancelled");
  } while (Date.now() < nextPisennykRequest);
  if (Date.now() < (sourceCooldowns.get(origin) ?? 0))
    throw new Error("LyricsServiceUnavailable");
  nextPisennykRequest = Date.now() + 10000;
  return fetchSource(url, signal);
}

async function lookupPisennyk(
  title: string,
  artist: string,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  const origin = "https://pisennyk.com.ua";
  const search = await fetchPisennyk(
    `${origin}/search?${new URLSearchParams({ q: `${trackTitle(title)} ${primaryArtist(artist)}` })}`,
    signal
  );
  if (!search) return [];
  const document = await parseSource(search, signal);
  const candidate = DomUtils.getElementsByTagName("a", document.children).find(
    (element) =>
      sameArtist(
        `${trackTitle(title)} ${primaryArtist(artist)}`,
        trackTitle(DomUtils.textContent(element))
      ) &&
      /^https:\/\/pisennyk\.com\.ua\/[^/?#]+\/[^/?#]+$/.test(
        element.attribs.href ?? ""
      )
  );
  if (!candidate) return [];
  const url = candidate.attribs.href;
  const html = await fetchPisennyk(url, signal);
  if (!html) return [];
  const page = await parseSource(html, signal);
  let identity: { title: string; artist: string; id: number } | undefined;
  for (const script of DomUtils.getElementsByTagName("script", page.children)) {
    if (script.attribs.type !== "application/ld+json") continue;
    try {
      const data = JSON.parse(DomUtils.textContent(script));
      if (
        data?.["@type"] === "MusicRecording" &&
        typeof data.name === "string" &&
        typeof data.byArtist?.name === "string"
      )
        identity = {
          title: data.name,
          artist: data.byArtist.name,
          id: typeof data["@id"] === "number" ? data["@id"] : 0
        };
    } catch {
      continue;
    }
  }
  if (
    !identity ||
    !matchingIdentity(title, identity.title) ||
    !sameArtist(artist, identity.artist)
  )
    return [];
  const body = DomUtils.findOne(
    (element) =>
      (element.attribs.class ?? "")
        .split(/\s+/)
        .includes("interpretation-content"),
    page.children
  );
  if (!body) return [];
  let content = "";
  let inChord = false;
  let hasChords = false;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "br") content += "\n";
      if (name === "code" && attributes["data-chord"]) {
        inChord = true;
        hasChords = true;
        content += "[";
      }
    },
    ontext(text) {
      content += text.replace(/\r?\n[ \t]*/g, "").replace(/\u00a0/g, " ");
    },
    onclosetag(name) {
      if (["p", "div", "li"].includes(name)) content += "\n";
      if (name === "code" && inChord) {
        content += "]";
        inChord = false;
      }
    }
  });
  parser.end(DomUtils.getInnerHTML(body));
  content = content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  const capoInstruction =
    /(?:^|[^\p{L}])(?:каподастр|капо|capo)(?=[:\s])\s*:?\s*(?:на\s*)?(\d{1,2}(?!\d)|[\p{L}'’]+)/iu;
  const standaloneCapo =
    /^\s*(?:каподастр|капо|capo)\s*:?\s*(?:на\s*)?(\d{1,2}|першому|другому|третьому|четвертому|п['’]?ятому|шостому|сьомому|восьмому|дев['’]?ятому|десятому|одинадцятому|дванадцятому)\s*(?:ладу|лад|ладе|fret|traste)?\s*(?:\(або тональність\s*\+\d{1,2} для оригінального звучання без капо\))?\s*$/iu;
  const metadata = DomUtils.findOne(
    (element) =>
      (element.attribs.class ?? "").split(/\s+/).includes("song-metadata"),
    page.children
  );
  const capoToken = (
    capoInstruction.exec(metadata ? DomUtils.textContent(metadata) : "")?.[1] ??
    content
      .split("\n")
      .map((line) => standaloneCapo.exec(line)?.[1])
      .find(Boolean) ??
    ""
  )
    .toLocaleLowerCase()
    .replace(/['’]/g, "");
  const ordinalFrets = [
    "",
    "перш",
    "друг",
    "трет",
    "четверт",
    "пят",
    "шост",
    "сьом",
    "восьм",
    "девят",
    "десят",
    "одинадцят",
    "дванадцят"
  ];
  const capoValue = /^\d+$/.test(capoToken)
    ? Number(capoToken)
    : ordinalFrets.findIndex(
        (prefix) => !!prefix && capoToken.startsWith(prefix)
      );
  const capo =
    Number.isInteger(capoValue) && capoValue >= 0 && capoValue <= 12
      ? capoValue
      : undefined;
  if (capo !== undefined)
    content = content
      .split("\n")
      .filter((line) => {
        const token = standaloneCapo.exec(line)?.[1];
        return !token || (/^\d+$/.test(token) && Number(token) > 12);
      })
      .join("\n")
      .trim();
  if (!content || content.length > 200000) return [];
  return [
    {
      ...identity,
      content: transposeSong(content, capo ?? 0),
      capo,
      rhythm: chartRhythm(content, metadata),
      album: "",
      duration: null,
      source: "Пісенник",
      url,
      hasChords
    }
  ];
}

const chordSources = {
  "Cifra Club": { origin: "https://www.cifraclub.com", path: "" },
  "E-Chords": { origin: "https://www.e-chords.com", path: "/en/chords" },
  Cifras: { origin: "https://www.cifras.com.br", path: "/cifra" },
  GuitareTab: { origin: "https://www.guitaretab.com", path: "/fetch/" }
};
const contentCache = new Map<
  string,
  { until: number; options: LyricsOption[] }
>();
async function lookupChordPage(
  title: string,
  artist: string,
  source: keyof typeof chordSources,
  signal?: AbortSignal,
  candidateUrl?: string
): Promise<LyricsOption[]> {
  const slug = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const artistSlug = slug(primaryArtist(artist)),
    titleSlug = slug(trackTitle(title));
  if (!artistSlug || !titleSlug) return [];
  const provider = chordSources[source];
  const candidateArtist =
    source === "Cifra Club" && candidateUrl
      ? new URL(candidateUrl).pathname.split("/")[1]
      : artistSlug;
  const canonicalArtist =
    source === "Cifra Club" && candidateArtist === "eagles"
      ? "the-eagles"
      : candidateArtist;
  let url =
    candidateUrl ??
    `${provider.origin}${provider.path}/${canonicalArtist}/${titleSlug}/`;
  if (source === "GuitareTab" && !candidateUrl) {
    const search = await fetchSource(
      `${provider.origin}${provider.path}?${new URLSearchParams({
        type: "tab",
        query: `${artistCredits(artist).find((name) => !/\s+&\s+/.test(name)) ?? primaryArtist(artist)} ${trackTitle(title)}`
      })}`,
      signal
    );
    if (!search) return [];
    const rows = DomUtils.findAll(
      (element) =>
        (element.attribs.class ?? "").split(/\s+/).includes("gt-list__row"),
      (await parseSource(search, signal)).children
    );
    const paths = new Set<string>();
    for (const row of rows) {
      const links = DomUtils.getElementsByTagName("a", row.children);
      if (!links.some((link) => sameArtist(artist, DomUtils.textContent(link))))
        continue;
      const candidate = links.find((link) => {
        const label = DomUtils.textContent(link).trim();
        return (
          / chords(?: \(ver \d+\))?$/i.test(label) &&
          matchingIdentity(
            title,
            label.replace(/ chords(?: \(ver \d+\))?$/i, "")
          ) &&
          /^\/[a-z0-9]\/[a-z0-9-]+\/\d+\.html$/.test(link.attribs.href ?? "")
        );
      });
      if (candidate) {
        paths.add(candidate.attribs.href);
        if (paths.size === 3) break;
      }
    }
    const results = await Promise.allSettled(
      [...paths].map((path) =>
        lookupChordPage(
          title,
          artist,
          source,
          signal,
          `${provider.origin}${path}`
        )
      )
    );
    return results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );
  }
  let html = await fetchSource(url, signal);
  if (!html && source === "Cifra Club") {
    const catalog = await fetchSource(
      `${provider.origin}/${canonicalArtist}/`,
      signal
    );
    if (catalog) {
      const link = DomUtils.getElementsByTagName(
        "a",
        (await parseSource(catalog, signal)).children
      ).find((element) => {
        const label =
          DomUtils.findOne(
            (node) =>
              (node.attribs.class ?? "").split(/\s+/).includes("primaryLabel"),
            element.children
          ) ?? element;
        return (
          matchingIdentity(title, DomUtils.textContent(label)) &&
          new RegExp(`^/${canonicalArtist}/[a-z0-9-]+/$`).test(
            element.attribs.href ?? ""
          )
        );
      });
      if (link) {
        url = `${provider.origin}${link.attribs.href}`;
        html = await fetchSource(url, signal);
      }
    }
  }
  if (!html && source === "Cifra Club" && !candidateUrl) {
    for (const credited of artistCredits(artist).slice(1, 3)) {
      const options = await lookupChordPage(
        title,
        artist,
        source,
        signal,
        `${provider.origin}/${slug(credited)}/${titleSlug}/`
      );
      if (options.some((option) => option.hasChords)) return options;
    }
  }
  if (!html) return [];
  const document = await parseSource(html, signal);
  let foundTitle = "",
    foundArtist = "";
  for (const script of DomUtils.getElementsByTagName(
    "script",
    document.children
  )) {
    if (script.attribs.type !== "application/ld+json") continue;
    try {
      const data = JSON.parse(DomUtils.textContent(script));
      const entries = Array.isArray(data)
        ? data
        : Array.isArray(data?.["@graph"])
          ? data["@graph"]
          : [data];
      for (const entry of entries) {
        const types = Array.isArray(entry?.["@type"])
          ? entry["@type"]
          : [entry?.["@type"]];
        const performer = Array.isArray(entry?.byArtist)
          ? entry.byArtist[0]
          : entry?.byArtist;
        if (
          types.some((type: string) =>
            ["MusicComposition", "MusicRecording"].includes(type)
          ) &&
          typeof entry.name === "string" &&
          typeof performer?.name === "string" &&
          matchingIdentity(title, entry.name) &&
          sameArtist(artist, performer.name)
        ) {
          foundTitle = entry.name;
          foundArtist = performer.name;
          break;
        }
      }
    } catch {
      continue;
    }
  }
  const heading = (tag: string, className: string) => {
    const element = DomUtils.getElementsByTagName(tag, document.children).find(
      (node) => (node.attribs.class ?? "").split(/\s+/).includes(className)
    );
    return element ? DomUtils.textContent(element).trim() : "";
  };
  const titleHeading = DomUtils.getElementsByTagName(
    "h1",
    document.children
  ).find((element) => matchingIdentity(title, DomUtils.textContent(element)));
  const artistHeading = DomUtils.getElementsByTagName(
    "h2",
    document.children
  ).find((element) => sameArtist(artist, DomUtils.textContent(element)));
  foundTitle ||=
    heading("h1", "t1") ||
    (titleHeading ? DomUtils.textContent(titleHeading).trim() : "");
  foundArtist ||=
    heading("h2", "t3") ||
    (artistHeading ? DomUtils.textContent(artistHeading).trim() : "");
  if (!matchingIdentity(title, foundTitle) || !sameArtist(artist, foundArtist))
    return [];
  const container = DomUtils.findOne(
    (element) =>
      (element.attribs.class ?? "")
        .split(/\s+/)
        .some((name) => ["cifra_cnt", "core", "cifra"].includes(name)) ||
      ["core", "cifra", "chord-content"].includes(element.attribs.id),
    document.children
  );
  const blocks = DomUtils.getElementsByTagName(
    "pre",
    container?.children ?? document.children
  );
  const body =
    blocks.find(
      (element) =>
        element.attribs["data-chord-content"] === "true" ||
        (element.attribs.class ?? "").split(/\s+/).includes("js-tab-content")
    ) ??
    (container
      ? (blocks[0] ?? container)
      : blocks.length === 1
        ? blocks[0]
        : undefined);
  if (!body) return [];
  let text = "";
  const parser = new Parser({
    onopentag(name, attributes) {
      if (
        name === "br" ||
        ((attributes.class ?? "").split(/\s+/).includes("js-tab-row") &&
          text &&
          !text.endsWith("\n"))
      )
        text += "\n";
    },
    ontext(value) {
      text += value;
    }
  });
  parser.end(DomUtils.getInnerHTML(body));
  const capoElement =
    DomUtils.findOne(
      (element) =>
        element.attribs["data-anchor"] === "--chord-capo" ||
        element.attribs["data-capo"] !== undefined,
      document.children
    ) ??
    DomUtils.findOne(
      (element) =>
        element.attribs.id === "capo" &&
        /\d/.test(DomUtils.textContent(element)),
      document.children
    );
  const capo = Math.min(
    12,
    Number(
      (
        capoElement?.attribs["data-capo"] ??
        (capoElement ? DomUtils.textContent(capoElement) : "")
      ).match(/\d+/)?.[0] ?? 0
    )
  );
  const tuningElement = DomUtils.findOne(
    (element) => !!element.attribs["data-tuning"],
    document.children
  );
  const tuning = tuningElement?.attribs["data-tuning"];
  const content = transposeSong(
    text
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .trim(),
    capo
  );
  if (!content || content.length > 200000) return [];
  return [
    {
      id: 0,
      title: foundTitle,
      artist: foundArtist,
      content,
      capo,
      tuning,
      rhythm: chartRhythm(
        text,
        DomUtils.findOne(
          (element) =>
            (element.attribs.class ?? "")
              .split(/\s+/)
              .includes("song-metadata"),
          document.children
        )
      ),
      album: "",
      duration: null,
      source,
      url,
      hasChords: songChords(content).length > 0
    }
  ];
}

async function lookupOvh(
  title: string,
  artist: string,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(primaryArtist(artist))}/${encodeURIComponent(trackTitle(title))}`;
  const response = await fetchSource(url, signal);
  if (!response) return [];
  const data = JSON.parse(response);
  if (
    typeof data?.lyrics !== "string" ||
    !data.lyrics.trim() ||
    data.lyrics.length > 200000
  )
    return [];
  return [
    {
      id: 0,
      title,
      artist,
      content: data.lyrics.replace(/\r\n?/g, "\n").trim(),
      album: "",
      duration: null,
      source: "lyrics.ovh",
      url
    }
  ];
}

export async function lookupSongContent(
  title: string,
  artist: string,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  if (!title.trim() || !artist.trim()) throw new Error("MissingIdentity");
  if (signal?.aborted) throw new Error("Cancelled");
  const cacheKey = `${normalize(primaryArtist(artist))}:${normalize(trackTitle(title))}`;
  const cached = contentCache.get(cacheKey);
  if (cached && cached.until > Date.now())
    return cached.options.map((option) => ({ ...option }));
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    controller.abort();
    rejectAbort(new Error("Cancelled"));
  };
  let collectionTimer: ReturnType<typeof setTimeout> | undefined;
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const sources = /^\p{Script=Latin}+$/u.test(
      `${title} ${artist}`.replace(/[^\p{L}]/gu, "")
    )
      ? Object.keys(chordSources)
      : [];
    const requests = [
      ...sources.map((source) =>
        lookupChordPage(
          title,
          artist,
          source as keyof typeof chordSources,
          controller.signal
        )
      ),
      lookupPisennyk(title, artist, controller.signal),
      lookupLyrics(title, artist, controller.signal)
    ];
    const collected: LyricsOption[] = [];
    let foundChords: (options: LyricsOption[]) => void = () => {};
    const firstChords = new Promise<LyricsOption[]>((resolve) => {
      foundChords = resolve;
    });
    requests.forEach((request) => {
      void request.then(
        (options) => {
          collected.push(...options);
          const chords = options.filter((option) => option.hasChords);
          if (chords.length) foundChords(chords);
        },
        () => {}
      );
    });
    const completed = Promise.allSettled(requests);
    const options = await Promise.race([
      firstChords.then(() =>
        controller.signal.aborted
          ? collected
          : new Promise<LyricsOption[]>((resolve) => {
              collectionTimer = setTimeout(() => resolve(collected), 1500);
            })
      ),
      cancelled,
      completed.then((results) =>
        results.flatMap((result) =>
          result.status === "fulfilled" ? result.value : []
        )
      )
    ]);
    if (signal?.aborted) throw new Error("Cancelled");
    const withChords = options.filter((option) => option.hasChords);
    if (withChords.length) {
      if (contentCache.size >= 20)
        contentCache.delete(contentCache.keys().next().value!);
      contentCache.set(cacheKey, {
        until: Date.now() + 10 * 60 * 1000,
        options: withChords.map((option) => ({ ...option }))
      });
      return withChords;
    }
    if (options.length) return options;
    const results = await completed;
    try {
      const fallback = await lookupOvh(title, artist, controller.signal);
      if (signal?.aborted) throw new Error("Cancelled");
      if (fallback.length) return fallback;
    } catch (error) {
      if (
        signal?.aborted ||
        results.every((result) => result.status === "rejected")
      )
        throw error;
    }
    return [];
  } finally {
    controller.abort();
    if (collectionTimer !== undefined) clearTimeout(collectionTimer);
    signal?.removeEventListener("abort", abort);
  }
}
