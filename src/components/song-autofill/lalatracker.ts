import { DomUtils } from "htmlparser2";
import {
  chordNotationPattern,
  hasSongChordsAsync,
  isChordLine
} from "../../screens/song/chords";
import type { ChordProviderContext } from "./chord-provider-context";
import type { LyricsOption } from "./lyrics";
import { sourceMetadata } from "./source-metadata";

const origin = "https://lalatracker.com";
const sourceSong =
  /^https:\/\/lalatracker\.com\/chords\/[a-z0-9_-]{1,200}\/(?:[a-f0-9]{24}|\d{1,12})-[a-z0-9_-]{1,500}$/;
const sourceArtist =
  /^https:\/\/lalatracker\.com\/chords\/(?:[a-f0-9]{24}|\d{1,12})-[a-z0-9_-]{1,500}$/;
const absolute = (href = "") =>
  href.startsWith("/") && !href.startsWith("//") ? origin + href : href;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const normalizedLine = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// This catalogue also publishes full names as surname + given name. Reversal
// alone is never enough: a candidate needs independent lyric corroboration.
function reversedName(value: string) {
  const words = value.trim().split(/\s+/);
  return words.length === 2 &&
    words.every((word) => /^\p{Script=Cyrillic}{3,}$/u.test(word))
    ? `${words[1]} ${words[0]}`
    : undefined;
}

async function eligibleLyricLines(
  content: string,
  title: string,
  signal: AbortSignal | undefined,
  context: ChordProviderContext
) {
  const result = new Set<string>();
  const checkpoint = context.sourceWork(signal);
  const titleKey = normalizedLine(title);
  for (const row of content.split(/\r?\n/)) {
    const pause = checkpoint();
    if (pause) await pause;
    if (isChordLine(row)) continue;
    const line = row
      .replace(/\[([^\[\]]+)\]/g, (marked, chord: string) =>
        chordNotationPattern.test(chord) ? "" : marked
      )
      .trim();
    if (
      !line ||
      isChordLine(line) ||
      /^(?:\[[^\[\]]*\]|\{[^{}]*\})$/.test(line) ||
      /^(?:song|title|artist|album|текст|слова|музыка|исполнитель|автор|название|альбом)\s*[:=]/iu.test(
        line
      ) ||
      /^(?:tabbed|transcribed|arranged)\s+by(?:\s|[:=–—-])/iu.test(line) ||
      /^(?:capo|капо(?:дастр)?|tempo|bpm|темп|tuning|строй|тональность|бой|перебор)\s*[:\d]/iu.test(
        line
      ) ||
      /^(?:для удобства|вся песня)\s*:/iu.test(line) ||
      /^(?:intro|verse|chorus|bridge|outro|solo|interlude|instrumental|refrain|coda|приспів|куплет|припев|вступ|вступление|переход|бридж|брідж|програш|проигрыш|соло|кода|рефрен)(?:\s+(?:\d+|[ivx]+))?\s*(?::.*)?$/iu.test(
        line
      )
    )
      continue;
    const key = normalizedLine(line);
    if (
      key !== titleKey &&
      key.split(" ").filter((word) => /\p{L}/u.test(word)).length >= 3 &&
      (key.match(/\p{L}/gu)?.length ?? 0) >= 15
    )
      result.add(key);
  }
  if (signal?.aborted) throw new Error("Cancelled");
  return result;
}

async function awaitReferences(
  references: Promise<LyricsOption[]>,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  if (signal?.aborted) throw new Error("Cancelled");
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    void references.then(
      (options) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new Error("Cancelled"));
        else resolve(options);
      },
      () => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new Error("Cancelled"));
        else resolve([]);
      }
    );
  });
}

export async function lookupLalaTracker(
  title: string,
  artist: string,
  signal: AbortSignal | undefined,
  context: ChordProviderContext,
  references: Promise<LyricsOption[]>
): Promise<LyricsOption[]> {
  const compatibleArtist = (name: string) => {
    if (context.sameArtist(artist, name)) return true;
    const reversed = reversedName(name);
    return !!reversed && context.sameArtist(artist, reversed);
  };
  const searchHTML = await context.fetchSource(
    `${origin}/search?${new URLSearchParams({ name: context.trackTitle(title) })}`,
    signal
  );
  if (!searchHTML) return [];
  const search = await context.parseSource(searchHTML, signal);
  const searchMain = DomUtils.getElementsByTagName("main", search.children)[0];
  if (!searchMain) return [];
  const candidates = new Set<string>();
  const checkpoint = context.sourceWork(signal);
  for (const link of DomUtils.getElementsByTagName("a", searchMain.children)) {
    const url = absolute(link.attribs.href);
    if (url.length > 1000 || !sourceSong.test(url)) continue;
    const credits = link.children.filter(DomUtils.isTag);
    const foundTitle = link.children
      .filter(DomUtils.isText)
      .map((node) => node.data)
      .join("")
      .trim();
    if (
      credits.length === 1 &&
      credits[0].name === "span" &&
      context.matchingIdentity(title, foundTitle) &&
      compatibleArtist(DomUtils.textContent(credits[0]).trim())
    )
      candidates.add(url);
    if (candidates.size === 3) break;
    const pause = checkpoint();
    if (pause) await pause;
  }
  for (const url of candidates) {
    const html = await context.fetchSource(url, signal);
    if (!html) continue;
    const page = await context.parseSource(html, signal);
    const metadata: Record<string, unknown>[] = [];
    for (const script of DomUtils.getElementsByTagName(
      "script",
      page.children
    )) {
      if (script.attribs.type !== "application/ld+json") continue;
      const json = DomUtils.textContent(script);
      if (json.length > 50000) continue;
      try {
        const value: unknown = JSON.parse(json);
        if (record(value)) metadata.push(value);
      } catch {
        // An unrelated or malformed metadata block cannot establish identity.
      }
    }
    const composition = metadata.find(
      (entry) => entry["@type"] === "MusicComposition" && entry.url === url
    );
    const breadcrumbs = metadata.find(
      (entry) => entry["@type"] === "BreadcrumbList"
    );
    if (!composition || !Array.isArray(breadcrumbs?.itemListElement)) continue;
    const items = breadcrumbs.itemListElement.filter(record);
    const credits = items.filter((entry) => entry.position === 3);
    const tracks = items.filter((entry) => entry.position === 4);
    if (credits.length !== 1 || tracks.length !== 1) continue;
    const performer = credits[0],
      track = tracks[0];
    const foundArtist = performer.name,
      foundTitle = composition.name;
    if (
      typeof foundArtist !== "string" ||
      foundArtist.length > 300 ||
      typeof foundTitle !== "string" ||
      foundTitle.length > 1000 ||
      typeof performer.item !== "string" ||
      !sourceArtist.test(performer.item) ||
      track.item !== url ||
      track.name !== foundTitle ||
      !compatibleArtist(foundArtist) ||
      !context.matchingIdentity(title, foundTitle)
    )
      continue;
    const main = DomUtils.getElementsByTagName("main", page.children)[0];
    if (!main) continue;
    const heading = DomUtils.getElementsByTagName("h1", main.children)[0];
    const visibleCrumbs = DomUtils.getElementsByTagName(
      "nav",
      main.children
    ).find((element) => element.attribs["aria-label"] === "Хлебные крошки");
    const visibleArtist =
      visibleCrumbs &&
      DomUtils.getElementsByTagName("a", visibleCrumbs.children).find(
        (element) => absolute(element.attribs.href) === performer.item
      );
    const visibleTitle =
      visibleCrumbs &&
      DomUtils.findOne(
        (element) => element.attribs["aria-current"] === "page",
        visibleCrumbs.children
      );
    if (
      !heading ||
      DomUtils.textContent(heading).replace(/\s+/g, " ").trim() !==
        `Аккорды к песне ${foundArtist} — ${foundTitle}` ||
      !visibleArtist ||
      DomUtils.textContent(visibleArtist).trim() !== foundArtist ||
      !visibleTitle ||
      DomUtils.textContent(visibleTitle).trim() !== foundTitle
    )
      continue;
    const body = DomUtils.getElementsByTagName("pre", main.children).find(
      (element) => element.attribs.id === "song-text"
    );
    if (!body) continue;
    // The observed chart format is plain text with leaf chord labels and line
    // breaks. Controls, scripts and hidden elements are not lyric evidence.
    if (
      DomUtils.findOne(
        (element) => element.name !== "b" && element.name !== "br",
        body.children
      )
    )
      continue;
    let invalidChord = false;
    for (const chord of DomUtils.getElementsByTagName("b", body.children)) {
      const value = DomUtils.textContent(chord);
      const text = chord.children[0];
      if (
        !chordNotationPattern.test(value) ||
        chord.children.length !== 1 ||
        !DomUtils.isText(text)
      ) {
        invalidChord = true;
        break;
      }
      text.data = `[${value}]`;
      const pause = checkpoint();
      if (pause) await pause;
    }
    if (invalidChord) continue;
    const content = await context.normalizeSourceText(
      await context.sourceBody(body, false, signal),
      signal
    );
    if (
      !content ||
      content.length > 200000 ||
      !(await hasSongChordsAsync(content, signal, true))
    )
      continue;
    const candidateLines = await eligibleLyricLines(
      content,
      foundTitle,
      signal,
      context
    );
    if (!candidateLines.size) continue;
    let identity:
      | Pick<LyricsOption, "artist" | "sourceArtist" | "identityReference">
      | undefined;
    // This catalogue can publish another song's body under matching labels.
    // Corroborate every chart, including exact artist names, using the existing
    // in-flight result. Keep the source chart intact and use one reference.
    const options = await awaitReferences(references, signal);
    for (const reference of options.slice(0, 20)) {
      if (
        reference.source !== "LRCLIB" ||
        !reference.url ||
        !/^https:\/\/lrclib\.net\/api\/get\/\d+$/.test(reference.url) ||
        !context.matchingIdentity(title, reference.title) ||
        !context.sameArtist(artist, reference.artist) ||
        !reference.content ||
        reference.content.length > 200000
      )
        continue;
      const referenceLines = await eligibleLyricLines(
        reference.content,
        reference.title,
        signal,
        context
      );
      const matchedLines = [...candidateLines].filter((line) =>
        referenceLines.has(line)
      ).length;
      if (matchedLines < 4 || matchedLines / candidateLines.size < 0.5)
        continue;
      const exactArtist = context.sameArtist(artist, foundArtist);
      identity = {
        artist: exactArtist ? foundArtist : reference.artist,
        ...(!exactArtist ? { sourceArtist: foundArtist } : {}),
        identityReference: {
          source: "LRCLIB",
          url: reference.url,
          matchedLines,
          candidateLines: candidateLines.size
        }
      };
      break;
    }
    if (!identity) continue;
    if (signal?.aborted) throw new Error("Cancelled");
    return [
      {
        id: 0,
        title: foundTitle,
        ...identity,
        content,
        album: "",
        duration: null,
        ...sourceMetadata(content),
        source: "LalaTracker",
        url,
        hasChords: true
      }
    ];
  }
  return [];
}
