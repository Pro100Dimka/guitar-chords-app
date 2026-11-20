import {
  emptyTablature,
  normalizeTablature,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  tablatureLength,
  tablatureText
} from "../src/components/tablature";

const example = () => ({
  ...emptyTablature(),
  notes: [
    { string: 0, fret: 0, tick: 0 },
    { string: 5, fret: 12, tick: 0 },
    { string: 2, fret: 7, tick: 36 }
  ]
});

test("normalization copies, orders and merges identical string onsets", () => {
  const input = {
    ...emptyTablature(),
    notes: [
      { string: 5, fret: 12, tick: 24 },
      { string: 0, fret: 0, tick: 0 },
      { string: 1, fret: 3, tick: 24 },
      { string: 5, fret: 14, tick: 24 }
    ]
  };
  const original = JSON.stringify(input);
  const result = normalizeTablature(input)!;
  expect(result.notes).toEqual([
    { string: 0, fret: 0, tick: 0 },
    { string: 1, fret: 3, tick: 24 },
    { string: 5, fret: 14, tick: 24 }
  ]);
  expect(JSON.stringify(input)).toBe(original);
  result.notes[0].fret = 9;
  expect(input.notes[1].fret).toBe(0);
});

test.each([
  null,
  [],
  {},
  { ...example(), version: 2 },
  { ...example(), tempo: 39 },
  { ...example(), tempo: 201 },
  { ...example(), tempo: 80.5 },
  { ...example(), tempo: "80" },
  { ...example(), beatsPerBar: 0 },
  { ...example(), beatsPerBar: 9 },
  { ...example(), beatsPerBar: 3.5 },
  { ...example(), notes: {} },
  { ...example(), notes: new Array(2) }
])("rejects a damaged document (%#)", (value) => {
  expect(normalizeTablature(value)).toBeUndefined();
});

test.each([
  { string: -1 },
  { string: 6 },
  { string: 1.5 },
  { fret: -1 },
  { fret: 25 },
  { fret: 2.5 },
  { tick: -1 },
  { tick: 0.5 },
  { tick: Number.NaN },
  { tick: Number.POSITIVE_INFINITY },
  { tick: TAB_MAX_BARS * 4 * TAB_TICKS_PER_BEAT }
])("rejects the entire document when one note is invalid: %j", (patch) => {
  expect(
    normalizeTablature({
      ...example(),
      notes: [...example().notes, { string: 0, fret: 0, tick: 0, ...patch }]
    })
  ).toBeUndefined();
});

test("enforces the note limit before deduplication", () => {
  expect(
    normalizeTablature({
      ...emptyTablature(),
      notes: Array.from({ length: TAB_MAX_NOTES + 1 }, () => ({
        string: 0,
        fret: 0,
        tick: 0
      }))
    })
  ).toBeUndefined();
});

test("accepts inclusive pitch bounds and the final tick of the final bar", () => {
  const tab = {
    ...emptyTablature(200, 8),
    notes: [
      { string: 0, fret: 0, tick: 0 },
      { string: 5, fret: 24, tick: TAB_MAX_BARS * 8 * TAB_TICKS_PER_BEAT - 1 }
    ]
  };
  expect(normalizeTablature(tab)).toEqual(tab);
  expect(tablatureLength(tab)).toBe(TAB_MAX_BARS * 8 * TAB_TICKS_PER_BEAT);
});

test("length includes a complete final bar and works before notes are sorted", () => {
  expect(tablatureLength(emptyTablature(80, 3))).toBe(72);
  expect(tablatureLength(example())).toBe(96);
  expect(
    tablatureLength({
      ...emptyTablature(),
      notes: [
        { string: 0, fret: 3, tick: 96 },
        { string: 0, fret: 0, tick: 0 }
      ]
    })
  ).toBe(192);
});

test("preview uses six aligned strings with high e first and keeps simultaneous notes", () => {
  const text = tablatureText(example());
  const lines = text.split("\n").filter((line) => /^[eBGDAE]\|/.test(line));
  expect(lines).toHaveLength(6);
  expect(lines.map((line) => line[0])).toEqual(["e", "B", "G", "D", "A", "E"]);
  expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  expect(lines[0].indexOf("12")).toBe(lines[5].indexOf("0"));
  expect(lines[3].indexOf("7")).toBeGreaterThan(lines[5].indexOf("0"));
  expect(text).toContain("80 BPM");
});

test("preview includes empty bars and remains within song content bounds at capacity", () => {
  const tab = {
    ...emptyTablature(80, 8),
    notes: Array.from({ length: TAB_MAX_NOTES }, (_, index) => ({
      string: index % 6,
      fret: index % 25,
      tick: Math.floor(
        (index * (TAB_MAX_BARS * 8 * TAB_TICKS_PER_BEAT - 1)) /
          (TAB_MAX_NOTES - 1)
      )
    }))
  };
  const text = tablatureText(tab);
  expect(
    text.split("\n").filter((line) => /^[eBGDAE]\|/.test(line))
  ).toHaveLength(TAB_MAX_BARS * 6);
  expect(text.length).toBeLessThan(70000);
});

test("empty constructors validate defaults and text refuses invalid input", () => {
  expect(emptyTablature(Number.NaN, 0)).toEqual(emptyTablature());
  expect(normalizeTablature(emptyTablature())).toEqual(emptyTablature());
  expect(tablatureText({ ...example(), tempo: Number.POSITIVE_INFINITY })).toBe(
    ""
  );
});
