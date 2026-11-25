import {
  chordNotationPattern,
  hasSongChordsAsync,
  isChordLine,
  transposeSongAsync
} from "../../screens/song/chords";
import { Parser, DomHandler, DomUtils } from "htmlparser2";
import { sourceMetadata } from "./source-metadata";
import { lookupChordsAndTabs } from "./chords-and-tabs";
import { lookupSonidos } from "./sonidos";
import { lookupWeingGuitar } from "./weing-guitar";
import { lookupAkkordsFun } from "./akkords-fun";
import { lookupLalaTracker } from "./lalatracker";
import type { ChordProviderContext } from "./chord-provider-context";
export { hasSongChordsAsync };

export interface LyricsOption {
  id: number;
  title: string;
  artist: string;
  content: string;
  album: string;
  duration: number | null;
  capo?: number;
  tuning?: string;
  tempo?: number;
  rhythm?: ReturnType<typeof sourceMetadata>["rhythm"];
  sourceArtist?: string;
  identityReference?: {
    source: "LRCLIB";
    url: string;
    matchedLines: number;
    candidateLines: number;
  };
  source:
    | "LRCLIB"
    | "Пісенник"
    | "lyrics.ovh"
    | "Cifra Club"
    | "E-Chords"
    | "Cifras"
    | "GuitareTab"
    | "Akkords.pro"
    | "Musicaccord.ru"
    | "Chords & Tabs"
    | "Sonidos"
    | "WeingGuitar"
    | "Akkords.fun"
    | "LalaTracker";
  url?: string;
  hasChords?: boolean;
}
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const identityScript = (value: string) => {
  const letters = value.replace(/[^\p{L}]/gu, "");
  return /^\p{Script=Latin}+$/u.test(letters)
    ? "Latin"
    : /^\p{Script=Cyrillic}+$/u.test(letters)
      ? "Cyrillic"
      : /^[\p{Script=Latin}\p{Script=Cyrillic}]+$/u.test(letters)
        ? "Mixed"
        : undefined;
};
const transliteration: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  і: "i",
  ї: "yi",
  є: "ye",
  ґ: "g"
};
const matchingScriptIdentity = (expected: string, actual: string) => {
  const left = normalize(expected),
    right = normalize(actual);
  if (!left) return false;
  if (left === right) return true;
  const leftScript = identityScript(left),
    rightScript = identityScript(right);
  // Published labels sometimes mix Cyrillic and Latin letters. Compare exact
  // transliterations, preserving strict comparisons within either pure script.
  if (
    !leftScript ||
    !rightScript ||
    (leftScript === rightScript && leftScript !== "Mixed")
  )
    return false;
  return [transliteration, { ...transliteration, г: "h", и: "y" }].some(
    (letters) => {
      const transliterate = (value: string) =>
        [...value].map((letter) => letters[letter] ?? letter).join("");
      return transliterate(left) === transliterate(right);
    }
  );
};
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
  publishedAbbreviationNames(trackTitle(actual), true).some((name) =>
    matchingScriptIdentity(trackTitle(expected), name)
  );

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
function publishedAbbreviationNames(name: string, title = false) {
  const alias = /^([\p{Lu}]{2,8})\s*\(([\p{L}'’.\-\s]+)\)$/u.exec(name);
  if (!alias) return [name];
  const words = alias[2].trim().split(/\s+/);
  const initials = words.map((word) => word[0]).join("");
  if (
    words.length < 2 ||
    words.length > 8 ||
    words.some((word) =>
      /^(?:feat|ft|featuring|with|cover|version|translation|remix|live|acoustic|instrumental|кавер|версія|версия|переклад|перевод)$/iu.test(
        normalize(word)
      )
    ) ||
    !matchingScriptIdentity(
      alias[1],
      // Published Ukrainian title acronyms may use E for the initial Є.
      // The complete names still use the unchanged identity comparison.
      title ? initials.replace(/є/gi, "е") : initials
    )
  )
    return [name];
  return [name, alias[1], alias[2].trim()];
}
export const publishedArtistNames = (value: string) =>
  publishedAbbreviationNames(primaryArtist(value));
const sameArtist = (expected: string, actual: string) => {
  const names = publishedArtistNames(actual);
  return artistCredits(expected).some((name) =>
    names.some((published) =>
      matchingScriptIdentity(artistKey(name), artistKey(published))
    )
  );
};

function chartMetadata(
  text: string,
  metadata?: Parameters<typeof DomUtils.getChildren>[0] | null
) {
  return sourceMetadata(
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

function sourceTurn(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 0);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function sourceWork(signal?: AbortSignal) {
  let deadline = Date.now() + 4;
  let units = 0;
  return () => {
    if (signal?.aborted) throw new Error("Cancelled");
    if (++units < 512 && Date.now() < deadline) return;
    return sourceTurn(signal).then(() => {
      deadline = Date.now() + 4;
      units = 0;
    });
  };
}

// The page is already parsed and its entities decoded. Walk those nodes
// directly instead of serializing the entire chart and parsing it again.
async function sourceBody(
  body: Parameters<typeof DomUtils.getChildren>[0],
  inlineChords: boolean,
  signal?: AbortSignal
) {
  const checkpoint = sourceWork(signal);
  const parts: string[] = [];
  let last = "";
  let inChord = false;
  const append = (value: string) => {
    if (!value) return;
    parts.push(value);
    last = value[value.length - 1];
  };
  const close = (name: string) => {
    if (!inlineChords) return;
    if (["p", "div", "li"].includes(name)) append("\n");
    if (name === "code" && inChord) {
      append("]");
      inChord = false;
    }
  };
  const stack = [{ children: DomUtils.getChildren(body), index: 0, name: "" }];
  while (stack.length) {
    const current = stack[stack.length - 1];
    if (current.index === current.children.length) {
      close(current.name);
      stack.pop();
    } else {
      const node = current.children[current.index++];
      if (DomUtils.isTag(node)) {
        if (
          node.name === "br" ||
          (!inlineChords &&
            (node.attribs.class ?? "").split(/\s+/).includes("js-tab-row") &&
            last &&
            last !== "\n")
        )
          append("\n");
        if (
          inlineChords &&
          node.name === "code" &&
          node.attribs["data-chord"]
        ) {
          inChord = true;
          append("[");
        }
        stack.push({ children: node.children, index: 0, name: node.name });
      } else if (DomUtils.isText(node)) {
        if (!inlineChords) append(node.data);
        else {
          let indent = false;
          for (let offset = 0; offset < node.data.length; ) {
            let end = Math.min(offset + 16384, node.data.length);
            if (node.data[end - 1] === "\r" && node.data[end] === "\n") end--;
            let chunk = node.data.slice(offset, end);
            if (indent) chunk = chunk.replace(/^[ \t]+/, "");
            indent = (indent && !chunk) || /\n[ \t]*$/.test(chunk);
            append(chunk.replace(/\r?\n[ \t]*/g, "").replace(/\u00a0/g, " "));
            offset = end;
            const pause = checkpoint();
            if (pause) await pause;
          }
        }
      }
    }
    const pause = checkpoint();
    if (pause) await pause;
  }
  if (signal?.aborted) throw new Error("Cancelled");
  return parts.join("");
}

async function normalizeSourceText(text: string, signal?: AbortSignal) {
  const checkpoint = sourceWork(signal);
  const parts: string[] = [];
  let carriageReturn = "";
  for (let offset = 0; offset < text.length; offset += 16384) {
    let chunk =
      carriageReturn +
      text
        .slice(offset, offset + 16384)
        .replace(/\u200b/g, "")
        .replace(/\u00a0/g, " ");
    carriageReturn = chunk.endsWith("\r") ? "\r" : "";
    if (carriageReturn) chunk = chunk.slice(0, -1);
    parts.push(chunk.replace(/\r\n?/g, "\n"));
    const pause = checkpoint();
    if (pause) await pause;
  }
  if (carriageReturn) parts.push("\n");
  return parts.join("").trim();
}

async function parseSource(html: string, signal?: AbortSignal) {
  const handler = new DomHandler();
  const parser = new Parser(handler);
  let deadline = Date.now() + 2;
  for (let offset = 0; offset < html.length; offset += 8192) {
    if (signal?.aborted) throw new Error("Cancelled");
    parser.write(html.slice(offset, offset + 8192));
    if (Date.now() >= deadline) {
      await sourceTurn(signal);
      deadline = Date.now() + 2;
    }
  }
  if (signal?.aborted) throw new Error("Cancelled");
  parser.end();
  return handler.root;
}
async function fetchSource(
  url: string,
  signal?: AbortSignal,
  timeout = 12000,
  form?: URLSearchParams
) {
  if (signal?.aborted) throw new Error("Cancelled");
  const origin = new URL(url).origin;
  if (Date.now() < (sourceCooldowns.get(origin) ?? 0))
    throw new Error("LyricsServiceUnavailable");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...(form
        ? {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString()
          }
        : {})
    });
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

async function lookupShazamTempo(
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

export async function lookupSongTempo(
  title: string,
  artist: string,
  url: string,
  signal?: AbortSignal
) {
  if (!title.trim() || !artist.trim()) return;
  try {
    const tempo = await lookupShazamTempo(title, artist, url, signal);
    if (tempo !== undefined) return tempo;
  } catch {
    if (signal?.aborted) throw new Error("Cancelled");
  }
  const html = await fetchSource(
    "https://songbpm.com/searches",
    signal,
    8000,
    new URLSearchParams({
      query: `${primaryArtist(artist)} ${trackTitle(title)}`
    })
  );
  if (!html) return;
  const document = await parseSource(html, signal);
  const tempos = new Set<number>();
  for (const card of DomUtils.getElementsByTagName("a", document.children)) {
    if (!/^\/@[^/]+\/[^/]+$/.test(card.attribs.href ?? "")) continue;
    const labels = DomUtils.getElementsByTagName("p", [card]);
    if (
      labels.length !== 2 ||
      !sameArtist(artist, DomUtils.textContent(labels[0])) ||
      !matchingIdentity(title, DomUtils.textContent(labels[1]))
    )
      continue;
    const label = DomUtils.findOne(
      (element) =>
        element.name === "span" &&
        DomUtils.textContent(element).trim() === "BPM",
      card.children
    );
    const tempo = Number(
      label?.parent &&
        DomUtils.textContent(label.parent)
          .match(/^\s*BPM\s*(\d+(?:[.,]\d+)?)\s*$/i)?.[1]
          ?.replace(",", ".")
    );
    if (Number.isFinite(tempo) && tempo >= 40 && tempo <= 200)
      tempos.add(Math.round(tempo));
  }
  if (tempos.size === 1) return [...tempos][0];
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
  let url: string | undefined;
  // Broad artist matches can fill the site's limited result list. Retry the
  // title alone, still verifying the performer on both the result and page.
  for (const query of [
    `${trackTitle(title)} ${primaryArtist(artist)}`,
    trackTitle(title)
  ]) {
    const search = await fetchPisennyk(
      `${origin}/search?${new URLSearchParams({ q: query })}`,
      signal
    );
    if (!search) return [];
    const document = await parseSource(search, signal);
    const candidate = DomUtils.getElementsByTagName(
      "a",
      document.children
    ).find((element) => {
      if (
        !/^https:\/\/pisennyk\.com\.ua\/[^/?#]+\/[^/?#]+$/.test(
          element.attribs.href ?? ""
        )
      )
        return false;
      const label = DomUtils.textContent(element).trim();
      const parts = label.split(/\s+-\s+/);
      return (
        sameArtist(
          `${trackTitle(title)} ${primaryArtist(artist)}`,
          trackTitle(label)
        ) ||
        parts
          .slice(1)
          .some(
            (_, index) =>
              matchingIdentity(title, parts.slice(0, index + 1).join(" - ")) &&
              sameArtist(artist, parts.slice(index + 1).join(" - "))
          )
      );
    });
    if (candidate) {
      url = candidate.attribs.href;
      break;
    }
  }
  if (!url) return [];
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
  const extracted = await sourceBody(body, true, signal);
  const checkpoint = sourceWork(signal);
  const lines: string[] = [];
  for (const line of extracted.split("\n")) {
    lines.push(line.trimEnd());
    const pause = checkpoint();
    if (pause) await pause;
  }
  let content = lines
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
  const transposed = await transposeSongAsync(content, capo ?? 0, signal);
  await sourceTurn(signal);
  const metadataValues = chartMetadata(content, metadata);
  const hasChords = await hasSongChordsAsync(content, signal, true);
  if (signal?.aborted) throw new Error("Cancelled");
  return [
    {
      ...identity,
      content: transposed,
      capo,
      ...metadataValues,
      album: "",
      duration: null,
      source: "Пісенник",
      url,
      hasChords
    }
  ];
}

async function lookupMusicAccord(
  title: string,
  artist: string,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  const origin = "https://musicaccord.ru";
  const songURL = /^https:\/\/musicaccord\.ru\/songs\/[a-z0-9-]+\/$/;
  const hasClass =
    (name: string) => (element: { attribs: Record<string, string> }) =>
      (element.attribs.class ?? "").split(/\s+/).includes(name);
  const pageTitle = (label: string, performer = artist) => {
    if (label.length > 1000) return;
    const parts = label
      .replace(/:\s*аккорды на гитаре(?: без баррэ)?\s*$/i, "")
      .split(/\s+-\s+/);
    for (let split = 1; split < parts.length; split++) {
      const name = parts.slice(split).join(" - ");
      if (
        sameArtist(performer, parts.slice(0, split).join(" - ")) &&
        matchingIdentity(title, name)
      )
        return name;
    }
  };
  const candidates = new Set<string>();
  for (const query of [
    `${trackTitle(title)} ${primaryArtist(artist)}`,
    trackTitle(title)
  ]) {
    const html = await fetchSource(
      `${origin}/?${new URLSearchParams({ s: query })}`,
      signal
    );
    if (!html) continue;
    const search = await parseSource(html, signal);
    // Empty search pages still contain unrelated sidebar song links.
    for (const article of DomUtils.getElementsByTagName(
      "article",
      search.children
    )) {
      if (!hasClass("grid-item")(article) || !hasClass("type-song")(article))
        continue;
      const heading = DomUtils.getElementsByTagName(
        "h2",
        article.children
      ).find(hasClass("entry-title"));
      if (!heading || !pageTitle(DomUtils.textContent(heading).trim()))
        continue;
      const link = DomUtils.getElementsByTagName("a", heading.children).find(
        (element) => songURL.test(element.attribs.href ?? "")
      );
      if (link) candidates.add(link.attribs.href);
      if (candidates.size === 3) break;
    }
    if (candidates.size) break;
  }
  for (const url of candidates) {
    const html = await fetchSource(url, signal);
    if (!html) continue;
    const page = await parseSource(html, signal);
    const article = DomUtils.getElementsByTagName(
      "article",
      page.children
    ).find(hasClass("type-song"));
    if (!article) continue;
    const breadcrumbs = DomUtils.findOne(
      (element) =>
        element.name === "nav" && hasClass("song-breadcrumbs")(element),
      article.children
    );
    const performer =
      breadcrumbs &&
      DomUtils.getElementsByTagName("a", breadcrumbs.children).find((element) =>
        /^https:\/\/musicaccord\.ru\/artists\/[a-z0-9-]+\/$/.test(
          element.attribs.href ?? ""
        )
      );
    const foundArtist = performer ? DomUtils.textContent(performer).trim() : "";
    if (!sameArtist(artist, foundArtist)) continue;
    const heading = DomUtils.getElementsByTagName("h1", article.children).find(
      hasClass("entry-title")
    );
    const foundTitle =
      heading && pageTitle(DomUtils.textContent(heading).trim(), foundArtist);
    if (!foundTitle) continue;
    // Diagrams and the Article author's name cannot establish a song arrangement.
    const body = DomUtils.findOne(
      (element) =>
        element.name === "div" && hasClass("musicaccord-song")(element),
      article.children
    );
    if (!body) continue;
    const checkpoint = sourceWork(signal);
    const invalidSpans = [];
    // Keep the site's explicit chord anchors beside footnotes such as Em*.
    for (const span of DomUtils.getElementsByTagName("span", body.children)) {
      const chord = span.attribs["data-c"],
        text = span.children[0];
      if (
        hasClass("ch")(span) &&
        chord &&
        chordNotationPattern.test(chord) &&
        span.children.length === 1 &&
        DomUtils.isText(text) &&
        text.data === chord
      )
        text.data = `[${chord}]`;
      else if (hasClass("ch")(span)) invalidSpans.push(span);
      const pause = checkpoint();
      if (pause) await pause;
    }
    const chartText = async () => {
      const content = await normalizeSourceText(
        await sourceBody(body, false, signal),
        signal
      );
      if (!content || content.length > 200000) return "";
      const lines: string[] = [];
      for (const line of content.split("\n")) {
        const plain = line.replace(
          /\[([^\[\]]+)\]/g,
          (marked, chord: string) =>
            chordNotationPattern.test(chord) ? chord : marked
        );
        // Plain chord rows retain their alignment and cannot count as lyrics.
        lines.push(isChordLine(plain) ? plain : line);
        const pause = checkpoint();
        if (pause) await pause;
      }
      return lines.join("\n");
    };
    const content = await chartText();
    if (!content || !(await hasSongChordsAsync(content, signal, true)))
      continue;
    // Keep the source text for display, but unsupported chord markers cannot
    // establish lyrics (for example, the Hm in an otherwise chord-only row).
    if (invalidSpans.length) {
      for (const span of invalidSpans) {
        span.children = [];
        const pause = checkpoint();
        if (pause) await pause;
      }
      const validationContent = await chartText();
      if (!(await hasSongChordsAsync(validationContent, signal, true)))
        continue;
    }
    return [
      {
        id: 0,
        title: foundTitle,
        artist: foundArtist,
        content,
        album: "",
        duration: null,
        ...sourceMetadata(content),
        source: "Musicaccord.ru",
        url,
        hasChords: true
      }
    ];
  }
  return [];
}

const chordSources = {
  "Cifra Club": { origin: "https://www.cifraclub.com", path: "" },
  "E-Chords": { origin: "https://www.e-chords.com", path: "/en/chords" },
  Cifras: { origin: "https://www.cifras.com.br", path: "/cifra" },
  GuitareTab: { origin: "https://www.guitaretab.com", path: "/fetch/" },
  "Akkords.pro": { origin: "https://akkords.pro", path: "/songs" }
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
  const matchesArtist = (value: string) =>
    sameArtist(artist, value) ||
    (source === "Akkords.pro" &&
      sameArtist(artist, value.replace(/\s+\([^()]+\)\s*$/, "")));
  const provider = chordSources[source];
  if (source === "Akkords.pro" && !candidateUrl) {
    const candidates = new Set<string>();
    // Artist metadata is not always searchable. A bounded title-only retry
    // also tolerates omitted terminal punctuation without changing song words.
    for (const query of [
      `${trackTitle(title)} ${primaryArtist(artist)}`,
      trackTitle(title)
        .replace(/[?!]+$/, "")
        .trim()
    ]) {
      if (!query) continue;
      const search = await fetchSource(
        `${provider.origin}/?${new URLSearchParams({ s: query })}`,
        signal
      );
      if (!search) return [];
      const document = await parseSource(search, signal);
      for (const link of DomUtils.getElementsByTagName(
        "a",
        document.children
      )) {
        if (
          !/^https:\/\/akkords\.pro\/songs\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(
            link.attribs.href ?? ""
          )
        )
          continue;
        const label = (className: string) => {
          const element = DomUtils.findOne(
            (node) =>
              (node.attribs.class ?? "").split(/\s+/).includes(className),
            link.children
          );
          return element ? DomUtils.textContent(element).trim() : "";
        };
        if (
          matchingIdentity(title, label("apx-top-songs__title")) &&
          matchesArtist(label("apx-top-songs__artist"))
        ) {
          candidates.add(link.attribs.href);
          if (candidates.size === 3) break;
        }
      }
      if (candidates.size) break;
    }
    for (const url of candidates) {
      const options = await lookupChordPage(title, artist, source, signal, url);
      if (options.some((option) => option.hasChords)) return options;
    }
    return [];
  }
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
  if ((!artistSlug || !titleSlug) && !candidateUrl) return [];
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
    // Some matching arrangements are listed as tabs; their detail still has
    // to establish identity and lyrics with chords before counting as success.
    for (const suffix of [
      / chords(?: \(ver \d+\))?$/i,
      / tab(?: \(ver \d+\))?$/i
    ]) {
      for (const row of rows) {
        const links = DomUtils.getElementsByTagName("a", row.children);
        if (
          !links.some((link) => sameArtist(artist, DomUtils.textContent(link)))
        )
          continue;
        const candidate = links.find((link) => {
          const label = DomUtils.textContent(link).trim();
          return (
            suffix.test(label) &&
            matchingIdentity(title, label.replace(suffix, "")) &&
            /^\/[a-z0-9]\/[a-z0-9-]+\/\d+\.html$/.test(link.attribs.href ?? "")
          );
        });
        if (candidate) {
          paths.add(candidate.attribs.href);
          if (paths.size === 3) break;
        }
      }
      if (paths.size) break;
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
    if (
      results.length &&
      results.every((result) => result.status === "rejected")
    )
      throw new Error("LyricsServiceUnavailable");
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
          matchesArtist(performer.name)
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
  if (source === "Akkords.pro" && (!foundTitle || !foundArtist)) return [];
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
  ).find((element) => matchesArtist(DomUtils.textContent(element)));
  foundTitle ||=
    heading("h1", "t1") ||
    (titleHeading ? DomUtils.textContent(titleHeading).trim() : "");
  foundArtist ||=
    heading("h2", "t3") ||
    (artistHeading ? DomUtils.textContent(artistHeading).trim() : "");
  if (!matchingIdentity(title, foundTitle) || !matchesArtist(foundArtist))
    return [];
  const container = DomUtils.findOne(
    (element) =>
      source === "Akkords.pro"
        ? element.name === "p" &&
          (element.attribs.class ?? "").split(/\s+/).includes("chords")
        : (element.attribs.class ?? "")
            .split(/\s+/)
            .some((name) => ["cifra_cnt", "core", "cifra"].includes(name)) ||
          ["core", "cifra", "chord-content"].includes(element.attribs.id),
    document.children
  );
  if (source === "Akkords.pro" && !container) return [];
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
  const text = await sourceBody(body, false, signal);
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
  const content = await transposeSongAsync(
    await normalizeSourceText(text, signal),
    capo,
    signal
  );
  if (!content || content.length > 200000) return [];
  await sourceTurn(signal);
  const metadataValues = chartMetadata(
    text,
    DomUtils.findOne(
      (element) =>
        (element.attribs.class ?? "").split(/\s+/).includes("song-metadata"),
      document.children
    )
  );
  const hasChords = await hasSongChordsAsync(content, signal, true);
  if (signal?.aborted) throw new Error("Cancelled");
  return [
    {
      id: 0,
      title: foundTitle,
      artist: foundArtist,
      content,
      capo,
      tuning,
      ...metadataValues,
      album: "",
      duration: null,
      source,
      url,
      hasChords
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

const providerContext: ChordProviderContext = {
  fetchSource,
  parseSource,
  sourceBody,
  normalizeSourceText,
  sourceWork,
  matchingIdentity,
  sameArtist,
  trackTitle,
  primaryArtist
};

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
    const latinIdentity = /^\p{Script=Latin}+$/u.test(
      `${title} ${artist}`.replace(/[^\p{L}]/gu, "")
    );
    const sources = Object.keys(chordSources).filter(
      (source) => source === "Akkords.pro" || latinIdentity
    );
    const primaryRequests = [
      ...sources.map((source) =>
        lookupChordPage(
          title,
          artist,
          source as keyof typeof chordSources,
          controller.signal
        )
      ),
      lookupPisennyk(title, artist, controller.signal),
      lookupMusicAccord(title, artist, controller.signal)
    ];
    const primaryCompleted = Promise.allSettled(primaryRequests);
    const lyricRequest = lookupLyrics(title, artist, controller.signal);
    // Consult extra catalogues only after the existing providers cannot find
    // a playable arrangement. Successful lookups retain their request path.
    const fallbackProviders: Array<
      (
        name: string,
        performer: string,
        abortSignal: AbortSignal | undefined,
        context: ChordProviderContext
      ) => Promise<LyricsOption[]>
    > = [
      ...(latinIdentity ? [lookupChordsAndTabs, lookupSonidos] : []),
      ...(/^[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(primaryArtist(artist))
        ? [lookupAkkordsFun]
        : []),
      ...(/\p{Script=Hangul}/u.test(`${title} ${artist}`)
        ? [lookupWeingGuitar]
        : []),
      ...(/\p{Script=Cyrillic}/u.test(`${title} ${artist}`)
        ? [
            (
              name: string,
              performer: string,
              abortSignal: AbortSignal | undefined,
              context: ChordProviderContext
            ) =>
              lookupLalaTracker(
                name,
                performer,
                abortSignal,
                context,
                lyricRequest
              )
          ]
        : [])
    ];
    const chordRequests = [
      ...primaryRequests,
      ...fallbackProviders.map((lookup) =>
        primaryCompleted.then((results) => {
          if (
            results.some(
              (result) =>
                result.status === "fulfilled" &&
                result.value.some((option) => option.hasChords)
            )
          )
            return [];
          if (controller.signal.aborted) throw new Error("Cancelled");
          return lookup(title, artist, controller.signal, providerContext);
        })
      )
    ];
    const requests = [...chordRequests, lyricRequest];
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
    const results = await completed;
    if (
      results
        .slice(0, chordRequests.length)
        .every((result) => result.status === "rejected")
    )
      throw new Error("ChordSourcesUnavailable");
    if (options.length) return options;
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
