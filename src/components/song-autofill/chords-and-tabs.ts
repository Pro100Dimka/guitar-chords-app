import { DomUtils } from "htmlparser2";
import {
  chordNotationPattern,
  hasSongChordsAsync,
  transposeSongAsync
} from "../../screens/song/chords";
import { sourceMetadata } from "./source-metadata";
import type { ChordProviderContext } from "./chord-provider-context";
import type { LyricsOption } from "./lyrics";

const origin = "https://www.chords-and-tabs.net";
const hasClass = (
  element: Parameters<typeof DomUtils.getChildren>[0],
  name: string
) =>
  DomUtils.isTag(element) &&
  (element.attribs.class ?? "").split(/\s+/).includes(name);

export async function lookupChordsAndTabs(
  title: string,
  artist: string,
  signal: AbortSignal | undefined,
  context: ChordProviderContext
): Promise<LyricsOption[]> {
  const {
    fetchSource,
    parseSource,
    normalizeSourceText,
    sourceWork,
    matchingIdentity,
    sameArtist,
    trackTitle,
    primaryArtist
  } = context;
  const checkpoint = sourceWork(signal);
  const paths = new Set<string>();
  for (const query of new Set([
    `${primaryArtist(artist)} ${trackTitle(title)}`,
    trackTitle(title)
  ])) {
    const html = await fetchSource(
      `${origin}/songs/search/`,
      signal,
      12000,
      new URLSearchParams({ search: query })
    );
    if (!html) return [];
    const document = await parseSource(html, signal);
    for (const link of DomUtils.getElementsByTagName("a", document.children)) {
      const path = link.attribs.href ?? "";
      if (
        path.length <= 500 &&
        /^\/song\/name\/[\p{L}\p{N}-]+$/u.test(path) &&
        DomUtils.findOne(
          (element) => hasClass(element, "typechords"),
          link.children
        )
      ) {
        const label = DomUtils.getElementsByTagName("b", link.children)[0];
        const value = label ? DomUtils.textContent(label).trim() : "";
        // Both identities must match; a separator inside a name is not an
        // invitation to accept an unrelated performer or a partial title.
        for (const match of value.matchAll(/\s+-\s+/g)) {
          if (
            sameArtist(artist, value.slice(0, match.index)) &&
            matchingIdentity(title, value.slice(match.index! + match[0].length))
          ) {
            paths.add(path);
            break;
          }
        }
      }
      if (paths.size === 3) break;
      const pause = checkpoint();
      if (pause) await pause;
    }
    if (paths.size) break;
  }
  for (const path of paths) {
    const url = new URL(path, origin).href;
    const html = await fetchSource(url, signal);
    if (!html) continue;
    const document = await parseSource(html, signal);
    let foundTitle = "",
      foundArtist = "";
    for (const script of DomUtils.getElementsByTagName(
      "script",
      document.children
    )) {
      if (script.attribs.type !== "application/ld+json") continue;
      try {
        const recording = JSON.parse(DomUtils.textContent(script));
        if (
          recording?.["@type"] === "MusicRecording" &&
          typeof recording.name === "string" &&
          typeof recording.byArtist?.name === "string" &&
          matchingIdentity(title, recording.name) &&
          sameArtist(artist, recording.byArtist.name)
        ) {
          foundTitle = recording.name;
          foundArtist = recording.byArtist.name;
          break;
        }
      } catch {
        // Other page metadata must not establish an arrangement's identity.
      }
    }
    const heading = DomUtils.getElementsByTagName("h1", document.children)[0];
    const performer =
      heading &&
      DomUtils.getElementsByTagName("a", heading.children).find((element) =>
        /^\/songs\/by\/[\p{L}\p{N}-]+$/u.test(element.attribs.href ?? "")
      );
    const name = heading?.children.find(
      (element) =>
        DomUtils.isTag(element) && element.attribs.itemprop === "name"
    );
    if (
      !foundTitle ||
      !foundArtist ||
      !performer ||
      !name ||
      !sameArtist(artist, DomUtils.textContent(performer)) ||
      !matchingIdentity(title, DomUtils.textContent(name))
    )
      continue;
    const body = DomUtils.findOne(
      (element) =>
        element.attribs.id === "snippet--snippetXteView" &&
        hasClass(element, "xte-view"),
      document.children
    );
    if (!body) continue;

    // The dedicated chart includes unchorded lyric lines and section names
    // between .song blocks. Preserve those too, while excluding page controls.
    const parts: string[] = [];
    let invalidChord = false;
    const stack = [{ nodes: body.children, index: 0, block: false }];
    while (stack.length && !invalidChord) {
      const current = stack[stack.length - 1];
      if (current.index === current.nodes.length) {
        if (current.block) parts.push("\n");
        stack.pop();
      } else {
        const node = current.nodes[current.index++];
        if (DomUtils.isText(node)) parts.push(node.data);
        else if (DomUtils.isTag(node)) {
          if (node.name === "sup") {
            const chord = DomUtils.textContent(node).trim();
            if (
              node.children.some((child) => !DomUtils.isText(child)) ||
              !chordNotationPattern.test(chord)
            )
              invalidChord = true;
            else parts.push(`[${chord}]`);
          } else if (node.name === "br") parts.push("\n");
          else if (
            ["div", "span", "b", "i", "strong", "em", "pre"].includes(node.name)
          ) {
            const block = ["div", "pre"].includes(node.name);
            if (block) parts.push("\n");
            stack.push({ nodes: node.children, index: 0, block });
          }
        }
      }
      const pause = checkpoint();
      if (pause) await pause;
    }
    if (invalidChord) continue;
    const text = await normalizeSourceText(parts.join(""), signal);
    if (!text || text.length > 200000) continue;
    const badges = DomUtils.findAll(
      (element) => hasClass(element, "x-badge"),
      document.children
    ).map((element) => DomUtils.textContent(element).trim());
    const capoLabel = badges.find((label) => /^Capo:/i.test(label));
    const capoMatch = capoLabel?.match(/^Capo:\s*(\d{1,2})\s*$/i);
    if (capoLabel && (!capoMatch || Number(capoMatch[1]) > 12)) continue;
    const capo = Number(capoMatch?.[1] ?? 0);
    const tuning =
      badges
        .find((label) => /^Tuning:/i.test(label))
        ?.replace(/^Tuning:\s*/i, "") || undefined;
    const content = await transposeSongAsync(text, capo, signal);
    if (!(await hasSongChordsAsync(content, signal, true))) continue;
    if (signal?.aborted) throw new Error("Cancelled");
    return [
      {
        id: 0,
        title: foundTitle,
        artist: foundArtist,
        content,
        capo,
        tuning,
        ...sourceMetadata(text),
        album: "",
        duration: null,
        source: "Chords & Tabs",
        url,
        hasChords: true
      }
    ];
  }
  if (signal?.aborted) throw new Error("Cancelled");
  return [];
}
