export const rhythms = [
  { id: "quarter", title: "RhythmQuarter", pattern: "D-D-D-D-", meter: 4 },
  { id: "eighth", title: "RhythmEighth", pattern: "DUDUDUDU", meter: 4 },
  { id: "six", title: "RhythmSix", pattern: "D-DU-UDU", meter: 4 },
  { id: "five", title: "RhythmFive", pattern: "D-DU-UD-", meter: 4 },
  { id: "half", title: "RhythmHalf", pattern: "D---D---", meter: 4 },
  { id: "offbeat", title: "RhythmOffbeat", pattern: "-U-U-U-U", meter: 4 },
  { id: "waltz", title: "RhythmWaltz", pattern: "D-D-D-", meter: 3 },
  { id: "muted", title: "RhythmMuted", pattern: "D-XUD-XU", meter: 4 }
] as const;
export const rhythmSymbols: Record<string, string> = {
  D: "↓",
  U: "↑",
  X: "×",
  "-": "·"
};
export const rhythmReference =
  "https://www.fender.com/articles/techniques/understanding-the-eighth-note";
