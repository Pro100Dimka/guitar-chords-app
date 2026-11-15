export const rhythms: {
  id: string;
  title: string;
  pattern: string;
  meter: 3 | 4;
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
    pattern: "D-DU-UD-D-DU--D-",
    meter: 4,
    division: 2
  }
];
export const rhythmSymbols: Record<string, string> = {
  D: "↓",
  U: "↑",
  X: "×",
  B: "B",
  "-": "·"
};

const sourceSymbols = Object.fromEntries(
  Object.entries(rhythmSymbols).map(([symbol, display]) => [display, symbol])
);

export function sourceRhythm(text: string) {
  const lines = text.split(/\r?\n/);
  let selected: (typeof rhythms)[number] | undefined;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]
      .trim()
      .match(
        /^(?:бой|бій|strumming(?: pattern)?|strum(?: pattern)?|batida|ritmo)(?:\s*[:\-\u2013\u2014]\s*|\s+|$)(.*)$/i
      );
    if (!match) continue;
    const value = (match[1].trim() || lines[index + 1]?.trim() || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/ё/g, "е");
    const notation = value
      .replace(/[↓↑×·]/g, (symbol) => sourceSymbols[symbol])
      .replace(/[\s|]/g, "")
      .toUpperCase();
    let matches = rhythms.filter(
      (rhythm) => rhythm.pattern === notation || rhythm.aliases?.includes(value)
    );
    if (!matches.length && /^[DUXB]+$/.test(notation))
      matches = rhythms.filter(
        (rhythm) => rhythm.pattern.replace(/-/g, "") === notation
      );
    if (matches.length !== 1 || (selected && selected.id !== matches[0].id))
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

export const rhythmReference =
  "https://www.justinguitar.com/advanced_search?q=strum";
