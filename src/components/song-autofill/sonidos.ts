import { DomUtils } from "htmlparser2";
import {
  chordNotationPattern,
  hasSongChordsAsync,
  normalizeChord,
  transposeSongAsync
} from "../../screens/song/chords";
import type { LyricsOption } from "./lyrics";
import type { ChordProviderContext } from "./chord-provider-context";

const origin = "https://www.sonidos.com.br";
type Element = Parameters<typeof DomUtils.getAttributeValue>[0];
const hasClass = (element: Element, name: string) =>
  (element.attribs.class ?? "").split(/\s+/).includes(name);
const chartPath = /^\/[a-z0-9-]+\/[a-z0-9-]+$/;

export async function lookupSonidos(
  title: string,
  artist: string,
  signal: AbortSignal | undefined,
  context: ChordProviderContext
): Promise<LyricsOption[]> {
  if (signal?.aborted) throw new Error("Cancelled");
  const candidates = new Set<string>();
  const checkpoint = context.sourceWork(signal);
  for (const query of new Set([
    `${context.trackTitle(title)} ${context.primaryArtist(artist)}`,
    context.trackTitle(title)
  ])) {
    const html = await context.fetchSource(
      `${origin}/busca?${new URLSearchParams({ q: query })}`,
      signal
    );
    if (!html) continue;
    const document = await context.parseSource(html, signal);
    for (const card of DomUtils.findAll(
      (element) =>
        element.name === "section" && hasClass(element, "new-artist"),
      document.children
    )) {
      const heading = DomUtils.findOne(
        (element) => hasClass(element, "new-artist-head"),
        card.children
      );
      const artistLink =
        heading &&
        DomUtils.findOne(
          (element) =>
            element.name === "a" && hasClass(element, "new-artist-link"),
          heading.children
        );
      const artistName =
        artistLink &&
        DomUtils.getElementsByTagName("h3", artistLink.children)[0];
      if (
        !artistLink ||
        !artistName ||
        !/^\/[a-z0-9-]+$/.test(artistLink.attribs.href ?? "") ||
        !context.sameArtist(artist, DomUtils.textContent(artistName).trim())
      )
        continue;
      for (const link of DomUtils.getElementsByTagName("a", card.children)) {
        const path = link.attribs.href ?? "";
        if (
          hasClass(link, "new-song-title") &&
          path.length <= 500 &&
          chartPath.test(path) &&
          path.startsWith(`${artistLink.attribs.href}/`) &&
          context.matchingIdentity(title, DomUtils.textContent(link).trim())
        )
          candidates.add(path);
        if (candidates.size === 3) break;
      }
      if (candidates.size === 3) break;
      const pause = checkpoint();
      if (pause) await pause;
    }
    if (candidates.size) break;
  }
  for (const path of candidates) {
    const url = `${origin}${path}`;
    const html = await context.fetchSource(url, signal);
    if (!html) continue;
    const document = await context.parseSource(html, signal);
    const head = DomUtils.findOne(
      (element) => hasClass(element, "song-head-titles"),
      document.children
    );
    if (!head) continue;
    const titleHeading = DomUtils.findOne(
      (element) =>
        element.name === "h1" && hasClass(element, "song-sticky-title"),
      head.children
    );
    const artistLink = DomUtils.getElementsByTagName("a", head.children).find(
      (element) => element.attribs.href === path.slice(0, path.lastIndexOf("/"))
    );
    const foundTitle = titleHeading
      ? DomUtils.textContent(titleHeading).trim()
      : "";
    const foundArtist = artistLink
      ? DomUtils.textContent(artistLink).trim()
      : "";
    if (
      !context.matchingIdentity(title, foundTitle) ||
      !context.sameArtist(artist, foundArtist)
    )
      continue;
    const body = DomUtils.findOne(
      (element) =>
        hasClass(element, "song-cifra") &&
        element.attribs["data-cifra"] !== undefined,
      document.children
    );
    if (!body) continue;
    const blocks = DomUtils.findAll(
      (element) =>
        element.name === "h3" ||
        (element.name === "pre" && hasClass(element, "cifra-pre")) ||
        hasClass(element, "cifra-intro-row"),
      body.children
    );
    const lines: string[] = [];
    const evidence: string[] = [];
    let valid = true;
    for (const block of blocks) {
      if (block.name === "h3") {
        lines.push(`[${DomUtils.textContent(block).trim()}]`);
      } else if (hasClass(block, "cifra-intro-row")) {
        // Intro chords have a duplicated, aria-hidden layout label. Import
        // only the visible name, never diagram text or that hidden duplicate.
        const chords: string[] = [];
        for (const marker of DomUtils.getElementsByTagName(
          "span",
          block.children
        )) {
          if (!hasClass(marker, "cifra-chord")) continue;
          const label = DomUtils.findOne(
            (element) => hasClass(element, "cifra-intro-name"),
            marker.children
          );
          const value = label ? DomUtils.textContent(label).trim() : "";
          const chord = normalizeChord(value.replace(/º/g, "°"));
          if (
            value !== marker.attribs["data-chord"] ||
            !chordNotationPattern.test(chord)
          ) {
            valid = false;
            break;
          }
          chords.push(chord);
        }
        const line = chords.join(" ");
        lines.push(line);
        evidence.push(line);
      } else {
        // These pre blocks hold aligned chord rows followed by lyric lines.
        // Reject malformed marked chords so their labels cannot count as lyrics.
        const markers = DomUtils.findAll(() => true, block.children);
        if (
          markers.some((marker) => {
            if (marker.name === "br") return false;
            const value = DomUtils.textContent(marker).trim();
            return (
              marker.name !== "span" ||
              !hasClass(marker, "cifra-chord") ||
              marker.children.some(DomUtils.isTag) ||
              value !== marker.attribs["data-chord"] ||
              !chordNotationPattern.test(
                normalizeChord(value.replace(/º/g, "°"))
              )
            );
          })
        ) {
          valid = false;
          break;
        }
        const line = (await context.sourceBody(block, false, signal)).replace(
          /([A-G][#b]?)º/g,
          "$1°"
        );
        lines.push(line);
        evidence.push(line);
      }
      if (!valid) break;
      const pause = checkpoint();
      if (pause) await pause;
    }
    if (!valid) continue;
    const text = await context.normalizeSourceText(lines.join("\n"), signal);
    // Portuguese section labels are metadata, even when the shared parser
    // does not recognize their wording. They cannot establish lyric evidence.
    const chartText = await context.normalizeSourceText(
      evidence.join("\n"),
      signal
    );
    if (
      !text ||
      text.length > 200000 ||
      !(await hasSongChordsAsync(chartText, signal, true))
    )
      continue;
    const capoLabel = DomUtils.findOne(
      (element) =>
        element.name === "span" && element.attribs["data-capo"] !== undefined,
      document.children
    );
    const capoText = capoLabel ? DomUtils.textContent(capoLabel).trim() : "";
    const capo =
      /^\d{1,2}$/.test(capoText) && Number(capoText) <= 12
        ? Number(capoText)
        : capoText === "sem capo"
          ? 0
          : undefined;
    const content = await transposeSongAsync(text, capo ?? 0, signal);
    if (!(await hasSongChordsAsync(content, signal, true))) continue;
    if (signal?.aborted) throw new Error("Cancelled");
    return [
      {
        id: 0,
        title: foundTitle,
        artist: foundArtist,
        content,
        capo,
        album: "",
        duration: null,
        source: "Sonidos",
        url,
        hasChords: true
      }
    ];
  }
  if (signal?.aborted) throw new Error("Cancelled");
  return [];
}
