export const rhythms: {
  id: string;
  title: string;
  pattern: string;
  meter: 3 | 4;
  division: number;
}[] = [
  { id: "six", title: "RhythmSix", pattern: "D-DU-UDU", meter: 4, division: 2 },
  {
    id: "quarter",
    title: "RhythmQuarter",
    pattern: "D-D-D-D-",
    meter: 4,
    division: 2
  },
  {
    id: "eighth",
    title: "RhythmEighth",
    pattern: "DUDUDUDU",
    meter: 4,
    division: 2
  },
  {
    id: "muted",
    title: "RhythmMuted",
    pattern: "D-XUD-XU",
    meter: 4,
    division: 2
  },
  {
    id: "five",
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
export const rhythmReference =
  "https://www.justinguitar.com/advanced_search?q=strum";
