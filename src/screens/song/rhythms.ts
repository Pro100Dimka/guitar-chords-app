import { songSections } from "./chords";
import type { SongRhythm } from "../../components/preferences";

const ninePattern = "D-------D-----U---U-D---D---D-DU";
export const MAX_RHYTHM_STEPS = 32;

export const rhythms: {
  id: string;
  title: string;
  pattern: string;
  meter: 2 | 3 | 4;
  division: number;
  aliases?: string[];
}[] = [
  {
    id: "six",
    title: "RhythmSix",
    pattern: "D-DU-UDU",
    meter: 4,
    division: 2,
    aliases: ["шестерка", "шістка", "six", "6"]
  },
  {
    id: "four",
    aliases: ["четверка", "четвірка", "four", "4"],
    title: "RhythmFour",
    pattern: "D-U-D-U-",
    meter: 4,
    division: 2
  },
  {
    id: "quarter",
    title: "RhythmQuarter",
    pattern: "D-D-D-D-",
    meter: 4,
    division: 2
  },
  {
    id: "eighth",
    aliases: ["восьмерка", "вісімка", "eight", "8"],
    title: "RhythmEighth",
    pattern: "DUDUDUDU",
    meter: 4,
    division: 2
  },
  {
    id: "muted",
    aliases: [
      "шестерка с глушением",
      "шістка з глушінням",
      "шістка з глушкою",
      "шістка з приглушенням"
    ],
    title: "RhythmMuted",
    pattern: "D-XUD-XU",
    meter: 4,
    division: 2
  },
  {
    id: "five",
    aliases: ["пятерка", "п'ятірка", "п’ятірка", "five", "5"],
    title: "RhythmFive",
    pattern: "D-DU-UD-",
    meter: 4,
    division: 2
  },
  {
    id: "ballad",
    title: "RhythmBallad",
    pattern: "D--U-UDU",
    meter: 4,
    division: 2
  },
  {
    id: "bass",
    title: "RhythmBass",
    pattern: "B-D-B-D-",
    meter: 4,
    division: 2
  },
  {
    id: "waltz",
    title: "RhythmWaltz",
    pattern: "D-D-D-",
    meter: 3,
    division: 2
  },
  {
    id: "half",
    title: "RhythmHalf",
    pattern: "D---D---",
    meter: 4,
    division: 2
  },
  {
    id: "rock",
    title: "RhythmRock",
    pattern: "DDDDDDDD",
    meter: 4,
    division: 2
  },
  {
    id: "offbeat",
    title: "RhythmOffbeat",
    pattern: "-U-U-U-U",
    meter: 4,
    division: 2
  },
  {
    id: "shuffle",
    title: "RhythmShuffle",
    pattern: "D-UD-UD-UD-U",
    meter: 4,
    division: 3
  },
  {
    id: "gallop",
    title: "RhythmGallop",
    pattern: "D-DUD-DUD-DUD-DU",
    meter: 4,
    division: 4
  },
  {
    id: "nine",
    aliases: ["девятка", "дев'ятка", "дев’ятка", "nine", "9"],
    title: "RhythmNine",
    pattern: "D--UD--U-U-UDUD-",
    meter: 4,
    division: 2
  },
  {
    id: "nine-alt",
    title: "RhythmNineVariant",
    aliases: ["девятка вариант 2", "дев’ятка варіант 2", "nine variant 2"],
    pattern: ninePattern,
    meter: 4,
    division: 4
  }
];
export const pickingPatterns: (typeof rhythms)[number][] = [
  {
    id: "pick-eight",
    title: "PickingEight",
    pattern: "B3231323",
    meter: 4,
    division: 2,
    aliases: ["восьмерка", "вісімка", "eight", "8"]
  },
  {
    id: "pick-four",
    title: "PickingFour",
    pattern: "B-3-2-1-",
    meter: 4,
    division: 2,
    aliases: ["четверка", "четвірка", "four", "4"]
  },
  {
    id: "pick-six",
    title: "PickingSix",
    pattern: "B32123",
    meter: 2,
    division: 3,
    aliases: ["шестерка 6/8", "шістка 6/8", "six notes 6/8", "6/8"]
  },
  {
    id: "pick-waltz",
    title: "PickingWaltz",
    pattern: "B32123",
    meter: 3,
    division: 2,
    aliases: ["вальс", "waltz", "3/4"]
  },
  {
    id: "pick-inside",
    title: "PickingInside",
    pattern: "B3A2B3A2",
    meter: 4,
    division: 2
  },
  {
    id: "pick-travis",
    title: "PickingTravis",
    pattern: "B2A1B2A1",
    meter: 4,
    division: 2
  },
  {
    id: "pick-rise",
    title: "PickingRise",
    pattern: "B4321234",
    meter: 4,
    division: 2
  }
];
export const allRhythms = [...rhythms, ...pickingPatterns];

export interface SongArrangement {
  title: string;
  artist: string;
  tempo: number;
  source: { name: string; url: string };
  parts: Record<string, readonly (readonly [chord: string, pattern: string])[]>;
}

const shortStrum = "D-------D-----U-";
const transitionStrum = "D-------D-----U---U-D---D-----DU";
export const songArrangements: SongArrangement[] = [
  {
    title: "Behind Blue Eyes",
    artist: "Limp Bizkit",
    tempo: 120,
    source: {
      name: "GuitarZero2Hero",
      url: "https://www.youtube.com/watch?v=EKG_xRtnDQw"
    },
    parts: {
      chorus: [
        ["Cadd9", shortStrum],
        ["D", shortStrum],
        ["G", "D-------D-----U---U-D---D---D-U-"],
        ["Cadd9", shortStrum],
        ["D", "D-------D-----"],
        ["E", "DUD-----DUD-"],
        ["Esus4", "U---"],
        ["E", "U---U-D-"],
        ["Esus4", "U-D-"],
        ["E", "U---U-"],
        ["Bm", ninePattern],
        ["C", ninePattern],
        ["D", transitionStrum],
        ["Asus2", transitionStrum + "D-------D-----U---U-D---D-------"]
      ]
    }
  }
];
export const rhythmMeterLabel = (meter: number, division: number) =>
  meter === 2 && division === 3 ? "6/8" : `${meter}/4`;
export const rhythmSymbols: Record<string, string> = {
  D: "↓",
  U: "↑",
  X: "×",
  B: "B",
  A: "B₂",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "-": "·"
};

const sourceSymbols = Object.fromEntries(
  Object.entries(rhythmSymbols).map(([symbol, display]) => [display, symbol])
);

function sourcePattern(
  preset: (typeof rhythms)[number],
  notation: string,
  picking: boolean,
  noteList = false
) {
  const expected = noteList ? preset.pattern.replace(/-/g, "") : preset.pattern;
  const actual = noteList ? notation.replace(/-/g, "") : notation;
  if (
    expected.length !== actual.length ||
    ![...expected].every(
      (symbol, index) =>
        symbol === actual[index] ||
        (picking && symbol === "B" && /[456]/.test(actual[index]))
    )
  )
    return;
  let index = 0;
  const pattern = noteList
    ? preset.pattern.replace(/[^-]/g, () => actual[index++])
    : actual;
  // Numeric strings are literal in the player; B chooses a chord's bass.
  return {
    ...preset,
    pattern,
    id: pattern === preset.pattern ? preset.id : ""
  };
}

const sourceRhythmLabel =
  /^(?:(?:рекомендуемый|рекомендую|гитарный)\s+)?(бой|бій|strumming(?: pattern)?|strum(?: pattern)?|batida|ritmo|перебор|арпеджіо|арпеджио|fingerpicking(?: pattern)?|picking(?: pattern)?|arpeggio)(?:\s+(?:песни|пісні))?(?:\s*[:\-\u2013\u2014]\s*|\s+|$)(.*)$/i;

export function sourceRhythm(text: string): SongRhythm | undefined {
  const lines = text.split(/\r?\n/);
  let selected: (typeof rhythms)[number] | undefined;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].trim().match(sourceRhythmLabel);
    if (!match) continue;
    let value = (
      match[2].trim() ||
      lines
        .slice(index + 1, index + 5)
        .find((line) => line.trim())
        ?.trim() ||
      ""
    )
      .replace(/[BБ]₂/gi, "A")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/ё/g, "е");
    const picking = /^(?:перебор|арпедж|fingerpicking|picking|arpeggio)/i.test(
      match[1]
    );
    const annotation = value.match(/^([^()]+)\(([^()]+)\)$/);
    if (annotation) value = annotation[1].trim();
    const label = /^(?:смотреть видео|дивитися відео|watch video)$/i.test(
      annotation?.[2].trim() ?? ""
    )
      ? undefined
      : annotation?.[2].trim();
    const catalog = (picking ? pickingPatterns : rhythms).filter(
      (preset) =>
        !label ||
        preset.aliases?.includes(label) ||
        rhythmMeterLabel(preset.meter, preset.division) === label
    );
    const directions: Record<string, string> = {
      вниз: "D",
      вверх: "U",
      down: "D",
      up: "U",
      глушение: "X",
      приглушение: "X",
      бас: "B",
      bass: "B"
    };
    const words = /вниз|вверх|down|up|(?:при)?глушение|бас|bass/gi;
    const writtenWords = words.test(value);
    const notation = value
      .replace(words, (word) => directions[word.toLowerCase()])
      .replace(/[↓↑×·]/g, (symbol) => sourceSymbols[symbol])
      .replace(writtenWords ? /[\s|,\-\u2013\u2014]/g : /[\s|]/g, "")
      .toUpperCase()
      .replace(/Б/g, "B");
    let matches = catalog.filter((rhythm) => rhythm.aliases?.includes(value));
    if (!matches.length)
      matches = catalog.flatMap(
        (preset) => sourcePattern(preset, notation, picking) ?? []
      );
    // An exact grid preserves rests. Only a plain stroke sequence or a
    // uniformly delimited picking list can borrow one known preset's timing.
    const noteList =
      !value.includes("·") &&
      (writtenWords ||
        !notation.includes("-") ||
        (picking && /^[BA1-6](?:-[BA1-6])+$/.test(notation)));
    if (!matches.length && noteList && /^[DUXBA1-6-]+$/.test(notation))
      matches = catalog.flatMap(
        (preset) => sourcePattern(preset, notation, picking, true) ?? []
      );
    if (
      matches.length !== 1 ||
      (selected &&
        (selected.pattern !== matches[0].pattern ||
          selected.meter !== matches[0].meter ||
          selected.division !== matches[0].division))
    )
      return;
    selected = matches[0];
  }
  if (selected)
    return {
      strum: selected.pattern,
      strumMeter: selected.meter,
      strumDivision: selected.division,
      strumPreset: selected.id
    };
}

export function sourceArrangement(text: string) {
  const sections = songSections(text);
  const general = sourceRhythm(sections[0].content);
  const groups = new Map<string, (SongRhythm | undefined)[]>();
  for (const section of sections.slice(1)) {
    if (!section.id) continue;
    const instructions = [
      section.title.match(/\(([^()]*)\)/)?.[1] ?? "",
      section.content
    ].join("\n");
    if (
      !instructions
        .split(/\r?\n/)
        .some((line) => sourceRhythmLabel.test(line.trim()))
    )
      continue;
    const setting = sourceRhythm(instructions);
    const group = groups.get(section.id);
    if (group) group.push(setting);
    else groups.set(section.id, [setting]);
  }
  const assignments = new Map<string, SongRhythm>();
  for (const [key, values] of groups) {
    const first = values[0];
    if (
      first &&
      values.every((value) => JSON.stringify(value) === JSON.stringify(first))
    )
      assignments.set(key, first);
  }
  const family = (id: string) =>
    id
      .replace(/\s*\([^()]*\)/g, "")
      .replace(/\s*\d+$/, "")
      .trim();
  const declared = [...assignments];
  for (const section of sections.slice(1)) {
    if (groups.has(section.id)) continue;
    const matches = declared
      .filter(([id]) => family(id) === family(section.id))
      .map(([, rhythm]) => rhythm);
    if (
      matches.length &&
      matches.every(
        (rhythm) => JSON.stringify(rhythm) === JSON.stringify(matches[0])
      )
    )
      assignments.set(section.id, matches[0]);
  }
  const rhythmSections = Object.fromEntries(assignments);
  if (general || Object.keys(rhythmSections).length)
    return {
      strum: "",
      strumMeter: 4 as const,
      strumDivision: 2,
      strumPreset: "",
      ...general,
      rhythmSections
    };
}

export const rhythmReference =
  "https://www.justinguitar.com/advanced_search?q=strum";
export const pickingReference =
  "https://www.andyguitar.co.uk/videos/introduction-to-fingerstyle";
