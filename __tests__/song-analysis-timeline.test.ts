import {
  activeInterval,
  chordDisplay,
  formatTime,
  parseTime,
  timelineAt
} from "../src/components/song-analysis/timeline";
import {
  SongAnalysis,
  validateSongAnalysis
} from "../src/components/song-analysis/types";

const analysis: SongAnalysis = {
  version: 1,
  duration: 28,
  language: "en",
  lyrics: [
    {
      start: 5.2,
      end: 11.75,
      text: "Stay here",
      words: [
        { start: 5.2, end: 9.3, text: "Stay" },
        { start: 10, end: 11.75, text: "here" }
      ]
    },
    {
      start: 22,
      end: 25,
      text: "Again",
      words: [{ start: 22, end: 25, text: "Again" }]
    }
  ],
  chords: [
    { start: 1.2, end: 3.45, label: "C" },
    { start: 3.45, end: 14.7, label: "Am" },
    { start: 18.9, end: 28, label: "F" }
  ],
  warnings: [],
  model: { lyrics: "test", alignment: "test", chords: "test" }
};

test("actual media position drives unequal chord durations and end-exclusive boundaries", () => {
  expect(timelineAt(analysis, 0)).toEqual({ line: -1, word: -1, chord: -1 });
  expect(timelineAt(analysis, 3449).chord).toBe(0);
  expect(timelineAt(analysis, 3450).chord).toBe(1);
  expect(timelineAt(analysis, 14700).chord).toBe(-1);
  expect(timelineAt(analysis, 18900).chord).toBe(2);
  expect(timelineAt(analysis, 28000)).toEqual({
    line: -1,
    word: -1,
    chord: -1
  });
});

test("intro, vocal gaps and instrumental interlude never fabricate an active word", () => {
  expect(timelineAt(analysis, 4000)).toEqual({ line: -1, word: -1, chord: 1 });
  expect(timelineAt(analysis, 9000)).toEqual({ line: 0, word: 0, chord: 1 });
  expect(timelineAt(analysis, 9500)).toEqual({ line: 0, word: -1, chord: 1 });
  expect(timelineAt(analysis, 20000)).toEqual({ line: -1, word: -1, chord: 2 });
});

test("pause, backward seek, A-B repeat and foreground resync depend only on supplied media clock", () => {
  const positions = [10000, 10000, 10000, 23000, 5200, 11000, 5200, 23000];
  expect(
    positions.map((position) => timelineAt(analysis, position).word)
  ).toEqual([1, 1, 1, 0, 0, 1, 0, 0]);
  expect(activeInterval([], 10)).toBe(-1);
  expect(activeInterval(analysis.chords, NaN)).toBe(-1);
  expect(activeInterval(analysis.chords, -10)).toBe(-1);
});

test("sounding original, transposed target and capo fingering remain distinct", () => {
  expect(chordDisplay("C/E", 2, 2)).toEqual({
    original: "C/E",
    target: "D/F#",
    fingering: "C/E"
  });
  expect(chordDisplay("Am", 0, 2)).toEqual({
    original: "Am",
    target: "Am",
    fingering: "Gm"
  });
  expect(chordDisplay("?", 3, 2)).toEqual({
    original: "?",
    target: "?",
    fingering: "?"
  });
  expect(chordDisplay("N", -2, 3)).toEqual({
    original: "N",
    target: "N",
    fingering: "N"
  });
});

test("time editing accepts localized decimal separator and carries rounded minute boundaries", () => {
  expect(parseTime(" 1:02,25 ")).toBe(62.25);
  expect(parseTime("62.25")).toBe(62.25);
  expect(formatTime(59.98)).toBe("1:00.0");
  expect(formatTime(125.3)).toBe("2:05.3");
  for (const invalid of ["1:60", "-1", "a:b", "1:2:3", "", "9".repeat(400)])
    expect(parseTime(invalid)).toBeNaN();
});

test("recognized extensions transpose even without a guitar shape while Harte bass degrees stay relative", () => {
  expect(chordDisplay("C11", 2, 1)).toEqual({
    original: "C11",
    target: "D11",
    fingering: "C#11"
  });
  expect(chordDisplay("C:maj(9,#11)/E", 2, 2)).toEqual({
    original: "C:maj(9,#11)/E",
    target: "D:maj(9,#11)/F#",
    fingering: "C:maj(9,#11)/E"
  });
  expect(chordDisplay("C:maj(9,#11)/3", 2, 3)).toEqual({
    original: "C:maj(9,#11)/3",
    target: "D:maj(9,#11)/3",
    fingering: "B:maj(9,#11)/3"
  });
  expect(chordDisplay("unrecognized", 2, 1)).toEqual({
    original: "unrecognized",
    target: "unrecognized",
    fingering: "unrecognized"
  });
});

test("ambiguous overlapping intervals are rejected rather than clipped to fit binary lookup", () => {
  const chords = JSON.parse(JSON.stringify(analysis)) as SongAnalysis;
  chords.chords[0].end = 4;
  expect(() => validateSongAnalysis(chords)).toThrow("AnalysisInvalid");
  const words = JSON.parse(JSON.stringify(analysis)) as SongAnalysis;
  words.lyrics[0].words[0].end = 10.5;
  expect(() => validateSongAnalysis(words)).toThrow("AnalysisInvalid");
  const lines = JSON.parse(JSON.stringify(analysis)) as SongAnalysis;
  lines.lyrics[0].end = 23;
  expect(() => validateSongAnalysis(lines)).toThrow("AnalysisInvalid");
});
