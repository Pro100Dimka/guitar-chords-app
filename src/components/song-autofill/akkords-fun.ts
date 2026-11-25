import { DomUtils } from "htmlparser2";
import {
  chordNotationPattern,
  hasSongChordsAsync
} from "../../screens/song/chords";
import type { ChordProviderContext } from "./chord-provider-context";
import type { LyricsOption } from "./lyrics";

const origin = "https://akkords.fun";
const artistURL = /^https:\/\/akkords\.fun\/(?:rus|eng)\/[a-z0-9-]+\/$/;
const songURL =
  /^https:\/\/akkords\.fun\/(?:rus|eng)\/[a-z0-9-]+\/[a-z0-9-]+\/$/;
const indexCache = new Map<
  string,
  { expires: number; artists: { name: string; url: string }[] }
>();
const hasClass =
  (name: string) => (element: { attribs: Record<string, string> }) =>
    (element.attribs.class ?? "").split(/\s+/).includes(name);
const absolute = (href = "") =>
  href.startsWith("/") && !href.startsWith("//") ? origin + href : href;

/** The site's public artist indexes avoid its disallowed search endpoint. */
export async function lookupAkkordsFun(
  title: string,
  artist: string,
  signal: AbortSignal | undefined,
  context: ChordProviderContext
): Promise<LyricsOption[]> {
  const initial = context.primaryArtist(artist).trim()[0] ?? "";
  const group = /\p{Script=Cyrillic}/u.test(initial)
    ? "rus"
    : /\p{Script=Latin}/u.test(initial)
      ? "eng"
      : undefined;
  if (!group) return [];
  if (signal?.aborted) throw new Error("Cancelled");
  let index = indexCache.get(group);
  if (!index || index.expires <= Date.now()) {
    const html = await context.fetchSource(`${origin}/${group}/`, signal);
    if (!html) return [];
    const page = await context.parseSource(html, signal);
    const artists: { name: string; url: string }[] = [];
    const seen = new Set<string>();
    const checkpoint = context.sourceWork(signal);
    for (const link of DomUtils.getElementsByTagName("a", page.children)) {
      const url = absolute(link.attribs.href);
      const name = DomUtils.textContent(link).trim();
      if (artistURL.test(url) && name && name.length <= 300 && !seen.has(url)) {
        seen.add(url);
        artists.push({ name, url });
      }
      const pause = checkpoint();
      if (pause) await pause;
    }
    index = { expires: Date.now() + 600000, artists };
    // Only the two public alphabet indexes are cached; no failed lookup is cached.
    if (artists.length) indexCache.set(group, index);
  }
  const performers = index.artists
    .filter((entry) => context.sameArtist(artist, entry.name))
    .slice(0, 2);
  let inspected = 0;
  for (const performer of performers) {
    const html = await context.fetchSource(performer.url, signal);
    if (!html) continue;
    const page = await context.parseSource(html, signal);
    const heading = DomUtils.getElementsByTagName("h1", page.children)[0];
    const headingArtist = heading
      ? DomUtils.textContent(heading)
          .replace(/\s+—\s+аккорды и тексты песен\s*$/i, "")
          .trim()
      : "";
    if (!context.sameArtist(artist, headingArtist)) continue;
    const candidates = new Set<string>();
    for (const list of DomUtils.getElementsByTagName(
      "ol",
      page.children
    ).concat(DomUtils.getElementsByTagName("ul", page.children))) {
      if (!hasClass("af-list")(list)) continue;
      for (const link of DomUtils.getElementsByTagName("a", list.children)) {
        const url = absolute(link.attribs.href);
        if (
          songURL.test(url) &&
          url.startsWith(performer.url) &&
          context.matchingIdentity(title, DomUtils.textContent(link).trim())
        )
          candidates.add(url);
        if (candidates.size >= 3 - inspected) break;
      }
    }
    for (const url of candidates) {
      if (inspected++ >= 3) return [];
      const detail = await context.fetchSource(url, signal);
      if (!detail) continue;
      const document = await context.parseSource(detail, signal);
      const article = DomUtils.getElementsByTagName(
        "article",
        document.children
      ).find(hasClass("af-song"));
      const crumbs = DomUtils.getElementsByTagName(
        "nav",
        document.children
      ).find(hasClass("af-crumbs"));
      if (!article || !crumbs) continue;
      const credit = DomUtils.getElementsByTagName("a", crumbs.children).find(
        (element) => absolute(element.attribs.href) === performer.url
      );
      const current = DomUtils.findOne(
        (element) => element.attribs["aria-current"] === "page",
        crumbs.children
      );
      const foundArtist = credit ? DomUtils.textContent(credit).trim() : "";
      const foundTitle = current ? DomUtils.textContent(current).trim() : "";
      if (
        !context.sameArtist(artist, foundArtist) ||
        !context.matchingIdentity(title, foundTitle)
      )
        continue;
      const h1 = DomUtils.getElementsByTagName("h1", article.children)[0];
      if (
        !h1 ||
        DomUtils.textContent(h1).trim() !==
          `${foundTitle} (${foundArtist}) — аккорды на гитаре`
      )
        continue;
      const body = DomUtils.findOne(
        (element) =>
          element.name === "div" &&
          hasClass("af-sheet")(element) &&
          "data-af-sheet" in element.attribs,
        article.children
      );
      if (!body) continue;
      const checkpoint = context.sourceWork(signal);
      let markers = 0;
      let invalidMarker = false;
      for (const chord of DomUtils.getElementsByTagName("b", body.children)) {
        if (!("data-ch" in chord.attribs)) continue;
        const name = chord.attribs["data-ch"];
        const text = chord.children[0];
        if (
          !chordNotationPattern.test(name) ||
          chord.children.length !== 1 ||
          !DomUtils.isText(text) ||
          text.data !== name
        ) {
          invalidMarker = true;
          break;
        }
        text.data = `[${name}]`;
        markers++;
        const pause = checkpoint();
        if (pause) await pause;
      }
      if (!markers || invalidMarker) continue;
      const lines: string[] = [];
      const lyricRows: string[] = [];
      for (const row of DomUtils.findAll(
        (element) =>
          (element.name === "p" && hasClass("af-ln")(element)) ||
          (element.name === "h3" && hasClass("af-part_h")(element)),
        body.children
      )) {
        if (row.name === "h3")
          lines.push(`[${DomUtils.textContent(row).trim()}]`);
        else {
          const line = await context.sourceBody(row, false, signal);
          lines.push(line);
          lyricRows.push(line);
        }
        const pause = checkpoint();
        if (pause) await pause;
      }
      const content = await context.normalizeSourceText(
        lines.join("\n"),
        signal
      );
      // Arbitrary section labels are presentation metadata, never lyric evidence.
      const validationContent = await context.normalizeSourceText(
        lyricRows.join("\n"),
        signal
      );
      if (
        !content ||
        content.length > 200000 ||
        !(await hasSongChordsAsync(content, signal, true)) ||
        !(await hasSongChordsAsync(validationContent, signal, true))
      )
        continue;
      return [
        {
          id: 0,
          title: foundTitle,
          artist: foundArtist,
          content,
          album: "",
          duration: null,
          source: "Akkords.fun",
          url,
          hasChords: true
        }
      ];
    }
  }
  return [];
}
