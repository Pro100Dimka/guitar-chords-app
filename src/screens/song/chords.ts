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
export function transposeChord(chord: string, semitones: number) {
  if (!chordPattern.test(chord) || semitones === 0) return chord;
  const notes = chord.includes("b") ? flatNotes : sharpNotes;
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

export function chordShapes(chord: string): Frets[] {
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
  return shapes.filter(
    (shape, index) =>
      shapes.findIndex((other) => String(other) === String(shape)) === index
  );
}

export function isChordLine(line: string) {
  const tokens = line
    .trim()
    .split(/\s+/)
    .filter((token) => !/^[|:\-()[\]]+$/.test(token));
  return tokens.length > 0 && tokens.every((token) => chordPattern.test(token));
}
