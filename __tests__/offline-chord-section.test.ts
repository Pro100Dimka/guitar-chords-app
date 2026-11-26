import {
  chordSection,
  parseChordRange
} from "../src/components/offline-chord-section";
import {
  chordTime,
  offlineChordDraft,
  type OfflineChordAnalysis
} from "../src/components/offline-chords";
import { songChords } from "../src/screens/song/chords";

const result: OfflineChordAnalysis = {
  engine: "chroma-v2",
  duration: 10,
  fileName: "Section.wav",
  elapsedMs: 100,
  key: "C",
  tempo: 120,
  segments: [
    { start: 0, end: 1, chord: "N", confidence: 0 },
    { start: 1, end: 4, chord: "C", confidence: 0.8 },
    { start: 5, end: 8, chord: "Em", confidence: 0.7 },
    { start: 8, end: 10, chord: "Am", confidence: 0.9 }
  ]
};

test("a section retains absolute source times and distinguishes missing data from N", () => {
  const original = JSON.stringify(result);
  const section = chordSection(result, { start: 0.5, end: 6 });
  expect(section.rows).toEqual([
    {
      ...result.segments[0],
      kind: "chord",
      start: 0.5,
      sourceStart: 0,
      sourceEnd: 1,
      startClipped: true,
      endClipped: false
    },
    {
      ...result.segments[1],
      kind: "chord",
      sourceStart: 1,
      sourceEnd: 4,
      startClipped: false,
      endClipped: false
    },
    { kind: "gap", start: 4, end: 5 },
    {
      ...result.segments[2],
      kind: "chord",
      end: 6,
      sourceStart: 5,
      sourceEnd: 8,
      startClipped: false,
      endClipped: true
    }
  ]);
  expect(section.unknownSeconds).toBe(0.5);
  expect(section.missingSeconds).toBe(1);
  expect(JSON.stringify(result)).toBe(original);
});

test("half-open selection excludes chords that only touch its boundaries", () => {
  const section = chordSection(result, { start: 4, end: 5 });
  expect(section.rows).toEqual([{ kind: "gap", start: 4, end: 5 }]);
  expect(section.unknownSeconds).toBe(0);
  expect(section.missingSeconds).toBe(1);
  expect(chordSection(result, { start: 5, end: 8 }).rows).toEqual([
    expect.objectContaining({
      chord: "Em",
      start: 5,
      end: 8,
      startClipped: false,
      endClipped: false
    })
  ]);
});

test("empty predictions and recording-edge gaps stay visible", () => {
  expect(chordSection({ ...result, segments: [] }).rows).toEqual([
    { kind: "gap", start: 0, end: 10 }
  ]);
  const section = chordSection({ ...result, segments: [result.segments[2]] });
  expect(section.rows[0]).toEqual({ kind: "gap", start: 0, end: 5 });
  expect(section.rows[2]).toEqual({ kind: "gap", start: 8, end: 10 });
  expect(section.missingSeconds).toBe(7);
});

test("native rounding overlap does not double-count time or emit an empty row", () => {
  const rounded: OfflineChordAnalysis = {
    ...result,
    segments: [
      { start: 0, end: 5, chord: "N", confidence: 0 },
      { start: 4.9995, end: 10, chord: "C", confidence: 0.8 }
    ]
  };
  const section = chordSection(rounded);
  expect(section.rows.map((row) => [row.start, row.end])).toEqual([
    [0, 5],
    [5, 10]
  ]);
  expect(section.unknownSeconds).toBe(5);
  expect(section.missingSeconds).toBe(0);
  expect(section.rows[1]).toMatchObject({
    sourceStart: 4.9995,
    startClipped: false,
    endClipped: false
  });
  expect(chordSection(rounded, { start: 0, end: 5 }).rows).toHaveLength(1);
});

test.each([
  [" 2.5 ", "0:09,125", 2.5, 9.125],
  ["0:02.500", "9", 2.5, 9],
  ["0", "0:10.000", 0, 10]
])(
  "time input %s–%s is an absolute recording interval",
  (from, to, start, end) => {
    expect(parseChordRange(String(from), String(to), 10)).toEqual({
      start,
      end
    });
  }
);

test.each([
  ["", "4"],
  ["-1", "4"],
  ["+1", "4"],
  ["NaN", "4"],
  ["1e0", "4"],
  ["1:60", "90"],
  ["1:00:00", "90"],
  ["1.0001", "4"],
  ["4", "4"],
  ["5", "4"],
  ["0", "10.001"],
  ["0", "Infinity"]
])("rejects invalid or out-of-range input %s–%s", (from, to) => {
  expect(parseChordRange(from, to, 10)).toBeNull();
});

test.each([276.456813, 6.004, 6.006, 70.0395, 70.0405, 130.1295])(
  "a displayed end time includes the exact recording tail: %s",
  (duration) => {
    expect(parseChordRange("0", chordTime(duration), duration)).toEqual({
      start: 0,
      end: duration
    });
  }
);

test("selection rejects non-finite or inverted boundaries even when called without text input", () => {
  for (const range of [
    { start: NaN, end: 4 },
    { start: 0, end: Infinity },
    { start: -1, end: 4 },
    { start: 4, end: 4 },
    { start: 6, end: 4 },
    { start: 0, end: 11 }
  ])
    expect(() => chordSection(result, range)).toThrow("InvalidChordSection");
});

test("a section export preserves gaps and clipping without importing unrelated chords", () => {
  const draft = offlineChordDraft(result, "Audio", "Estimate", "Undetermined", {
    range: { start: 3, end: 6 },
    missingLabel: "Missing prediction",
    rangeNotice: "Selected: 0:03.00–0:06.00; absolute recording times",
    boundaryNotice: "* = clipped to selection; not a detected chord change"
  });
  expect(draft.title).toBe("Section (0:03.00–0:06.00)");
  expect(draft.content).toBe(
    "Estimate\n" +
      "Selected: 0:03.00–0:06.00; absolute recording times\n" +
      "* = clipped to selection; not a detected chord change\n\n" +
      "[C] 0:03.00–0:04.00 *\n" +
      "Missing prediction 0:04.00–0:05.00\n" +
      "[Em] 0:05.00–0:06.00 *"
  );
  expect(songChords(draft.content!)).toEqual(["C", "Em"]);
  expect(draft.content).not.toContain("Undetermined");
  expect(draft.content).not.toContain("[Am]");
});
