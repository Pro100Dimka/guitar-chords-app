import { DomUtils } from "htmlparser2";
import {
  chordNotationPattern,
  hasSongChordsAsync,
  normalizeChord
} from "../../screens/song/chords";
import type { ChordProviderContext } from "./chord-provider-context";
import type { LyricsOption } from "./lyrics";

const origin = "https://guitar.weingchicken.com";
const hasClass = (element: { attribs: Record<string, string> }, name: string) =>
  (element.attribs.class ?? "").split(/\s+/).includes(name);

export async function lookupWeingGuitar(
  title: string,
  artist: string,
  signal: AbortSignal | undefined,
  context: ChordProviderContext
): Promise<LyricsOption[]> {
  // This catalogue publishes Korean identities. Do not issue broad searches
  // for unrelated scripts or guess translated titles such as Spring Day.
  if (!/\p{Script=Hangul}/u.test(`${title} ${artist}`)) return [];
  const matchedArtist = (published: string) => {
    if (context.sameArtist(artist, published)) return published;
    // The source explicitly prints Korean names with their Latin aliases,
    // for example 방탄소년단(BTS). Both names must be part of this one credit.
    const pair = /^([^()]{1,100})\s*\(([^()]{1,100})\)$/.exec(published);
    if (!pair) return;
    const names = [pair[1].trim(), pair[2].trim()];
    const korean = /^[\p{Script=Hangul} ·]+$/u;
    const latin = /^[\p{Script=Latin}\p{N} ._'’\-]+$/u;
    if (
      !(
        (korean.test(names[0]) && latin.test(names[1])) ||
        (latin.test(names[0]) && korean.test(names[1]))
      ) ||
      names.some((name) =>
        /\b(?:feat|ft|featuring|with|cover|version|translation|remix|live|acoustic|instrumental|karaoke)\b|커버|버전|번역|편곡|피아노|악보/iu.test(
          name
        )
      )
    )
      return;
    return names.find((name) => context.sameArtist(artist, name));
  };
  const identity = (label: string) => {
    if (label.length > 1000) return;
    const parts = label.trim().split(/\s+-\s+/);
    for (let split = 1; split < parts.length; split++) {
      const foundTitle = parts.slice(split).join(" - ");
      if (!context.matchingIdentity(title, foundTitle)) continue;
      const foundArtist = matchedArtist(parts.slice(0, split).join(" - "));
      if (foundArtist) return { title: foundTitle, artist: foundArtist };
    }
  };
  const candidates = new Set<string>();
  for (const query of new Set([
    `${context.trackTitle(title)} ${context.primaryArtist(artist)}`,
    context.trackTitle(title)
  ])) {
    const html = await context.fetchSource(
      `${origin}/scores?${new URLSearchParams({ query })}`,
      signal
    );
    if (!html) continue;
    const page = await context.parseSource(html, signal);
    // Search results are table rows; unrelated navigation links do not count.
    for (const table of DomUtils.getElementsByTagName("tbody", page.children)) {
      if (candidates.size === 3) break;
      for (const link of DomUtils.getElementsByTagName("a", table.children)) {
        const path = link.attribs.href ?? "";
        if (
          hasClass(link, "font-weight-bold") &&
          /^\/scores\/[1-9]\d*$/.test(path) &&
          identity(DomUtils.textContent(link))
        )
          candidates.add(`${origin}${path}`);
        if (candidates.size === 3) break;
      }
    }
    if (candidates.size) break;
  }
  for (const url of candidates) {
    const html = await context.fetchSource(url, signal);
    if (!html) continue;
    const page = await context.parseSource(html, signal);
    const main = DomUtils.getElementsByTagName("main", page.children)[0];
    if (!main) continue;
    const heading = DomUtils.getElementsByTagName("h4", main.children).find(
      (element) => hasClass(element, "font-weight-bold")
    );
    const found = heading && identity(DomUtils.textContent(heading));
    if (!found) continue;
    const body = DomUtils.findOne(
      (element) => element.attribs.id === "scoreBodyWrapper",
      main.children
    );
    if (!body) continue;
    const checkpoint = context.sourceWork(signal);
    const parts: string[] = [];
    let valid = true;
    let hasLyrics = false;
    for (const paragraph of DomUtils.getElementsByTagName(
      "div",
      body.children
    ).filter((element) => hasClass(element, "score-paragraph"))) {
      for (const piece of paragraph.children) {
        const pause = checkpoint();
        if (pause) await pause;
        if (!DomUtils.isTag(piece)) continue;
        if (piece.name === "br" || hasClass(piece, "clearfix")) {
          parts.push("\n");
          continue;
        }
        if (!hasClass(piece, "score-piece-wrapper")) continue;
        const children = piece.children.filter(DomUtils.isTag);
        const chordBody = children.find((element) =>
          hasClass(element, "chord-wrapper")
        );
        const lyrics = children.find((element) => hasClass(element, "lyrics"));
        if (chordBody && DomUtils.textContent(chordBody).trim()) {
          const links = DomUtils.getElementsByTagName("a", chordBody.children);
          const link = links.length === 1 ? links[0] : undefined;
          const marked = link?.attribs["data-chord"];
          const span =
            link?.children.length === 1 ? link.children[0] : undefined;
          const chord = marked && normalizeChord(marked);
          if (
            !chord ||
            !chordNotationPattern.test(chord) ||
            !span ||
            !DomUtils.isTag(span) ||
            span.name !== "span" ||
            !hasClass(span, "chord") ||
            span.children.length !== 1 ||
            !DomUtils.isText(span.children[0]) ||
            span.children[0].data !== marked ||
            DomUtils.textContent(chordBody).trim() !== marked
          ) {
            valid = false;
            break;
          }
          parts.push(`[${chord}]${lyrics ? "" : " "}`);
        }
        if (lyrics) {
          if (
            DomUtils.findOne(
              (element) =>
                ["script", "style", "button", "iframe"].includes(element.name),
              lyrics.children
            )
          ) {
            valid = false;
            break;
          }
          const text = await context.sourceBody(lyrics, false, signal);
          parts.push(text);
          if (
            /\p{L}/u.test(text) &&
            !/^\s*[\[(]?(?:전주|간주|후주|인트로|아웃트로|후렴|벌스|코러스|반주)[\])]?\s*$/u.test(
              text
            )
          )
            hasLyrics = true;
        }
      }
      if (!valid) break;
      parts.push("\n");
    }
    if (!valid || !hasLyrics) continue;
    const content = await context.normalizeSourceText(parts.join(""), signal);
    if (
      !content ||
      content.length > 200000 ||
      !(await hasSongChordsAsync(content, signal, true))
    )
      continue;
    return [
      {
        ...found,
        id: 0,
        album: "",
        duration: null,
        source: "WeingGuitar",
        url,
        hasChords: true,
        content
      }
    ];
  }
  return [];
}
