import { sourceArrangement } from "../../screens/song/rhythms";
import {
  isChordLine,
  isSectionBoundary,
  playingInstruction
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
        line.match(/^\s*([eBGDAE]?)\s*\|([\dOoXx\s|:./\\~hp()\-]+)$/i)
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
      return [...body.matchAll(/\d{1,2}|[OoXx]/g)].map(
        (match, index, matches) => ({
          string: 5 - string,
          fret: /[OoXx]/.test(match[0]) ? 0 : Number(match[0]),
          column: match.index!,
          dead: /[Xx]/.test(match[0]),
          techniques: [
            body[match.index! - 1]?.toLowerCase(),
            body[match.index! + match[0].length]
          ].flatMap((symbol) => techniques[symbol] ?? []),
          sourceFret:
            ["/", "\\"].includes(body[match.index! - 1]) && index
              ? Number(matches[index - 1][0])
              : undefined
        })
      );
    });
    if (!events.length || events.some((event) => event.fret > 24)) continue;
    if (notes.length + events.length > TAB_MAX_NOTES) return { content: text };
    const columns = [...new Set(events.map((event) => event.column))].sort(
      (a, b) => a - b
    );
    const chordRow = (lines[index - 1] ?? "").replace(
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
  let instruction: Parameters<typeof playingInstruction>[1];
  let changed = start > 0 || removed.size > 0;
  const cleaned = lines
    .flatMap((line, index) => {
      if (index < start || removed.has(index)) return [];
      const playing = playingInstruction(line, instruction);
      instruction = playing.next;
      if (playing.metadata) changed = true;
      return playing.metadata ? [] : [line];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    content: changed ? cleaned : text,
    ...(tablature ? { tablature } : {}),
    ...metadata
  };
}
