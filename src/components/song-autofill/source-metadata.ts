import {
  sourceArrangement,
  type SongArrangement
} from "../../screens/song/rhythms";
import {
  chordNotationPattern,
  isChordLine,
  isSectionBoundary,
  songSections,
  songChordSequence,
  chordShapeOptions,
  transposeChord
} from "../../screens/song/chords";
import {
  emptyTablature,
  normalizeTablature,
  TAB_TICKS_PER_BEAT,
  TAB_MAX_NOTES,
  TAB_TUNING,
  type TabNote,
  type TabTechnique,
  type Tablature,
  tabBarTicks
} from "../tablature";

type SourcePart = {
  notes: TabNote[];
  chords: NonNullable<Tablature["chords"]>;
  length: number;
};

function strummedPart(
  words: string,
  definition: SongArrangement["parts"][string]
) {
  const family = (name: string) => name.replace(/5\(9\)|add9|sus2|6|9/g, "");
  const cues: SourcePart["chords"] = [];
  const changes: SourcePart["chords"] = [];
  const hits: { tick: number; chord: string; pick: "downBrush" | "upBrush" }[] =
    [];
  let length = 0;
  for (const [chord, pattern] of definition) {
    changes.push({ name: chord, tick: length });
    for (const [step, symbol] of [...pattern].entries())
      if (["D", "U"].includes(symbol))
        hits.push({
          tick: length + (step * TAB_TICKS_PER_BEAT) / 4,
          chord,
          pick: symbol === "D" ? "downBrush" : "upBrush"
        });
    length += (pattern.length * TAB_TICKS_PER_BEAT) / 4;
  }
  let cursor = 0;
  for (const chord of songChordSequence(words)) {
    const index = changes.findIndex(
      (change, index) =>
        index >= cursor && family(change.name) === family(chord)
    );
    if (index < 0) return;
    cues.push({ name: chord, tick: changes[index].tick });
    cursor = index + 1;
  }
  if (!cues.length || cursor !== changes.length) return;
  const notes = hits.flatMap((hit, index) => {
    const duration = (hits[index + 1]?.tick ?? length) - hit.tick;
    return (
      chordShapeOptions(hit.chord)[0]?.frets.flatMap((fret, string) =>
        fret === null
          ? []
          : [{ string, fret, tick: hit.tick, duration, pick: hit.pick }]
      ) ?? []
    );
  });
  return { notes, chords: cues, length };
}
const partNames: Record<string, string> = {
  intro: "intro",
  вступление: "intro",
  вступ: "intro",
  интро: "intro",
  інтро: "intro",
  verse: "verse",
  verso: "verse",
  estrofe: "verse",
  куплет: "verse",
  chorus: "chorus",
  refrain: "chorus",
  refrão: "chorus",
  refrao: "chorus",
  припев: "chorus",
  приспів: "chorus",
  outro: "outro",
  final: "outro",
  coda: "outro",
  кода: "outro",
  bridge: "bridge",
  ponte: "bridge",
  interlude: "bridge",
  instrumental: "bridge",
  бридж: "bridge",
  брідж: "bridge",
  проигрыш: "bridge"
};
export function sourcePartKey(title: string) {
  const words = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\[\]{}:]/g, "")
    .trim();
  if (/^dedilhado\s+das?\s+estrofes?/.test(words)) return "verse";
  const match = words.match(/^(\p{L}+)(?:\s+(\d+))?/u);
  const name = match && partNames[match[1]];
  return name ? name + (match?.[2] ? `:${match[2]}` : "") : "";
}

function arrangeSource(
  content: string,
  parts: Map<string, SourcePart>,
  tempo: number,
  otherVersesIntro: boolean,
  lyricsOnly: boolean,
  arrangement?: SongArrangement
) {
  const barTicks = tabBarTicks(emptyTablature(tempo));
  const sectionPart = (title: string) => {
    const key = sourcePartKey(title),
      kind = key.split(":")[0];
    return (
      parts.get(key) ??
      (kind === "verse" && otherVersesIntro && key !== "verse:1"
        ? parts.get("intro")
        : undefined) ??
      parts.get(kind) ??
      (kind === "verse"
        ? (parts.get("verse:1") ?? parts.get("intro"))
        : undefined)
    );
  };
  const fragments = (part: SourcePart) =>
    new Map(
      part.chords.map((chord, index) => {
        const end = part.chords[index + 1]?.tick ?? part.length;
        return [
          chord.name,
          {
            length: end - chord.tick,
            notes: part.notes
              .filter((note) => note.tick >= chord.tick && note.tick < end)
              .map((note) => ({ ...note, tick: note.tick - chord.tick }))
          }
        ] as const;
      })
    );
  const allFragments = new Map(
    [...parts.values()].flatMap((part) => [...fragments(part)])
  );
  let sections = songSections(content);
  if (lyricsOnly) {
    sections = [];
    let verse = 0;
    let chorus: (typeof sections)[number] | undefined;
    for (const paragraph of content
      .split(/\n\s*\n/)
      .filter((part) => part.trim())) {
      for (const parsed of songSections(paragraph).filter(
        (part) => part.title || part.content.trim()
      )) {
        const section = { ...parsed };
        if (!section.title)
          section.title =
            /\(\s*[x×]\s*\d+\s*\)/i.test(section.content) &&
            section.content.trim().split("\n").length === 1
              ? "Interlude"
              : `Verse ${++verse}`;
        if (sourcePartKey(section.title) === "chorus") {
          if (!section.content.trim() && chorus)
            section.content = chorus.content;
          if (section.content.trim()) chorus = section;
        }
        sections.push(section);
      }
    }
    if (parts.has("intro"))
      sections.unshift({ id: "intro", title: "Intro", content: "" });
  }
  const notes: TabNote[] = [];
  const chords: NonNullable<Tablature["chords"]> = [];
  let tick = 0;
  const output: string[] = [];
  let arranged = false;
  for (const section of sections) {
    const definition =
      arrangement?.parts[sourcePartKey(section.title).split(":")[0]];
    const strummed = definition && strummedPart(section.content, definition);
    const part = strummed ?? sectionPart(section.title);
    let words = section.content.trim();
    const fromTab = !songChordSequence(words).length && !!part?.chords.length;
    if (fromTab && part) {
      const labels = part.chords.map((chord) => chord.name);
      const rows = words.split("\n");
      const lyricRows = rows.flatMap((line, index) =>
        line.trim() ? [index] : []
      );
      if (!lyricRows.length) words = labels.join("  ");
      else {
        const additions = new Map<number, string[]>();
        labels.forEach((label, index) => {
          const row =
            lyricRows[Math.floor((index * lyricRows.length) / labels.length)];
          additions.set(row, [...(additions.get(row) ?? []), label]);
        });
        words = rows
          .map((line, index) => {
            const labels = additions.get(index) ?? [];
            for (let position = labels.length - 1; position >= 0; position--) {
              const at = Math.floor((position * line.length) / labels.length);
              line =
                line.slice(0, at) + `[${labels[position]}]` + line.slice(at);
            }
            return line;
          })
          .join("\n");
      }
    }
    if (section.title) output.push(`[${section.title}]`);
    output.push(words, "");
    if ((fromTab || strummed) && part) {
      arranged ||= !!strummed;
      notes.push(
        ...part.notes.map((note) => ({ ...note, tick: tick + note.tick }))
      );
      chords.push(
        ...part.chords.map((chord) => ({ ...chord, tick: tick + chord.tick }))
      );
      tick += part.length;
      continue;
    }
    const own = part && fragments(part);
    for (const chord of songChordSequence(words)) {
      const pattern = own?.get(chord) ?? allFragments.get(chord);
      const frets = pattern ? undefined : chordShapeOptions(chord)[0]?.frets;
      if (!pattern && !frets) return undefined;
      chords.push({ tick, name: chord });
      notes.push(
        ...(
          pattern?.notes ??
          frets!.flatMap((fret, string) =>
            fret === null ? [] : [{ string, fret, tick: 0, duration: barTicks }]
          )
        ).map((note) => ({ ...note, tick: tick + note.tick }))
      );
      tick += pattern?.length ?? barTicks;
    }
  }
  if (!chords.length || notes.length > TAB_MAX_NOTES) return undefined;
  const tablature = normalizeTablature({
    ...emptyTablature(tempo),
    notes,
    chords,
    ...(arranged ? { arrangementSource: arrangement?.source } : {}),
    barCount: Math.ceil(tick / barTicks)
  });
  return tablature
    ? {
        content: output
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
        tablature
      }
    : undefined;
}

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

export function sourceSong(
  text: string,
  tempo?: number,
  expand = true,
  arrangement?: SongArrangement
) {
  const metadata = sourceMetadata(text);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const removed = new Set<number>();
  const notes: TabNote[] = [];
  const parts = new Map<string, SourcePart>();
  let scope = "";
  const candidateNames = [
    ...new Set([
      ...songChordSequence(text),
      ...["C", "D", "E", "F", "G", "A", "B"].flatMap((root) =>
        ["", "m", "sus2", "sus4", "6", "add9"].map((suffix) => root + suffix)
      )
    ])
  ];
  const shapes = candidateNames.flatMap((name) =>
    chordShapeOptions(name).map((shape) => ({ name, ...shape }))
  );
  const inferChord = (values: TabNote[], previous?: string) => {
    if (values.length < 3) return;
    const first = [...values].sort(
      (a, b) => a.tick - b.tick || a.string - b.string
    )[0];
    const root = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B"
    ][(TAB_TUNING[first.string] + first.fret) % 12];
    const matches = shapes.filter((shape) =>
      values.every(
        (note) =>
          shape.frets[note.string] === note.fret ||
          (shape.frets[note.string] === null &&
            note.fret === 0 &&
            note.string < shape.frets.findIndex((fret) => fret !== null) &&
            shape.frets.some(
              (fret, string) =>
                fret !== null &&
                (TAB_TUNING[string] + fret) % 12 ===
                  TAB_TUNING[note.string] % 12
            ))
      )
    );
    return (
      matches.find((shape) => shape.name === previous)?.name ??
      matches
        .filter((shape) => shape.name.match(/^[A-G](?:#|b)?/)?.[0] === root)
        .sort(
          (a, b) =>
            a.position - b.position ||
            candidateNames.indexOf(a.name) - candidateNames.indexOf(b.name)
        )[0]?.name
    );
  };
  let tick = 0;
  let firstTab = -1;
  for (let index = 0; index + 5 < lines.length; index++) {
    const named =
      songSections(lines[index]).find((section) => section.title)?.title ??
      lines[index];
    const key = sourcePartKey(named);
    if (key) scope = key;
    if (/^\s*dedilhado\s+das?\s+estrofes?/i.test(lines[index]))
      removed.add(index);
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
    const part: SourcePart = parts.get(scope) ?? {
      notes: [],
      chords: [],
      length: 0
    };
    const blockStart = part.length;
    const barTicks = TAB_TICKS_PER_BEAT * 4;
    const blockNotes: TabNote[] = events.map((event) => ({
      string: event.string,
      fret: event.fret,
      tick:
        columns.indexOf(event.column) *
        (diagrams ? barTicks : TAB_TICKS_PER_BEAT / 2),
      duration: diagrams ? barTicks : TAB_TICKS_PER_BEAT / 2,
      techniques: event.techniques,
      ...(event.sourceFret !== undefined
        ? { sourceFret: event.sourceFret }
        : {}),
      ...(event.dead ? { accent: "dead" as const } : {})
    }));
    const blockLength = diagrams
      ? columns.length * barTicks
      : Math.ceil(columns.length / 8) * barTicks;
    const blockChords: NonNullable<Tablature["chords"]> = [];
    if (diagrams)
      songChordSequence(chordRow).forEach((name, index) =>
        blockChords.push({ name, tick: index * barTicks })
      );
    else {
      let removedWidth = 0;
      const firstRow = lines[index];
      for (const match of firstRow.matchAll(/\[([^\]]+)\]/g)) {
        if (!chordNotationPattern.test(match[1])) continue;
        const column = match.index - removedWidth - firstRow.indexOf("|") - 1;
        const at = columns.findIndex((at) => at >= column);
        blockChords.push({
          name: transposeChord(match[1], 0),
          tick: (Math.max(0, at) * TAB_TICKS_PER_BEAT) / 2
        });
        removedWidth += match[0].length;
      }
      if (!blockChords.length) {
        const onsets = [...new Set(blockNotes.map((note) => note.tick))].sort(
          (a, b) => a - b
        );
        for (let index = 0; index < onsets.length; index++) {
          const at = onsets[index];
          if (!blockNotes.some((note) => note.tick === at && note.string <= 2))
            continue;
          const name = inferChord(
            blockNotes.filter(
              (note) =>
                note.tick >= at &&
                note.tick < (onsets[index + 5] ?? blockLength)
            ),
            blockChords.at(-1)?.name
          );
          const previous = blockChords.at(-1);
          if (name && previous?.name !== name) {
            if (
              previous &&
              at - previous.tick < barTicks &&
              name.match(/^[A-G](?:#|b)?/)?.[0] ===
                previous.name.match(/^[A-G](?:#|b)?/)?.[0]
            )
              previous.name = name;
            else blockChords.push({ name, tick: at });
          }
        }
      }
    }
    part.notes.push(
      ...blockNotes.map((note) => ({ ...note, tick: note.tick + blockStart }))
    );
    part.chords.push(
      ...blockChords.map((chord) => ({
        ...chord,
        tick: chord.tick + blockStart
      }))
    );
    part.length += blockLength;
    parts.set(scope, part);
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
  const arranged =
    expand && (parts.size || arrangement)
      ? arrangeSource(
          cleaned,
          parts,
          tempo ?? metadata.tempo ?? arrangement?.tempo ?? 80,
          /all\s+other\s+verses\s+are\s+like\s+(?:the\s+)?intro/i.test(text),
          lyrics >= 0,
          arrangement
        )
      : undefined;
  const content = arranged?.content ?? (changed ? cleaned : text);
  return {
    content,
    ...(arranged || tablature
      ? {
          tablature: {
            ...(arranged?.tablature ?? tablature!),
            sourceText: text
          }
        }
      : {}),
    ...metadata,
    ...(arranged?.tablature.arrangementSource
      ? { tempo: tempo ?? metadata.tempo ?? arrangement?.tempo }
      : {})
  };
}
