import {
  emptyTablature,
  legacyTablatureText,
  normalizeTablature,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  tabBarTicks,
  tabBeatTicks,
  tablatureLength,
  tablatureText
} from "../src/components/tablature";

const example = () => ({
  ...emptyTablature(),
  notes: [
    { string: 0, fret: 0, tick: 0, duration: 24 },
    { string: 5, fret: 12, tick: 0, duration: 48 },
    { string: 2, fret: 7, tick: 36, duration: 12 }
  ]
});

test("normalization copies, orders and merges identical string onsets", () => {
  const input = {
    ...emptyTablature(),
    notes: [
      { string: 5, fret: 12, tick: 24, duration: 12 },
      { string: 0, fret: 0, tick: 0, duration: 48 },
      { string: 1, fret: 3, tick: 24, duration: 8 },
      { string: 5, fret: 14, tick: 24, duration: 6 }
    ]
  };
  const original = JSON.stringify(input);
  const result = normalizeTablature(input)!;
  expect(result.notes).toEqual([
    { string: 0, fret: 0, tick: 0, duration: 48 },
    { string: 1, fret: 3, tick: 24, duration: 8 },
    { string: 5, fret: 14, tick: 24, duration: 6 }
  ]);
  expect(JSON.stringify(input)).toBe(original);
  result.notes[0].fret = 9;
  expect(input.notes[1].fret).toBe(0);
});

test("migrates v1 with quarter durations, clipped reattacks and the original final bar", () => {
  const old = {
    version: 1,
    tempo: 80,
    beatsPerBar: 4,
    notes: [
      { string: 0, fret: 0, tick: 0 },
      { string: 0, fret: 3, tick: 8 },
      { string: 5, fret: 7, tick: 95 }
    ]
  };
  const result = normalizeTablature(old)!;
  expect(result).toEqual({
    ...emptyTablature(),
    notes: [
      { string: 0, fret: 0, tick: 0, duration: 8 },
      { string: 0, fret: 3, tick: 8, duration: 24 },
      { string: 5, fret: 7, tick: 95, duration: 1 }
    ]
  });
  expect(tablatureLength(result)).toBe(96);
  expect(normalizeTablature(result)).toEqual(result);
  expect(old.notes[0]).not.toHaveProperty("duration");
});

test.each([
  null,
  [],
  {},
  { ...example(), version: 3 },
  { ...example(), tempo: 39 },
  { ...example(), tempo: 201 },
  { ...example(), tempo: 80.5 },
  { ...example(), tempo: "80" },
  { ...example(), beatsPerBar: 0 },
  { ...example(), beatsPerBar: 9 },
  { ...example(), beatsPerBar: 3.5 },
  { ...example(), beatUnit: 16 },
  { ...example(), beatUnit: "4" },
  { ...example(), barCount: 0 },
  { ...example(), barCount: 129 },
  { ...example(), barCount: 1.5 },
  { ...example(), notes: {} },
  { ...example(), notes: new Array(2) },
  { ...example(), rests: null }
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
  { tick: TAB_MAX_BARS * 4 * TAB_TICKS_PER_BEAT },
  { duration: 0 },
  { duration: -1 },
  { duration: 0.5 },
  { duration: null },
  { duration: Number.NaN },
  { duration: TAB_MAX_BARS * 4 * TAB_TICKS_PER_BEAT + 1 }
])("rejects the entire document when one note is invalid: %j", (patch) => {
  expect(
    normalizeTablature({
      ...example(),
      notes: [...example().notes, { string: 0, fret: 0, tick: 0, ...patch }]
    })
  ).toBeUndefined();
});

test("enforces the combined event limit before deduplication", () => {
  const repeated = Array.from({ length: TAB_MAX_NOTES }, () => ({
    string: 0,
    fret: 0,
    tick: 0
  }));
  expect(
    normalizeTablature({
      ...emptyTablature(),
      notes: [...repeated, repeated[0]]
    })
  ).toBeUndefined();
  expect(
    normalizeTablature({
      ...emptyTablature(),
      notes: repeated,
      rests: [{ tick: 24, duration: 12 }]
    })
  ).toBeUndefined();
});

test("accepts inclusive pitch bounds and the final tick with a bounded release", () => {
  const tab = {
    ...emptyTablature(200, 8),
    barCount: TAB_MAX_BARS,
    notes: [
      { string: 0, fret: 0, tick: 0, duration: 24 },
      {
        string: 5,
        fret: 24,
        tick: TAB_MAX_BARS * 8 * TAB_TICKS_PER_BEAT - 1,
        duration: 1
      }
    ]
  };
  expect(normalizeTablature(tab)).toEqual(tab);
  expect(tablatureLength(tab)).toBe(TAB_MAX_BARS * 8 * TAB_TICKS_PER_BEAT);
  expect(
    normalizeTablature({ ...tab, notes: [{ ...tab.notes[1], duration: 2 }] })
  ).toBeUndefined();
});

test("length includes releases, rests and deliberately empty final bars", () => {
  expect(tablatureLength(emptyTablature(80, 3))).toBe(72);
  expect(tablatureLength(example())).toBe(96);
  expect(
    tablatureLength({
      ...emptyTablature(),
      notes: [{ string: 0, fret: 3, tick: 90, duration: 24 }]
    })
  ).toBe(192);
  expect(
    tablatureLength({
      ...emptyTablature(),
      notes: [],
      rests: [{ tick: 96, duration: 96 }]
    })
  ).toBe(192);
  expect(tablatureLength({ ...example(), barCount: 4 })).toBe(384);
  expect(
    normalizeTablature({
      ...emptyTablature(),
      notes: [{ string: 0, fret: 3, tick: 90, duration: 24 }]
    })?.barCount
  ).toBe(2);
});

test("6/8 counts eighth beats while quarter-based tick durations remain stable", () => {
  const tab = emptyTablature(90, 6, 8);
  expect(tabBeatTicks(tab)).toBe(12);
  expect(tabBarTicks(tab)).toBe(72);
  expect(tablatureLength(tab)).toBe(72);
  expect(
    normalizeTablature({
      ...tab,
      notes: [{ string: 0, fret: 0, tick: 66, duration: 12 }]
    })?.barCount
  ).toBe(2);
});

test("rests reject malformed and overlapping silence, including note sustain", () => {
  for (const rests of [
    [{ tick: 0, duration: 0 }],
    [{ tick: 0.5, duration: 12 }],
    [
      { tick: 0, duration: 12 },
      { tick: 6, duration: 12 }
    ],
    [{ tick: 24, duration: 12 }],
    [{ tick: 0, duration: TAB_MAX_BARS * 96 + 1 }]
  ])
    expect(normalizeTablature({ ...example(), rests })).toBeUndefined();
  expect(
    normalizeTablature({ ...example(), rests: [{ tick: 48, duration: 24 }] })
      ?.rests
  ).toEqual([{ tick: 48, duration: 24 }]);
});

test("a same-string reattack clips the sounding tail when validating rests", () => {
  const notes = [
    { string: 0, fret: 0, tick: 0, duration: 96 },
    { string: 0, fret: 3, tick: 12, duration: 12 }
  ];
  expect(
    normalizeTablature({
      ...emptyTablature(),
      notes,
      rests: [{ tick: 24, duration: 24 }]
    })?.notes
  ).toEqual(notes);
  expect(
    normalizeTablature({
      ...emptyTablature(),
      notes: [{ ...notes[0], string: 1 }, notes[1]],
      rests: [{ tick: 24, duration: 24 }]
    })
  ).toBeUndefined();
});

test("preview keeps aligned strings and prints exact dotted, triplet and rest values", () => {
  const text = tablatureText({
    ...emptyTablature(),
    notes: [
      { string: 0, fret: 0, tick: 0, duration: 36 },
      { string: 5, fret: 12, tick: 0, duration: 16 },
      { string: 2, fret: 7, tick: 36, duration: 12 }
    ],
    rests: [{ tick: 48, duration: 24 }]
  });
  const lines = text.split("\n").filter((line) => /^[eBGDAE]\|/.test(line));
  expect(lines).toHaveLength(6);
  expect(lines.map((line) => line[0])).toEqual(["e", "B", "G", "D", "A", "E"]);
  expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  expect(lines[0].indexOf("12")).toBe(lines[5].indexOf("0"));
  expect(lines[3].indexOf("7")).toBeGreaterThan(lines[5].indexOf("0"));
  expect(text).toContain("80 BPM");
  expect(text).toContain("E0@1=3/8");
  expect(text).toContain("e12@1=1/6");
  expect(text).toContain("D7@2+1/2=1/8");
  expect(text).toContain("R@3=1/4");
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
      ),
      duration: 1
    }))
  };
  const text = tablatureText(tab);
  expect(
    text.split("\n").filter((line) => /^[eBGDAE]\|/.test(line))
  ).toHaveLength(TAB_MAX_BARS * 6);
  expect(text.length).toBeLessThan(200000);
});

test("legacy preview still exactly recognizes old generated song content", () => {
  const tab = normalizeTablature({
    version: 1,
    tempo: 80,
    beatsPerBar: 4,
    notes: [{ string: 0, fret: 3, tick: 0 }]
  })!;
  expect(legacyTablatureText(tab)).toBe(
    [
      "TAB · 80 BPM · 4/4",
      "",
      "1",
      "e|------------|",
      "B|------------|",
      "G|------------|",
      "D|------------|",
      "A|------------|",
      "E|3-----------|"
    ].join("\n")
  );
  expect(
    legacyTablatureText({
      ...tab,
      beatUnit: 8,
      barCount: 4,
      rests: [{ tick: 24, duration: 12 }]
    })
  ).toBe(legacyTablatureText(tab));
});

test("empty constructors validate defaults and text refuses invalid input", () => {
  expect(emptyTablature(Number.NaN, 0)).toEqual(emptyTablature());
  expect(normalizeTablature(emptyTablature())).toEqual(emptyTablature());
  expect(tablatureText({ ...example(), tempo: Number.POSITIVE_INFINITY })).toBe(
    ""
  );
});
