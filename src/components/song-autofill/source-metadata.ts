import { sourceArrangement } from "../../screens/song/rhythms";
import {
  chordNotationPattern,
  isChordLine,
  isSectionBoundary
} from "../../screens/song/chords";
import {
  emptyTablature,
  normalizeTablature,
  TAB_TICKS_PER_BEAT,
  TAB_MAX_NOTES,
  type TabNote,
  type TabTechnique
} from "../tablature";

/** Only explicit tempo declarations in the verified arrangement, never page UI. */
export function sourceTempo(text: string): number | undefined {
  const lines = text.normalize("NFKC").split(/\r?\n/);
  const tempos = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].trim();
    if (
      (line.startsWith("{") && line.endsWith("}")) ||
      (line.startsWith("[") && line.endsWith("]"))
    )
      line = line
        .slice(1, -1)
        .trim()
        .replace(/^meta:\s*/i, "");
    const label = line.match(
      /^(?:tempo|bpm|темп|andamento)(?=\s|[:=]|$)\s*[:=]?\s*(.*)$/iu
    );
    const value = label
      ? label[1].trim() || lines[index + 1]?.trim() || ""
      : /^(?:\d+(?:[.,]\d+)?\s*bpm\b|♩\s*=)/iu.test(line)
        ? line
        : undefined;
    if (value === undefined) continue;
    const match = value.match(
      /^(?:♩\s*=\s*)?(\d+(?:[.,]\d+)?)\s*(?:bpm|уд(?:аров)?\.?\s*(?:\/|в)\s*мин(?:уту)?\.?)?$/iu
    );
    const tempo = match ? Number(match[1].replace(",", ".")) : NaN;
    // Do not pick one declaration from a range, unsupported unit or conflict.
    if (!Number.isFinite(tempo) || tempo < 40 || tempo > 200) return;
    tempos.add(Math.round(tempo));
  }
  if (tempos.size === 1) return [...tempos][0];
}

export function sourceMetadata(text: string) {
  const tempo = sourceTempo(text);
  const rhythm = sourceArrangement(text);
  return {
    ...(tempo !== undefined ? { tempo } : {}),
    ...(rhythm ? { rhythm } : {})
  };
}

export function sourceSong(text: string, tempo?: number) {
  const metadata = sourceMetadata(text);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const removed = new Set<number>();
  const notes: TabNote[] = [];
  let tick = 0;
  let firstTab = -1;
  for (let index = 0; index + 5 < lines.length; index++) {
    const rows = lines
      .slice(index, index + 6)
      .map((line) =>
        line
          .replace(/\[([^\]]+)\]/g, (marked, chord: string) =>
            chordNotationPattern.test(chord) ? "" : marked
          )
          .match(/^\s*([eBGDAE]?)\s*\|([\dOoXx\s|:./\\~hp()\-]+)$/i)
      );
    if (rows.some((row) => !row)) continue;
    const labels = rows.map((row) => row![1]).join("");
    if (labels && labels.toUpperCase() !== "EBGDAE") continue;
    const techniques: Record<string, TabTechnique> = {
      h: "hammerOn",
      p: "pullOff",
      "/": "slide",
      "\\": "slide",
      "~": "vibrato"
    };
    const events = rows.flatMap((row, string) => {
      const body = row![2].replace(/\|/g, "");
      const tokens = [...body.matchAll(/\d+|[OoXx]/g)].flatMap((match) =>
        (/^0+$|^([1-9])\1{2,}$/.test(match[0])
          ? [...match[0]]
          : [match[0]]
        ).map((value, offset) => ({ value, column: match.index! + offset }))
      );
      return tokens.map((token, index) => ({
        string: 5 - string,
        fret: /[OoXx]/.test(token.value)
          ? 0
          : token.value.length <= 2
            ? Number(token.value)
            : NaN,
        column: token.column,
        dead: /[Xx]/.test(token.value),
        techniques: [
          body[token.column - 1]?.toLowerCase(),
          body[token.column + token.value.length]
        ].flatMap((symbol) => techniques[symbol] ?? []),
        sourceFret:
          ["/", "\\"].includes(body[token.column - 1]) && index
            ? Number(tokens[index - 1].value)
            : undefined
      }));
    });
    if (
      !events.length ||
      events.some((event) => !Number.isInteger(event.fret) || event.fret > 24)
    )
      continue;
    if (notes.length + events.length > TAB_MAX_NOTES) return { content: text };
    const columns = [...new Set(events.map((event) => event.column))].sort(
      (a, b) => a - b
    );
    const inlineChords = [...lines[index].matchAll(/\[([^\]]+)\]/g)]
      .map((match) => match[1])
      .join(" ");
    const chordRow = (inlineChords || lines[index - 1] || "").replace(
      /\b[a-g](?=\s|$)/g,
      (root) => root.toUpperCase()
    );
    const diagrams =
      !labels &&
      isChordLine(chordRow) &&
      columns.every(
        (column) =>
          events.filter((event) => event.column === column).length >= 4
      );
    if (!diagrams) {
      for (const event of events)
        notes.push({
          string: event.string,
          fret: event.fret,
          tick: tick + (columns.indexOf(event.column) * TAB_TICKS_PER_BEAT) / 2,
          duration: TAB_TICKS_PER_BEAT / 2,
          techniques: event.techniques,
          ...(event.sourceFret !== undefined
            ? { sourceFret: event.sourceFret }
            : {}),
          ...(event.dead ? { accent: "dead" as const } : {})
        });
      tick += Math.ceil(columns.length / 8) * TAB_TICKS_PER_BEAT * 4;
    }
    if (firstTab < 0) firstTab = index;
    for (let row = 0; row < 6; row++) removed.add(index + row);
    index += 5;
  }
  const tablature = notes.length
    ? normalizeTablature({
        ...emptyTablature(tempo ?? metadata.tempo ?? 80),
        notes
      })
    : undefined;
  if (notes.length && !tablature) return { content: text };
  const lyrics =
    firstTab < 0
      ? -1
      : lines.findIndex((line) => /^\s*lyrics\s*:?\s*$/i.test(line));
  const firstSection = firstTab < 0 ? -1 : lines.findIndex(isSectionBoundary);
  const start =
    lyrics >= 0
      ? lyrics + 1
      : firstSection >= 0 && firstSection < firstTab
        ? firstSection
        : 0;
  const changed = start > 0 || removed.size > 0;
  const cleaned = lines
    .filter((_, index) => index >= start && !removed.has(index))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    content: changed ? cleaned : text,
    ...(tablature ? { tablature } : {}),
    ...metadata
  };
}
