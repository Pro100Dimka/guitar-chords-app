const sharpNotes = [
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
];
const flatNotes = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B"
];
const roots: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};
const accidentals: Record<string, number> = { "#": 1, b: -1 };
export const chordNotationPattern =
  /^(?=.{1,64}$)([A-G])([#b]?)((?:(?:maj|Maj|min|dim|aug|sus|add|omit|no|m|M|Δ|ø|°|\+|-|[\d#b])|\((?:maj\d+|M\d+|[\d#b,+-]+)\))*(?:\/\d+)*)(?:\/([A-G])([#b]?))?$/;
export function transposeChord(chord: string, semitones: number) {
  chord = normalizeChord(chord);
  if (!chordNotationPattern.test(chord) || semitones === 0) return chord;
  const parsed = chord.match(chordNotationPattern)!;
  const notes = [parsed[2], parsed[5]].includes("b") ? flatNotes : sharpNotes;
  return chord.replace(
    /(^|\/)([A-G])([#b]?)/g,
    (_, prefix: string, root: string, accidental: string) => {
      const pitch = roots[root] + (accidentals[accidental] ?? 0);
      return prefix + notes[(((pitch + semitones) % 12) + 12) % 12];
    }
  );
}
export type Frets = (number | null)[];
const openShapes: Record<string, Frets> = {
  C: [null, 3, 2, 0, 1, 0],
  Cmaj7: [null, 3, 2, 0, 0, 0],
  Cadd9: [null, 3, 2, 0, 3, 3],
  D: [null, null, 0, 2, 3, 2],
  Dm: [null, null, 0, 2, 3, 1],
  D7: [null, null, 0, 2, 1, 2],
  Dsus2: [null, null, 0, 2, 3, 0],
  Dsus4: [null, null, 0, 2, 3, 3],
  G: [3, 2, 0, 0, 0, 3],
  G7: [3, 2, 0, 0, 0, 1],
  Am: [null, 0, 2, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0]
};
const movable: Record<string, { root: number; frets: Frets }[]> = {
  "": [
    { root: 4, frets: [0, 2, 2, 1, 0, 0] },
    { root: 9, frets: [null, 0, 2, 2, 2, 0] }
  ],
  m: [
    { root: 4, frets: [0, 2, 2, 0, 0, 0] },
    { root: 9, frets: [null, 0, 2, 2, 1, 0] }
  ],
  "7": [
    { root: 4, frets: [0, 2, 0, 1, 0, 0] },
    { root: 9, frets: [null, 0, 2, 0, 2, 0] }
  ],
  m7: [
    { root: 4, frets: [0, 2, 0, 0, 0, 0] },
    { root: 9, frets: [null, 0, 2, 0, 1, 0] }
  ],
  maj7: [
    { root: 4, frets: [0, 2, 1, 1, 0, 0] },
    { root: 9, frets: [null, 0, 2, 1, 2, 0] }
  ],
  sus2: [{ root: 9, frets: [null, 0, 2, 2, 0, 0] }],
  sus4: [
    { root: 4, frets: [0, 2, 2, 2, 0, 0] },
    { root: 9, frets: [null, 0, 2, 2, 3, 0] }
  ],
  "5": [
    { root: 4, frets: [0, 2, 2, null, null, null] },
    { root: 9, frets: [null, 0, 2, 2, null, null] }
  ]
};
// Compact movable voicings. String order is E A D G B e.
const extensions: typeof movable = {
  "6": [
    { root: 9, frets: [null, 0, 2, 2, 2, 2] },
    { root: 4, frets: [0, null, 2, 1, 2, 0] }
  ],
  m6: [
    { root: 9, frets: [null, 0, 2, 2, 1, 2] },
    { root: 4, frets: [0, null, 2, 0, 2, 0] }
  ],
  add9: [{ root: 0, frets: [null, 3, 2, 0, 3, 0] }],
  madd9: [{ root: 9, frets: [null, 0, 2, 4, 1, 0] }],
  dim: [{ root: 9, frets: [null, 0, 1, 2, 1, null] }],
  dim7: [
    { root: 9, frets: [null, 0, 1, 2, 1, 2] },
    { root: 4, frets: [0, null, 2, 3, 2, 3] }
  ],
  m7b5: [
    { root: 9, frets: [null, 0, 1, 0, 1, null] },
    { root: 4, frets: [0, 1, 0, 0, 3, null] }
  ],
  aug: [{ root: 9, frets: [null, 0, 3, 2, 2, 1] }],
  "9": [{ root: 0, frets: [null, 3, 2, 3, 3, 3] }],
  m9: [{ root: 9, frets: [null, 0, 2, 4, 1, 3] }],
  maj9: [{ root: 0, frets: [null, 3, 2, 4, 3, null] }],
  mMaj7: [{ root: 9, frets: [null, 0, 2, 1, 1, 0] }],
  "7sus4": [{ root: 9, frets: [null, 0, 2, 0, 3, 0] }],
  "7b5": [{ root: 0, frets: [null, 3, 4, 3, 5, null] }],
  "7#5": [{ root: 9, frets: [null, 0, 3, 0, 2, 1] }],
  "7b9": [{ root: 0, frets: [null, 3, 2, 3, 2, null] }],
  "7#9": [{ root: 4, frets: [null, 7, 6, 7, 8, null] }],
  "13": [{ root: 5, frets: [1, null, 1, 2, 3, 3] }],
  m11: [{ root: 9, frets: [null, 0, 0, 0, 1, 0] }]
};
const extraOpenShapes: Record<string, Frets[]> = {
  A: [[null, 0, 2, 2, 2, 0]],
  A7: [[null, 0, 2, 0, 2, 0]],
  Am7: [[null, 0, 2, 0, 1, 0]],
  C7: [[null, 3, 2, 3, 1, 0]],
  Dmaj7: [[null, null, 0, 2, 2, 2]],
  Dm7: [[null, null, 0, 2, 1, 1]],
  E: [[0, 2, 2, 1, 0, 0]],
  E7: [[0, 2, 0, 1, 0, 0]],
  Em7: [[0, 2, 2, 0, 3, 0]],
  F: [[null, null, 3, 2, 1, 1]],
  Fmaj7: [[null, null, 3, 2, 1, 0]],
  G: [[3, 2, 0, 0, 3, 3]],
  Gmaj7: [[3, 2, 0, 0, 0, 2]],
  Asus2: [[null, 0, 2, 2, 0, 0]],
  Asus4: [[null, 0, 2, 2, 3, 0]]
};
const inversions: Record<string, Frets[]> = {
  "C/G": [[3, 3, 2, 0, 1, 0]],
  "C/E": [[0, 3, 2, 0, 1, 0]],
  "D/F#": [[2, 0, 0, 2, 3, 2]],
  "D/A": [[null, 0, 0, 2, 3, 2]],
  "Dm/F": [[1, 0, 0, 2, 3, 1]],
  "G/B": [[null, 2, 0, 0, 0, 3]],
  "Am/G": [[3, 0, 2, 2, 1, 0]],
  "Am/C": [[null, 3, 2, 2, 1, 0]],
  "E/G#": [[4, 2, 2, 1, 0, 0]],
  "Em/G": [[3, 2, 2, 0, 0, 0]],
  "F/C": [[null, 3, 3, 2, 1, 1]],
  "G/D": [[null, null, 0, 0, 0, 3]]
};
const aliases: Record<string, string> = {
  min: "m",
  maj: "",
  M: "",
  M7: "maj7",
  M9: "maj9",
  min7: "m7",
  min9: "m9",
  "m(maj7)": "mMaj7",
  ø7: "m7b5",
  "°": "dim",
  "°7": "dim7",
  "+": "aug"
};
const voicings = { ...movable, ...extensions };
const suffixes = [...Object.keys(voicings), ...Object.keys(aliases)]
  .sort((a, b) => b.length - a.length)
  .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
export const chordPattern = new RegExp(
  `^([A-G])([#b]?)(${suffixes.join("|")})(?:/([A-G])([#b]?))?$`
);

const chordIntervals: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "5": [0, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 2, 4, 7],
  madd9: [0, 2, 3, 7],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  "9": [0, 2, 4, 7, 10],
  m9: [0, 2, 3, 7, 10],
  maj9: [0, 2, 4, 7, 11],
  mMaj7: [0, 3, 7, 11],
  "7sus4": [0, 5, 7, 10],
  "7b5": [0, 4, 6, 10],
  "7#5": [0, 4, 8, 10],
  "7b9": [0, 1, 4, 7, 10],
  "7#9": [0, 3, 4, 7, 10],
  "13": [0, 2, 4, 7, 9, 10],
  m11: [0, 2, 3, 5, 7, 10]
};
const shapeCache = new Map<string, Frets[]>();
export const guitarMidi = [40, 45, 50, 55, 59, 64];
function additionalShapes(
  root: number,
  quality: string,
  bass: number | undefined
): Frets[] {
  const tones = (chordIntervals[quality] ?? []).map(
    (interval) => (root + interval) % 12
  );
  if (!tones.length) return [];
  const allowed = [
    ...new Set([...tones, ...(bass === undefined ? [] : [bass])])
  ];
  const required =
    tones.length > 4 ? tones.filter((tone) => tone !== (root + 7) % 12) : tones;
  const result: Frets[] = [];
  const seen = new Set<string>();
  for (let position = 1; position <= 12; position++) {
    const choices = guitarMidi.map((open) =>
      [0, ...Array.from({ length: 4 }, (_, i) => position + i)].filter((fret) =>
        allowed.includes((open + fret) % 12)
      )
    );
    for (let first = 0; first <= 3; first++)
      for (let last = first + 2; last < 6; last++) {
        const frets: Frets = Array(6).fill(null);
        const visit = (string: number) => {
          if (string > last) {
            const pressed = frets.filter(
              (fret): fret is number => fret !== null && fret > 0
            );
            const minimum = Math.min(...pressed);
            const barre = frets
              .map((fret, i) => (fret === minimum ? i : -1))
              .filter((i) => i >= 0);
            const canBarre =
              barre.length > 1 &&
              !frets.slice(barre[0], barre[barre.length - 1] + 1).includes(0);
            if (pressed.length - (canBarre ? barre.length - 1 : 0) > 4) return;
            const pitches = frets.flatMap((fret, i) =>
              fret === null ? [] : [guitarMidi[i] + fret]
            );
            if (
              !required.every((tone) =>
                pitches.some((pitch) => pitch % 12 === tone)
              )
            )
              return;
            if (bass !== undefined && Math.min(...pitches) % 12 !== bass)
              return;
            const key = String(frets);
            if (!seen.has(key)) {
              seen.add(key);
              result.push([...frets]);
            }
            return;
          }
          for (const fret of choices[string]) {
            frets[string] = fret;
            visit(string + 1);
          }
          frets[string] = null;
        };
        visit(first);
      }
  }
  const perPosition = new Map<number, number>();
  return result
    .sort(
      (a, b) =>
        b.filter((fret) => fret !== null).length -
        a.filter((fret) => fret !== null).length
    )
    .filter((frets) => {
      const position = Math.max(...frets.map((fret) => fret ?? 0));
      const count = perPosition.get(position) ?? 0;
      perPosition.set(position, count + 1);
      return count < 8;
    });
}

export function chordShapes(chord: string): Frets[] {
  const cached = shapeCache.get(chord);
  if (cached) return cached;
  const match = chord.match(chordPattern);
  if (!match) return [];
  const pitch = (roots[match[1]] + (accidentals[match[2]] ?? 0) + 12) % 12;
  const quality = aliases[match[3]] ?? match[3];
  const canonical = sharpNotes[pitch] + quality;
  let shapes = (voicings[quality] ?? []).map(({ root, frets }) => {
    const offset = (((pitch - root) % 12) + 12) % 12;
    return frets.map((fret) => (fret === null ? null : fret + offset));
  });
  // Keep existing indices stable for saved per-song choices.
  if (openShapes[chord]) shapes.unshift(openShapes[chord]);
  shapes.push(...(extraOpenShapes[canonical] ?? []));
  if (match[4]) {
    const bass = (roots[match[4]] + (accidentals[match[5]] ?? 0) + 12) % 12;
    const key = `${canonical}/${sharpNotes[bass]}`;
    shapes = [
      ...(inversions[key] ?? []),
      ...shapes.filter((frets) => {
        const index = frets.findIndex((fret) => fret !== null);
        return (
          index >= 0 &&
          ([4, 9, 2, 7, 11, 4][index] + (frets[index] ?? 0)) % 12 === bass
        );
      })
    ];
  }
  const bass = match[4]
    ? (roots[match[4]] + (accidentals[match[5]] ?? 0) + 12) % 12
    : undefined;
  shapes.push(...additionalShapes(pitch, quality, bass));
  const seen = new Set<string>();
  const result = shapes.filter((shape) => {
    const key = String(shape);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (shapeCache.size >= 256)
    shapeCache.delete(shapeCache.keys().next().value!);
  shapeCache.set(chord, result);
  return result;
}

export function normalizeChord(chord: string) {
  return chord.replace(
    /^([A-G][#b]?)(4|2|7\(4\)|7\(9\)|m7\(b5\))(?=\/|$)/,
    (_, root: string, quality: string) =>
      root +
      ({
        "4": "sus4",
        "2": "sus2",
        "7(4)": "7sus4",
        "7(9)": "9",
        "m7(b5)": "m7b5"
      }[quality] ?? quality)
  );
}
export function chordLineParts(line: string, semitones = 0) {
  return line
    .split(/(\s+|[|:]+)/)
    .filter(Boolean)
    .map((part) => transposeChord(part, semitones));
}
function reflowChordPairs(content: string, semitones: number) {
  const lines = content.split("\n");
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      lyrics = lines[i + 1];
    if (!isChordLine(line)) {
      output.push(line);
      continue;
    }
    const anchors = chordRowAnchors(line);
    if (!anchors || !lyrics?.trim() || isChordLine(lyrics)) {
      output.push(chordLineParts(line, semitones).join(""));
      continue;
    }
    const words = [...lyrics];
    let chords = line.slice(0, anchors[0].index);
    let text =
      words.slice(0, anchors[0].index).join("") +
      " ".repeat(Math.max(0, anchors[0].index - words.length));
    for (let j = 0; j < anchors.length; j++) {
      const current = anchors[j],
        next = anchors[j + 1];
      const chord = transposeChord(current[0], semitones);
      const part = words.slice(current.index, next?.index).join("");
      if (!next) {
        chords += chord + line.slice(current.index + current[0].length);
        text += part;
        continue;
      }
      const originalGap = line.slice(
        current.index + current[0].length,
        next.index
      );
      const gap = originalGap.trim() ? originalGap.replace(/ +/g, " ") : " ";
      const phrase = part.replace(/\s+$/, " ");
      const width = Math.max([...phrase].length, chord.length + gap.length);
      chords += (chord + gap).padEnd(width);
      text += phrase + " ".repeat(width - [...phrase].length);
    }
    output.push(chords.trimEnd(), text.trimEnd());
    i++;
  }
  return output.join("\n");
}

const sectionPattern =
  /\[(?:intro|verse|chorus|bridge|outro|solo|interlude|instrumental|приспів|куплет|припев)[^\[\]]*\]/gi;
function chordTokens(line: string) {
  return chordLineParts(line.replace(sectionPattern, " ")).filter(
    (token) =>
      !/^(?:\s+|[|:]+|[-()[\]]+|\(?[xх×]\d+\)?|\(?\d+[xх×]\)?)$/i.test(token)
  );
}
function sectionChordRows(content: string) {
  return content.split(/\r?\n/).flatMap((line) => {
    const sections = line.match(sectionPattern);
    return sections && isChordLine(line)
      ? [...sections, line.replace(sectionPattern, "").trimStart()]
      : [line];
  });
}

function chordRowAnchors(line: string) {
  if (!isChordLine(line)) return undefined;
  const tokens = [...line.matchAll(/[^\s]+/g)];
  if (
    tokens.some((match) => !chordNotationPattern.test(normalizeChord(match[0])))
  )
    return undefined;
  return tokens;
}

type AnchoredLine = {
  lyrics: string;
  anchors: { chord: string; column: number }[];
};
function inlineChordLine(line: string): AnchoredLine | undefined {
  let lyrics = "",
    previous = 0,
    column = 0;
  const anchors: AnchoredLine["anchors"] = [];
  for (const match of line.matchAll(/\[([^\[\]]+)\]/g)) {
    const chord = normalizeChord(match[1]);
    if (!chordNotationPattern.test(chord)) continue;
    const part = line.slice(previous, match.index);
    lyrics += part;
    column += [...part].length;
    anchors.push({ chord, column });
    previous = match.index + match[0].length;
  }
  return anchors.length
    ? { lyrics: lyrics + line.slice(previous), anchors }
    : undefined;
}
function hasInternalChord({ lyrics, anchors }: AnchoredLine) {
  const letters = [...lyrics];
  return anchors.some(
    ({ column }) =>
      column > 0 &&
      column < letters.length &&
      !/\s/.test(letters[column - 1]) &&
      !/\s/.test(letters[column])
  );
}
function anchoredContent({ lyrics, anchors }: AnchoredLine, semitones = 0) {
  const letters = [...lyrics];
  let result = "",
    previous = 0;
  for (const { chord, column } of anchors) {
    const position = Math.min(column, letters.length);
    result +=
      letters.slice(previous, position).join("") +
      `[${transposeChord(chord, semitones)}]`;
    previous = position;
  }
  return result + letters.slice(previous).join("");
}
function anchoredRows(parsed: AnchoredLine) {
  const { lyrics, anchors } = parsed;
  const rows: string[] = [];
  let cursor = 0,
    previousColumn = -1,
    size = lyrics.length;
  for (const { chord, column } of anchors) {
    if (column !== previousColumn) cursor = 0;
    previousColumn = column;
    while (cursor < rows.length && rows[cursor].length + 1 > column) cursor++;
    const previous = rows[cursor] ?? "";
    size += column + chord.length - previous.length;
    if (size > 200000) return [anchoredContent(parsed)];
    rows[cursor] = previous.padEnd(column) + chord;
    cursor++;
  }
  return [...rows, lyrics];
}

// Only rows expanded by the editor may be folded back into inline chord anchors.
export function createSongEditorState(content: string) {
  let text = "";
  const groups: { start: number; end: number }[] = [];
  for (const line of content.split("\n")) {
    const display = chordsAboveLyrics(line);
    const parsed = inlineChordLine(line);
    if (parsed && display.includes("\n"))
      groups.push({
        start: text.length,
        end: text.length + display.lastIndexOf("\n") + 1
      });
    text += display + "\n";
  }
  return { text: text.slice(0, -1), groups };
}

export function songContentFromEditor(
  previous: string,
  edited: string,
  state = createSongEditorState(previous)
) {
  let prefix = 0,
    suffix = 0;
  while (
    prefix < Math.min(state.text.length, edited.length) &&
    state.text[prefix] === edited[prefix]
  )
    prefix++;
  while (
    suffix < Math.min(state.text.length, edited.length) - prefix &&
    state.text[state.text.length - suffix - 1] ===
      edited[edited.length - suffix - 1]
  )
    suffix++;
  const oldEnd = state.text.length - suffix,
    newEnd = edited.length - suffix;
  const delta = edited.length - state.text.length;
  const inserted = edited.slice(prefix, newEnd);
  const rowDelta =
    inserted.split("\n").length -
    state.text.slice(prefix, oldEnd).split("\n").length;
  state.groups = state.groups.flatMap(({ start, end }) => {
    if (oldEnd <= start && (prefix < start || inserted.includes("\n")))
      return [{ start: start + delta, end: end + delta }];
    if (prefix >= end) return [{ start, end }];
    if (prefix >= start && oldEnd <= end && rowDelta === 0)
      return [{ start, end: end + delta }];
    return [];
  });
  state.text = edited;
  const parts: string[] = [];
  let previousEnd = 0;
  for (const { start, end } of state.groups) {
    if ((start > 0 && edited[start - 1] !== "\n") || edited[end - 1] !== "\n")
      continue;
    const rows = edited.slice(start, end).split("\n").slice(0, -1);
    const tokens = rows.map((row) => (row.trim() ? chordRowAnchors(row) : []));
    if (tokens.some((row) => !row)) continue;
    const newline = edited.indexOf("\n", end);
    const lyricEnd = newline < 0 ? edited.length : newline;
    const lyrics = edited.slice(end, lyricEnd);
    const inline = inlineChordLine(lyrics);
    const anchors = tokens.flatMap((row) =>
      row!.map((match) => ({
        chord: normalizeChord(match[0]),
        column: match.index
      }))
    );
    anchors.push(...(inline?.anchors ?? []));
    anchors.sort((a, b) => a.column - b.column);
    parts.push(
      edited.slice(previousEnd, start),
      anchoredContent({ lyrics: inline?.lyrics ?? lyrics, anchors })
    );
    previousEnd = lyricEnd;
  }
  parts.push(edited.slice(previousEnd));
  return transposeSong(parts.join(""), 0);
}

export function chordsAboveLyrics(content: string) {
  const result: string[] = [],
    normal: string[] = [];
  const flush = () => {
    if (normal.length) result.push(reflowChordPairs(normal.join("\n"), 0));
    normal.length = 0;
  };
  for (const line of sectionChordRows(content)) {
    const parsed = inlineChordLine(line);
    const chordLine = isChordLine(line);
    if (chordLine || !parsed) {
      normal.push(chordLine ? chordLineParts(line).join("") : line);
      continue;
    }
    flush();
    if (hasInternalChord(parsed)) {
      result.push(anchoredRows(parsed).join("\n"));
      continue;
    }
    let lyrics = "",
      chords = "",
      previous = 0;
    for (const match of line.matchAll(/\[([^\[\]]+)\]/g)) {
      const chord = normalizeChord(match[1]);
      if (!chordNotationPattern.test(chord)) continue;
      lyrics += line.slice(previous, match.index);
      const column = [...lyrics].length;
      const target = Math.max(column, chords.length ? chords.length + 1 : 0);
      lyrics += " ".repeat(target - column);
      chords = chords.padEnd(target) + chord;
      previous = match.index + match[0].length;
    }
    lyrics += line.slice(previous);
    result.push(lyrics.trim() ? `${chords}\n${lyrics.trimEnd()}` : chords);
  }
  flush();
  return result.join("\n");
}

export function isChordLine(line: string) {
  const tokens = chordTokens(line);
  return (
    tokens.length > 0 &&
    tokens.every((token) => chordNotationPattern.test(token))
  );
}

export function songChordSequence(content: string) {
  return content
    .split("\n")
    .flatMap((line) =>
      isChordLine(line)
        ? chordTokens(line).filter((token) => chordNotationPattern.test(token))
        : [...line.matchAll(/\[([^\[\]]+)\]/g)]
            .map((match) => normalizeChord(match[1]))
            .filter((token) => chordNotationPattern.test(token))
    );
}
export function transposeSong(content: string, semitones: number) {
  const lines = sectionChordRows(content),
    result: string[] = [],
    normal: string[] = [];
  const flush = () => {
    if (normal.length) {
      result.push(
        reflowChordPairs(chordsAboveLyrics(normal.join("\n")), semitones)
      );
      normal.length = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const parsed = inlineChordLine(lines[i]);
    if (parsed) {
      flush();
      result.push(anchoredContent(parsed, semitones));
      continue;
    }
    const tokens = chordRowAnchors(lines[i]);
    if (tokens) {
      let end = i + 1;
      while (end < lines.length && chordRowAnchors(lines[end])) end++;
      if (end > i + 1) {
        for (; i < end; i++) normal.push(lines[i]);
        i--;
        continue;
      }
      const lyrics = lines[i + 1];
      if (lyrics?.trim() && !isChordLine(lyrics) && !inlineChordLine(lyrics)) {
        const pair = {
          lyrics,
          anchors: tokens.map((match) => ({
            chord: normalizeChord(match[0]),
            column: match.index
          }))
        };
        if (hasInternalChord(pair)) {
          flush();
          result.push(anchoredContent(pair, semitones));
          i++;
          continue;
        }
      }
    }
    normal.push(lines[i]);
  }
  flush();
  return result.join("\n");
}

export function songChords(content: string) {
  return [...new Set(songChordSequence(content))];
}

export function chordShapeOptions(chord: string, selected?: number) {
  const match = chord.match(chordPattern);
  if (!match) return [];
  const root = (roots[match[1]] + (accidentals[match[2]] ?? 0) + 12) % 12;
  const groups = new Map<
    string,
    { frets: Frets; index: number; bass: number }
  >();
  chordShapes(chord).forEach((frets, index) => {
    // Open and muted strings do not change the fretting-hand shape.
    const key = frets.map((fret) => (fret && fret > 0 ? fret : 0)).join(",");
    const pitches = frets.flatMap((fret, string) =>
      fret === null ? [] : [guitarMidi[string] + fret]
    );
    const bass = Math.min(...pitches) % 12;
    const previous = groups.get(key);
    if (
      !previous ||
      index === selected ||
      (previous.index !== selected && previous.bass !== root && bass === root)
    ) {
      groups.set(key, { frets, index, bass });
    }
  });
  const options = [...groups.values()]
    .filter(
      ({ bass, index }) => !!match[4] || bass === root || index === selected
    )
    .map(({ frets, index, bass }) => {
      const pressed = frets.filter(
        (fret): fret is number => fret !== null && fret > 0
      );
      const position =
        !pressed.length || (frets.includes(0) && Math.max(...pressed) <= 4)
          ? 0
          : Math.min(...pressed);
      const label =
        !match[4] && bass !== root ? `${chord}/${sharpNotes[bass]}` : chord;
      return { frets, index, position, label };
    })
    .sort((a, b) => a.position - b.position || a.index - b.index);
  const positions = new Set<number>();
  const first = options.filter(({ position }) => {
    if (positions.has(position)) return false;
    positions.add(position);
    return true;
  });
  const leading = new Set(first.map(({ index }) => index));
  return [...first, ...options.filter(({ index }) => !leading.has(index))];
}

export function easiestShape(chord: string) {
  return chordShapeOptions(chord)
    .map(({ frets, index }) => {
      const pressed = frets.filter(
        (fret): fret is number => fret !== null && fret > 0
      );
      const span = pressed.length
        ? Math.max(...pressed) - Math.min(...pressed)
        : 0;
      const open = frets.filter((fret) => fret === 0).length;
      // A practical ranking, not a guarantee of comfort for every hand.
      const score =
        pressed.length +
        span * 2 +
        (pressed.length ? Math.min(...pressed) * 0.4 : 0) +
        (open ? 0 : 4);
      return { frets, index, score };
    })
    .sort((a, b) => a.score - b.score)[0];
}

export function easierPositions(
  chords: string[],
  transpose: number,
  currentCapo: number
) {
  if (!chords.length || chords.length > 100) return [];
  const positions = [
    ...new Set([currentCapo, ...Array.from({ length: 8 }, (_, capo) => capo)])
  ].map((capo) => {
    const displayed = chords.map((chord) =>
      transposeChord(chord, transpose - capo)
    );
    const shapes: Record<string, number> = {};
    let score = 0;
    displayed.forEach((chord) => {
      const shape = easiestShape(chord);
      score += shape?.score ?? Infinity;
      if (shape) shapes[chord] = shape.index;
    });
    return { capo, chords: displayed, shapes, score };
  });
  const current = positions.find((position) => position.capo === currentCapo)!;
  return positions
    .filter(
      (position) =>
        Number.isFinite(position.score) &&
        position.capo !== currentCapo &&
        position.score < current.score
    )
    .sort((a, b) => a.score - b.score || a.capo - b.capo)
    .slice(0, 3);
}
