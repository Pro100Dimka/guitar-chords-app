export const noteNames = [
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
export const standardTuning = [40, 45, 50, 55, 59, 64];
export const guitarTunings: Record<string, { label: string; notes: number[] }> =
  {
    standard: { label: "Standard E", notes: standardTuning },
    halfStep: {
      label: "Standard E♭",
      notes: standardTuning.map((note) => note - 1)
    },
    standardD: {
      label: "Standard D",
      notes: standardTuning.map((note) => note - 2)
    },
    standardDb: {
      label: "Standard D♭",
      notes: standardTuning.map((note) => note - 3)
    },
    standardC: {
      label: "Standard C",
      notes: standardTuning.map((note) => note - 4)
    },
    standardB: {
      label: "Baritone B",
      notes: standardTuning.map((note) => note - 5)
    },
    standardA: {
      label: "Baritone A",
      notes: standardTuning.map((note) => note - 7)
    },
    dropD: { label: "Drop D", notes: [38, 45, 50, 55, 59, 64] },
    dropDb: { label: "Drop D♭", notes: [37, 44, 49, 54, 58, 63] },
    dropC: { label: "Drop C", notes: [36, 43, 48, 53, 57, 62] },
    dropB: { label: "Drop B", notes: [35, 42, 47, 52, 56, 61] },
    dropBb: { label: "Drop B♭", notes: [34, 41, 46, 51, 55, 60] },
    dropA: { label: "Drop A", notes: [33, 40, 45, 50, 54, 59] },
    dropAb: { label: "Drop A♭", notes: [32, 39, 44, 49, 53, 58] },
    dropG: { label: "Drop G", notes: [31, 38, 43, 48, 52, 57] },
    dropF: { label: "Drop F", notes: [29, 36, 41, 46, 50, 55] },
    dropE: { label: "Drop E", notes: [28, 35, 40, 45, 49, 54] },
    doubleDropD: { label: "Double Drop D", notes: [38, 45, 50, 55, 59, 62] },
    dadgad: { label: "DADGAD", notes: [38, 45, 50, 55, 57, 62] },
    openD: { label: "Open D", notes: [38, 45, 50, 54, 57, 62] },
    openDm: { label: "Open D minor", notes: [38, 45, 50, 53, 57, 62] },
    openE: { label: "Open E", notes: [40, 47, 52, 56, 59, 64] },
    openEm: { label: "Open E minor", notes: [40, 47, 52, 55, 59, 64] },
    openG: { label: "Open G", notes: [38, 43, 50, 55, 59, 62] },
    openGm: { label: "Open G minor", notes: [38, 43, 50, 55, 58, 62] },
    openA: { label: "Open A", notes: [40, 45, 52, 57, 61, 64] },
    openC: { label: "Open C", notes: [36, 43, 48, 55, 60, 64] },
    openCm: { label: "Open C minor", notes: [36, 43, 48, 55, 60, 63] },
    openCsus2: { label: "Open C sus2", notes: [36, 43, 48, 55, 60, 62] },
    openDsus2: { label: "Open D sus2", notes: [38, 45, 50, 52, 57, 62] },
    allFourths: {
      label: "All fourths · EADGCF",
      notes: [40, 45, 50, 55, 60, 65]
    },
    newStandard: {
      label: "New Standard · CGDAEG",
      notes: [36, 43, 50, 57, 64, 67]
    },
    nashville: { label: "Nashville", notes: [52, 57, 62, 67, 59, 64] }
  };
export const noteLabel = (midi: number) =>
  `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
