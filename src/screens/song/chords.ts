type ParserWork<T> = Generator<void, T>;
function finishParser<T>(work: ParserWork<T>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}
function* lettersOf(text: string): ParserWork<string[]> {
  if (text.length < 4096) return [...text];
  const letters: string[] = [];
  for (const letter of text) {
    letters.push(letter);
    if (letters.length % 4096 === 0) yield;
  }
  return letters;
}
function* letterCount(text: string): ParserWork<number> {
  if (text.length < 4096) return [...text].length;
  let length = 0;
  for (const _ of text) {
    if (++length % 4096 === 0) yield;
  }
  return length;
}

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
  if (semitones === 0 || !chordNotationPattern.test(chord)) return chord;
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
  "5(9)": "sus2",
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
  return finishParser(chordLinePartsWork(line, semitones));
}
function* chordLinePartsWork(
  line: string,
  semitones = 0
): ParserWork<string[]> {
  const parts: string[] = [];
  let units = 0;
  for (const part of line.split(/(\s+|[|:]+)/)) {
    if (part) parts.push(transposeChord(part, semitones));
    if (++units % 64 === 0) yield;
  }
  return parts;
}
function expandTabs(content: string) {
  return finishParser(expandTabsWork(content));
}
function* expandTabsWork(content: string): ParserWork<string> {
  if (!content.includes("\t")) return content;
  let column = 0;
  let units = 0;
  const parts: string[] = [];
  for (const match of content.matchAll(/\[[^\[\]\n]+\]|[^\t\n\[]+|\t|\n|./gu)) {
    const part = match[0];
    if (part === "\n") {
      column = 0;
      parts.push(part);
    } else if (part === "\t") {
      const width = 8 - (column % 8);
      column += width;
      parts.push(" ".repeat(width));
    } else {
      if (
        !part.startsWith("[") ||
        !chordNotationPattern.test(normalizeChord(part.slice(1, -1)))
      )
        column += yield* letterCount(part);
      parts.push(part);
    }
    if (++units % 64 === 0) yield;
  }
  const expanded = parts.join("");
  return expanded.length > 200000 ? content : expanded;
}
function* reflowChordPairsWork(
  content: string,
  semitones: number
): ParserWork<string> {
  const lines = content.split("\n");
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    yield;
    const line = lines[i],
      lyrics = lines[i + 1];
    if (!(yield* isChordLineWork(line))) {
      output.push(line);
      continue;
    }
    const anchors = yield* chordRowAnchorsWork(line);
    if (
      !anchors ||
      !lyrics?.trim() ||
      isSectionBoundary(lyrics) ||
      (yield* isChordLineWork(lyrics)) ||
      line.includes("\t") ||
      lyrics.includes("\t")
    ) {
      output.push((yield* chordLinePartsWork(line, semitones)).join(""));
      continue;
    }
    const words = yield* lettersOf(lyrics);
    let chords = line.slice(0, anchors[0].index);
    let text =
      words.slice(0, anchors[0].index).join("") +
      " ".repeat(Math.max(0, anchors[0].index - words.length));
    for (let j = 0; j < anchors.length; j++) {
      if (j % 64 === 0) yield;
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
      const phraseLength = yield* letterCount(phrase);
      const width = Math.max(phraseLength, chord.length + gap.length);
      chords += (chord + gap).padEnd(width);
      text += phrase + " ".repeat(width - phraseLength);
    }
    output.push(chords.trimEnd(), text.trimEnd());
    i++;
  }
  return output.join("\n");
}

const sectionNames =
  "intro|verse|chorus|bridge|outro|solo|interlude|instrumental|pre-chorus|post-chorus|refrain|coda|приспів|куплет|припев|вступ|вступление|бридж|брідж|програш|проигрыш|інтро|интро|аутро|соло|кода|рефрен|предприпев|передприспів";
const sectionPattern = new RegExp(`\\[(?:${sectionNames})[^\\[\\]]*\\]`, "gi");
const sectionHeading = new RegExp(
  `^((?:${sectionNames})(?:\\s+(?:\\d+|[ivx]+))?(?:\\s*\\([^()\\n]{0,70}\\))?)(?:\\s*:\\s*(.*)|\\s*)$`,
  "i"
);
const chordProSectionTitles: Record<string, string | undefined> = {
  start_of_verse: "Verse",
  sov: "Verse",
  start_of_chorus: "Chorus",
  soc: "Chorus",
  start_of_bridge: "Bridge",
  sob: "Bridge"
};
export function isSectionBoundary(line: string) {
  return (
    sectionHeading.test(line.trim()) ||
    !!line.match(sectionPattern) ||
    /^\s*\{[^{}]*\}\s*$/.test(line)
  );
}
function chordTokens(line: string) {
  return finishParser(chordTokensWork(line));
}
function* chordTokensWork(line: string): ParserWork<string[]> {
  const tokens: string[] = [];
  let units = 0;
  for (const token of yield* chordLinePartsWork(
    line.replace(sectionPattern, " ")
  )) {
    if (!/^(?:\s+|[|:]+|[-()[\]]+|\(?[xх×]\d+\)?|\(?\d+[xх×]\)?)$/i.test(token))
      tokens.push(token);
    if (++units % 64 === 0) yield;
  }
  return tokens;
}
function* sectionChordRowsWork(content: string): ParserWork<string[]> {
  const rows: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const sections = line.match(sectionPattern);
    if (sections && (yield* isChordLineWork(line)))
      rows.push(...sections, line.replace(sectionPattern, "").trimStart());
    else rows.push(line);
    yield;
  }
  return rows;
}

function chordRowAnchors(line: string, chordsOnly = false) {
  return finishParser(chordRowAnchorsWork(line, chordsOnly));
}
function* chordRowAnchorsWork(
  line: string,
  chordsOnly = false
): ParserWork<RegExpExecArray[] | undefined> {
  if (!(yield* isChordLineWork(line))) return undefined;
  let units = 0;
  if (chordsOnly)
    for (const part of yield* chordLinePartsWork(line)) {
      if (part.trim() && !chordNotationPattern.test(part)) return undefined;
      if (++units % 64 === 0) yield;
    }
  const anchors: RegExpExecArray[] = [];
  for (const match of line.matchAll(/[^\s|:]+/g)) {
    if (chordNotationPattern.test(normalizeChord(match[0])))
      anchors.push(match);
    if (++units % 64 === 0) yield;
  }
  return anchors;
}

type AnchoredLine = {
  lyrics: string;
  anchors: { chord: string; column: number }[];
};
function inlineChordLine(line: string): AnchoredLine | undefined {
  return finishParser(inlineChordLineWork(line));
}
function* inlineChordLineWork(
  line: string
): ParserWork<AnchoredLine | undefined> {
  let lyrics = "",
    previous = 0,
    column = 0;
  const anchors: AnchoredLine["anchors"] = [];
  let units = 0;
  for (const match of line.matchAll(/\[([^\[\]]+)\]/g)) {
    if (++units % 64 === 0) yield;
    const chord = normalizeChord(match[1]);
    if (!chordNotationPattern.test(chord)) continue;
    const part = line.slice(previous, match.index);
    lyrics += part;
    column += yield* letterCount(part);
    anchors.push({ chord, column });
    previous = match.index + match[0].length;
  }
  return anchors.length
    ? { lyrics: lyrics + line.slice(previous), anchors }
    : undefined;
}
function* hasInternalChordWork({
  lyrics,
  anchors
}: AnchoredLine): ParserWork<boolean> {
  const letters = yield* lettersOf(lyrics);
  let units = 0;
  for (const { column } of anchors) {
    if (
      column > 0 &&
      column < letters.length &&
      !/\s/.test(letters[column - 1]) &&
      !/\s/.test(letters[column])
    )
      return true;
    if (++units % 64 === 0) yield;
  }
  return false;
}
function anchoredContent({ lyrics, anchors }: AnchoredLine, semitones = 0) {
  return finishParser(anchoredContentWork({ lyrics, anchors }, semitones));
}
function* anchoredContentWork(
  { lyrics, anchors }: AnchoredLine,
  semitones = 0
): ParserWork<string> {
  const letters = yield* lettersOf(lyrics);
  let result = "",
    previous = 0,
    units = 0;
  for (const { chord, column } of anchors) {
    if (++units % 64 === 0) yield;
    const position = Math.min(column, letters.length);
    result +=
      letters.slice(previous, position).join("") +
      `[${transposeChord(chord, semitones)}]`;
    previous = position;
  }
  return result + letters.slice(previous).join("");
}
function* anchoredRowsWork(parsed: AnchoredLine): ParserWork<string[]> {
  const { lyrics, anchors } = parsed;
  const rows: string[] = [];
  let cursor = 0,
    previousColumn = -1,
    size = lyrics.length,
    units = 0;
  for (const { chord, column } of anchors) {
    if (++units % 64 === 0) yield;
    if (column !== previousColumn) cursor = 0;
    previousColumn = column;
    while (cursor < rows.length && rows[cursor].length + 1 > column) {
      cursor++;
      if (cursor % 256 === 0) yield;
    }
    const previous = rows[cursor] ?? "";
    size += column + chord.length - previous.length;
    if (size > 200000) return [yield* anchoredContentWork(parsed)];
    rows[cursor] = previous.padEnd(column) + chord;
    cursor++;
  }
  return [...rows, lyrics];
}

type SongEditorState = {
  text: string;
  groups: { start: number; end: number }[];
};
type EditorCache = {
  folded: Map<string, string | null>;
  inline: Map<string, string | null>;
  rows: Map<string, NonNullable<ReturnType<typeof chordRowAnchors>> | null>;
  normal: Map<
    string,
    { displayLength: number; content: string; endsWithChord: boolean }
  >;
};
// Keep only the current document's reusable work, for the editor's lifetime.
const editorCaches = new WeakMap<SongEditorState, EditorCache>();

// Only rows expanded by the editor may be folded back into inline chord anchors.
export function createSongEditorState(content: string): SongEditorState {
  const normalized = expandTabs(content);
  if (normalized.includes("\t")) return { text: content, groups: [] };
  let text = "";
  const groups: { start: number; end: number }[] = [];
  for (const line of normalized.split("\n")) {
    const display = chordsAboveLyrics(line);
    if (text.length + display.length > 200000)
      return { text: content, groups: [] };
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
  const sharedLength = Math.min(state.text.length, edited.length);
  // Appending or backspacing at the end is common in the editor. The native
  // prefix check avoids a JavaScript iteration for every unchanged character.
  if (
    state.text.length <= edited.length
      ? edited.startsWith(state.text)
      : state.text.startsWith(edited)
  )
    prefix = sharedLength;
  else
    while (prefix < sharedLength && state.text[prefix] === edited[prefix])
      prefix++;
  while (
    suffix < sharedLength - prefix &&
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
  const groups: SongEditorState["groups"] = [];
  for (const group of state.groups) {
    const { start, end } = group;
    if (oldEnd <= start && (prefix < start || inserted.includes("\n")))
      groups.push({ start: start + delta, end: end + delta });
    else if (prefix >= end) groups.push(group);
    else if (prefix >= start && oldEnd <= end && rowDelta === 0)
      groups.push({ start, end: end + delta });
  }
  state.groups = groups;
  state.text = edited;
  const nextCache: EditorCache | undefined =
    edited.length <= 200000
      ? {
          folded: new Map(),
          inline: new Map(),
          rows: new Map(),
          normal: new Map()
        }
      : undefined;
  const cache = nextCache ? editorCaches.get(state) : undefined;
  const rowAnchors = new Map<string, AnchoredLine["anchors"] | null>();
  const parts: string[] = [];
  let previousEnd = 0;
  for (const { start, end } of state.groups) {
    if ((start > 0 && edited[start - 1] !== "\n") || edited[end - 1] !== "\n")
      continue;
    const newline = edited.indexOf("\n", end);
    const lyricEnd = newline < 0 ? edited.length : newline;
    const group = edited.slice(start, lyricEnd);
    let folded = cache?.folded.get(group);
    if (folded === undefined) {
      const rows = edited.slice(start, end).split("\n").slice(0, -1);
      const tokens = rows.map((row) => {
        let anchors = rowAnchors.get(row);
        if (anchors === undefined) {
          const parsed = row.trim() ? chordRowAnchors(row, true) : [];
          anchors =
            parsed?.map((match) => ({
              chord: normalizeChord(match[0]),
              column: match.index
            })) ?? null;
          rowAnchors.set(row, anchors);
        }
        return anchors;
      });
      if (tokens.some((row) => !row)) folded = null;
      else {
        const lyrics = edited.slice(end, lyricEnd);
        const inline = inlineChordLine(lyrics);
        const anchors = tokens.flatMap((row) => row!);
        anchors.push(...(inline?.anchors ?? []));
        anchors.sort((a, b) => a.column - b.column);
        folded = anchoredContent({
          lyrics: inline?.lyrics ?? lyrics,
          anchors
        });
        // These anchors are already normalized. Plain lyrics cannot introduce
        // another bracket chord or a tab expansion during the final pass.
        if (anchors.length && !/[\[\]\t]/.test(inline?.lyrics ?? lyrics))
          nextCache?.inline.set(folded, folded);
      }
    }
    nextCache?.folded.set(group, folded);
    if (folded === null) continue;
    parts.push(edited.slice(previousEnd, start), folded);
    previousEnd = lyricEnd;
  }
  parts.push(edited.slice(previousEnd));
  const content = transposeContent(parts.join(""), 0, cache, nextCache);
  if (nextCache) editorCaches.set(state, nextCache);
  else editorCaches.delete(state);
  return content;
}

export function chordsAboveLyrics(content: string) {
  return finishParser(chordsAboveLyricsWork(content));
}
function* chordsAboveLyricsWork(content: string): ParserWork<string> {
  const normalized = yield* expandTabsWork(content);
  if (normalized.includes("\t")) return content;
  content = normalized;
  const result: string[] = [],
    normal: string[] = [];
  let size = 0;
  const append = (text: string) => {
    size += text.length + (result.length ? 1 : 0);
    result.push(text);
  };
  const flush = function* (): ParserWork<void> {
    if (normal.length)
      append(yield* reflowChordPairsWork(normal.join("\n"), 0));
    normal.length = 0;
  };
  for (const line of yield* sectionChordRowsWork(content)) {
    yield;
    if (size > 200000) return content;
    const parsed = yield* inlineChordLineWork(line);
    const chordLine = yield* isChordLineWork(line);
    if (chordLine || !parsed) {
      normal.push(
        chordLine ? (yield* chordLinePartsWork(line)).join("") : line
      );
      continue;
    }
    yield* flush();
    if (yield* hasInternalChordWork(parsed)) {
      append((yield* anchoredRowsWork(parsed)).join("\n"));
      continue;
    }
    let lyrics = "",
      chords = "",
      column = 0,
      previous = 0,
      units = 0;
    for (const match of line.matchAll(/\[([^\[\]]+)\]/g)) {
      if (++units % 64 === 0) yield;
      const chord = normalizeChord(match[1]);
      if (!chordNotationPattern.test(chord)) continue;
      const segment = line.slice(previous, match.index);
      column += yield* letterCount(segment);
      const target = Math.max(column, chords.length ? chords.length + 1 : 0);
      if (
        size +
          lyrics.length +
          segment.length +
          target -
          column +
          target +
          chord.length +
          1 >
        200000
      )
        return content;
      lyrics += segment + " ".repeat(target - column);
      column = target;
      chords = chords.padEnd(target) + chord;
      previous = match.index + match[0].length;
    }
    lyrics += line.slice(previous);
    append(lyrics.trim() ? `${chords}\n${lyrics.trimEnd()}` : chords);
  }
  yield* flush();
  return size > 200000 ? content : result.join("\n");
}

export function isChordLine(line: string) {
  return finishParser(isChordLineWork(line));
}
function* isChordLineWork(line: string): ParserWork<boolean> {
  const tokens = yield* chordTokensWork(line);
  if (!tokens.length) return false;
  let units = 0;
  for (const token of tokens) {
    if (!chordNotationPattern.test(token)) return false;
    if (++units % 64 === 0) yield;
  }
  return true;
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

export function songPlaybackLines(text: string) {
  const lines = text.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    let target = index;
    while (target + 1 < lines.length && isChordLine(lines[target + 1]))
      target++;
    if (lines[target + 1]?.trim() && !isSectionBoundary(lines[target + 1]))
      target++;
    return songChordSequence(line).map(() => target);
  });
}

export function songSections(content: string) {
  const sections = [{ id: "", title: "", content: "" }];
  for (const line of content.split(/\r?\n/)) {
    if (
      /^\s*\{(?:end_of_(?:verse|chorus|bridge)|eov|eoc|eob)\}\s*$/i.test(line)
    ) {
      sections.push({ id: "", title: "", content: "" });
      continue;
    }
    const directive = line
      .trim()
      .match(
        /^\{(start_of_verse|start_of_chorus|start_of_bridge|sov|soc|sob)(?::\s*([^{}]+))?\}$/i
      );
    const bracket = line.match(sectionPattern)?.[0];
    const plain = sectionHeading.exec(line.trim());
    const heading = directive
      ? (directive[2] ?? chordProSectionTitles[directive[1].toLowerCase()])
      : bracket && line.trimStart().startsWith(bracket)
        ? bracket
        : plain?.[1];
    if (heading && heading.length <= 100) {
      const title = heading.replace(/^[\[{]|[\]}:]$/g, "").trim();
      sections.push({
        id: title.normalize("NFKC").toLowerCase().replace(/\s+/g, " "),
        title,
        content:
          (bracket
            ? line.trimStart().slice(bracket.length)
            : (plain?.[2] ?? "")) + "\n"
      });
    } else sections[sections.length - 1].content += line + "\n";
  }
  return sections;
}

function transposeContent(
  content: string,
  semitones: number,
  cache?: EditorCache,
  nextCache?: EditorCache
) {
  return finishParser(
    transposeContentWork(content, semitones, cache, nextCache)
  );
}
function* transposeContentWork(
  content: string,
  semitones: number,
  cache?: EditorCache,
  nextCache?: EditorCache
): ParserWork<string> {
  const lines = yield* sectionChordRowsWork(yield* expandTabsWork(content));
  const result: string[] = [],
    normal: string[] = [];
  const rowAnchors = function* (
    line: string
  ): ParserWork<NonNullable<ReturnType<typeof chordRowAnchors>> | null> {
    let tokens = nextCache?.rows.get(line);
    if (tokens === undefined) tokens = cache?.rows.get(line);
    if (tokens === undefined)
      tokens = (yield* chordRowAnchorsWork(line)) ?? null;
    nextCache?.rows.set(line, tokens);
    return tokens;
  };
  const flush = function* (): ParserWork<void> {
    if (normal.length) {
      let normalized: string | undefined;
      if (nextCache && !normal.some((line) => /[\t\r]/.test(line))) {
        const blocks: string[] = [];
        let start = 0,
          displayLength = 0,
          compatible = true;
        for (let end = 1; end <= normal.length; end++) {
          yield;
          // Normal rows have no inline chords and already have their section
          // headings expanded. End each block after a lyric or blank row so
          // the two reflow passes cannot pair chords across its boundary.
          if (end < normal.length && (yield* rowAnchors(normal[end - 1])))
            continue;
          const rows = normal.slice(start, end);
          const source = rows.join("\n");
          let block = nextCache.normal.get(source) ?? cache?.normal.get(source);
          if (!block) {
            const normalizedRows: string[] = [];
            for (const line of rows)
              normalizedRows.push(
                (yield* rowAnchors(line))
                  ? (yield* chordLinePartsWork(line)).join("")
                  : line
              );
            const display = yield* reflowChordPairsWork(
              normalizedRows.join("\n"),
              0
            );
            block = {
              displayLength: display.length,
              content:
                display.length > 200000
                  ? ""
                  : yield* reflowChordPairsWork(display, semitones),
              endsWithChord:
                display.length <= 200000 &&
                !!(yield* rowAnchors(
                  display.slice(display.lastIndexOf("\n") + 1)
                ))
            };
          }
          nextCache.normal.set(source, block);
          displayLength += block.displayLength + (blocks.length ? 1 : 0);
          if (
            displayLength > 200000 ||
            (end < normal.length && block.endsWithChord)
          ) {
            compatible = false;
            break;
          }
          blocks.push(block.content);
          start = end;
        }
        if (compatible) normalized = blocks.join("\n");
      }
      result.push(
        normalized ??
          (yield* reflowChordPairsWork(
            yield* chordsAboveLyricsWork(normal.join("\n")),
            semitones
          ))
      );
      normal.length = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    yield;
    let cached = nextCache?.inline.get(lines[i]);
    if (cached === undefined) cached = cache?.inline.get(lines[i]);
    const parsed =
      cached === undefined ? yield* inlineChordLineWork(lines[i]) : undefined;
    if ((cached !== undefined && cached !== null) || parsed) {
      yield* flush();
      const inline = cached ?? (yield* anchoredContentWork(parsed!, semitones));
      nextCache?.inline.set(lines[i], inline);
      result.push(inline);
      continue;
    }
    nextCache?.inline.set(lines[i], null);
    const tokens = yield* rowAnchors(lines[i]);
    if (tokens) {
      let end = i + 1;
      while (end < lines.length && (yield* rowAnchors(lines[end]))) end++;
      if (end > i + 1) {
        for (; i < end; i++) normal.push(lines[i]);
        i--;
        continue;
      }
      const lyrics = lines[i + 1];
      if (
        lyrics?.trim() &&
        !isSectionBoundary(lyrics) &&
        !(yield* rowAnchors(lyrics)) &&
        !(yield* inlineChordLineWork(lyrics)) &&
        !lines[i].includes("\t") &&
        !lyrics.includes("\t")
      ) {
        const pair = {
          lyrics,
          anchors: tokens.map((match) => ({
            chord: normalizeChord(match[0]),
            column: match.index
          }))
        };
        if (
          (yield* hasInternalChordWork(pair)) &&
          (yield* chordRowAnchorsWork(lines[i], true))
        ) {
          yield* flush();
          result.push(yield* anchoredContentWork(pair, semitones));
          i++;
          continue;
        }
      }
    }
    normal.push(lines[i]);
  }
  yield* flush();
  const transposed = result.join("\n");
  return semitones === 0 &&
    content.length <= 200000 &&
    transposed.length > 200000
    ? content
    : transposed;
}

export function transposeSong(content: string, semitones: number) {
  return transposeContent(content, semitones);
}

const parserAborted = () => {
  const error = new Error("Song parsing aborted");
  error.name = "AbortError";
  return error;
};
function parserTurn(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(parserAborted());
    };
    const timer = setTimeout(finish, 0);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function finishParserAsync<T>(
  work: ParserWork<T>,
  signal?: AbortSignal,
  initialYield = true
): Promise<T> {
  try {
    if (initialYield) await parserTurn(signal);
    let deadline = Date.now() + 4,
      units = 0;
    while (true) {
      if (signal?.aborted) throw parserAborted();
      const step = work.next();
      if (step.done) return step.value;
      if (++units >= 1024 || Date.now() >= deadline) {
        await parserTurn(signal);
        deadline = Date.now() + 4;
        units = 0;
      }
    }
  } finally {
    // Cancellation discards the unfinished result and releases iterator state.
    work.return(undefined as T);
  }
}

/** Use the same normalization passes while allowing loading UI and cancellation. */
export function transposeSongAsync(
  content: string,
  semitones: number,
  signal?: AbortSignal
): Promise<string> {
  return finishParserAsync(transposeContentWork(content, semitones), signal);
}

type PlayingInstruction = "tempo" | "rhythm";

// This is lyric validation only, not a second rhythm/tempo importer. Keep its
// label vocabulary aligned with sourceRhythm without importing rhythms.ts,
// which already depends on this module for section parsing.
function playingInstruction(line: string, previous?: PlayingInstruction) {
  let text = line.replace(/[BБ]₂/gi, "A").normalize("NFKC").trim();
  if (/^(?:\{[^{}]*\}|\[[^\[\]]*\])$/.test(text))
    text = text
      .slice(1, -1)
      .trim()
      .replace(/^meta:\s*/i, "");
  if (!text)
    return { metadata: false, next: line.trim() ? undefined : previous };
  const tempoValue = (value: string) =>
    /^(?:♩\s*=\s*)?\d+(?:[.,]\d+)?\s*(?:bpm|уд(?:аров)?\.?\s*(?:\/|в)\s*мин(?:уту)?\.?)?$/iu.test(
      value
    );
  const rhythmValue = (value: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s*\([^()\n]{1,80}\)\s*$/, "")
      .trim();
    return (
      /^[duxabб1-6↓↑×·|\s-]+$/iu.test(normalized) ||
      /^(?:шестерка(?: с глушением| 6\/8)?|шістка(?: з (?:глушінням|глушкою|приглушенням)| 6\/8)?|четверка|четвірка|восьмерка|вісімка|пятерка|п['’]ятірка|девятка|дев['’]ятка|four|five|six(?: notes 6\/8)?|eight|nine|вальс|waltz|[45689]|[34]\/4|6\/8)$/iu.test(
        normalized
      )
    );
  };
  const tempo = text.match(
    /^(?:tempo|bpm|темп|andamento)(?=\s|[:=–—-]|$)\s*([:=–—-])?\s*(.*)$/iu
  );
  const rhythm = text.match(
    /^(?:(?:рекомендуемый|рекомендую)\s+)?(?:бой|бій|strumming(?: pattern)?|strum(?: pattern)?|batida|ritmo|перебор|арпеджіо|арпеджио|fingerpicking(?: pattern)?|picking(?: pattern)?|arpeggio)(?=\s|[:=–—-]|$)\s*([:=–—-])?\s*(.*)$/iu
  );
  const instruction = tempo ?? rhythm;
  if (instruction) {
    const value = instruction[2].trim();
    if (
      !value ||
      instruction[1] ||
      (tempo ? tempoValue(value) : rhythmValue(value)) ||
      /^(?:рекомендуемый|рекомендую)\s/iu.test(text)
    )
      return {
        metadata: true,
        next: !value
          ? ((tempo ? "tempo" : "rhythm") as PlayingInstruction)
          : undefined
      };
  }
  return {
    metadata:
      (previous === "tempo" &&
        (tempoValue(text) || /^(?:♩\s*=\s*)?[+\-−]?\d/u.test(text))) ||
      (previous === "rhythm" && rhythmValue(text)) ||
      /^\d+(?:[.,]\d+)?\s*[-–—]\s*\d+(?:[.,]\d+)?\s*bpm$/iu.test(text) ||
      (/(?:bpm|уд(?:аров)?\.?\s*(?:\/|в)\s*мин(?:уту)?\.?)$/iu.test(text) &&
        tempoValue(text)) ||
      (/^♩\s*=/.test(text) && tempoValue(text)),
    next: undefined
  };
}

function* hasSongChordsWork(
  content: string,
  requireLyrics: boolean
): ParserWork<boolean> {
  let chords = false,
    lyrics = !requireLyrics;
  let instruction: PlayingInstruction | undefined;
  for (const line of content.split("\n")) {
    yield;
    if (yield* isChordLineWork(line)) {
      chords = true;
      instruction = undefined;
    } else {
      const inline = yield* inlineChordLineWork(line);
      if (inline?.anchors.length) chords = true;
      if (requireLyrics && !lyrics) {
        const text = (inline?.lyrics ?? line)
          .replace(sectionPattern, "")
          .trim();
        const heading = sectionHeading.exec(text);
        const words = heading ? (heading[2] ?? "") : text;
        const playing = playingInstruction(words, instruction);
        instruction = !words && line.trim() ? undefined : playing.next;
        if (
          !playing.metadata &&
          !/^(?:intro|outro|solo|interlude|instrumental|вступ|вступление|програш|проигрыш|інтро|интро|аутро|соло)(?:\s|$)/i.test(
            heading?.[1] ?? ""
          ) &&
          !/^\{[^{}]*\}$/.test(words) &&
          !/^(?:see\s+(?:tabs?|notation)|см\.|див\.)\s/iu.test(words) &&
          !/^(?:capo|капо(?:дастр)?|tempo|bpm|темп|tuning|строй)\s*[:\d]/iu.test(
            words
          ) &&
          !/^(?:song|title|artist|album)(?:\s*[:=]|\s+[-–—]\s)/iu.test(words) &&
          !/^(?:tabbed|transcribed|arranged)\s+by(?:\s|[:=–—-])/iu.test(
            words
          ) &&
          !/^[eBGDAE]\s*[|:][\d\s|/\\().~xXhpb\-]+$/.test(words) &&
          /\p{L}{2}/u.test(words)
        )
          lyrics = true;
      }
    }
    if (chords && lyrics) return true;
  }
  return false;
}

export function hasSongChordsAsync(
  content: string,
  signal?: AbortSignal,
  requireLyrics = false
): Promise<boolean> {
  return finishParserAsync(
    hasSongChordsWork(content, requireLyrics),
    signal,
    false
  );
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
