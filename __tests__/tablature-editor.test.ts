import {
  emptyTablature,
  normalizeTablature,
  TAB_MAX_NOTES,
  Tablature
} from "../src/components/tablature";
import {
  changeTabMeter,
  tabBarCoverage,
  copyTabSelection,
  deleteTabSelection,
  pasteTabSelection,
  copyTabBar,
  deleteTabBar,
  durationLabel,
  durationTicks,
  insertTabBar,
  pasteTabBar,
  putTabNote,
  putTabRest
} from "../src/screens/play/tablature-editor";

const score = (patch: Partial<Tablature> = {}) =>
  normalizeTablature({ ...emptyTablature(), ...patch })!;

test("inserting and moving notes never overwrites an occupied string onset", () => {
  const tab = score({ notes: [{ string: 5, fret: 3, tick: 0, duration: 12 }] });
  const original = JSON.stringify(tab);
  const inserted = putTabNote(tab, {
    string: 5,
    fret: 5,
    tick: 12,
    duration: 6
  });
  expect(inserted.tab?.notes).toHaveLength(2);
  expect(
    putTabNote(tab, { string: 5, fret: 5, tick: 0, duration: 6 }).error
  ).toBe("TabNoteCollision");
  expect(
    putTabNote(
      inserted.tab!,
      { string: 5, fret: 5, tick: 0, duration: 6 },
      { string: 5, tick: 12 }
    ).error
  ).toBe("TabNoteCollision");
  expect(JSON.stringify(tab)).toBe(original);
});

test("rests require silence across all strings and retain their exact duration", () => {
  const tab = score({
    notes: [{ string: 5, fret: 3, tick: 24, duration: 12 }]
  });
  const inserted = putTabRest(tab, { tick: 0, duration: 12 });
  expect(inserted.tab?.rests).toEqual([{ tick: 0, duration: 12 }]);
  expect(putTabRest(tab, { tick: 18, duration: 12 }).error).toBe(
    "TabRestCollision"
  );
  expect(
    putTabNote(inserted.tab!, { string: 0, fret: 3, tick: 6, duration: 6 })
      .error
  ).toBe("TabRestCollision");
  expect(
    putTabRest(inserted.tab!, { tick: 6, duration: 12 }, 0).tab?.rests
  ).toEqual([{ tick: 6, duration: 12 }]);
});

test("dotted and triplet note values are exact quarter-note ticks", () => {
  expect(durationTicks(4)).toBe(24);
  expect(durationTicks(16, "dotted")).toBe(9);
  expect(durationTicks(8, "triplet")).toBe(8);
  expect(durationTicks(16, "triplet")).toBe(4);
  expect(durationLabel(36)).toBe("1/4.");
  expect(durationLabel(8)).toBe("1/8 ×⅔");
});

test("inserting an empty bar shifts later events and cuts earlier sustain", () => {
  const tab = score({
    barCount: 2,
    notes: [
      { string: 5, fret: 3, tick: 72, duration: 48 },
      { string: 0, fret: 5, tick: 120, duration: 12 }
    ],
    rests: [{ tick: 144, duration: 12 }]
  });
  const inserted = insertTabBar(tab, 1).tab!;
  expect(inserted.barCount).toBe(3);
  expect(inserted.notes).toEqual([
    { string: 5, fret: 3, tick: 72, duration: 24 },
    { string: 0, fret: 5, tick: 216, duration: 12 }
  ]);
  expect(inserted.rests).toEqual([{ tick: 240, duration: 12 }]);
  expect(tab.notes[0].duration).toBe(48);
});

test("copy and duplicate crop attacks at the bar boundary, preserving later bars", () => {
  const tab = score({
    barCount: 2,
    notes: [
      { string: 5, fret: 7, tick: 72, duration: 48 },
      { string: 0, fret: 2, tick: 144, duration: 24 }
    ]
  });
  const copied = copyTabBar(tab, 0);
  expect(copied.notes).toEqual([
    { string: 5, fret: 7, tick: 72, duration: 24 }
  ]);
  const duplicate = insertTabBar(tab, 1, copied).tab!;
  expect(duplicate.notes).toEqual([
    { string: 5, fret: 7, tick: 72, duration: 24 },
    { string: 5, fret: 7, tick: 168, duration: 24 },
    { string: 0, fret: 2, tick: 240, duration: 24 }
  ]);
  expect(duplicate.barCount).toBe(3);
});

test("deleting bars keeps later timing relative and leaves one empty bar at minimum", () => {
  const tab = score({
    barCount: 3,
    notes: [
      { string: 5, fret: 3, tick: 72, duration: 48 },
      { string: 0, fret: 5, tick: 144, duration: 24 },
      { string: 3, fret: 2, tick: 216, duration: 24 }
    ]
  });
  const deleted = deleteTabBar(tab, 1).tab!;
  expect(deleted.barCount).toBe(2);
  expect(deleted.notes).toEqual([
    { string: 5, fret: 3, tick: 72, duration: 24 },
    { string: 3, fret: 2, tick: 120, duration: 24 }
  ]);
  expect(
    deleteTabBar(
      score({ notes: [{ string: 0, fret: 0, tick: 0, duration: 24 }] }),
      0
    ).tab
  ).toEqual(emptyTablature());
});

test("pasting replaces only the chosen bar without shifting subsequent attacks", () => {
  const tab = score({
    barCount: 3,
    notes: [
      { string: 0, fret: 3, tick: 0, duration: 12 },
      { string: 5, fret: 7, tick: 96, duration: 24 },
      { string: 3, fret: 2, tick: 216, duration: 24 }
    ],
    rests: [{ tick: 24, duration: 12 }]
  });
  const pasted = pasteTabBar(tab, 1, copyTabBar(tab, 0)).tab!;
  expect(pasted.barCount).toBe(3);
  expect(pasted.notes).toEqual([
    { string: 0, fret: 3, tick: 0, duration: 12 },
    { string: 0, fret: 3, tick: 96, duration: 12 },
    { string: 3, fret: 2, tick: 216, duration: 24 }
  ]);
  expect(pasted.rests).toEqual([
    { tick: 24, duration: 12 },
    { tick: 120, duration: 12 }
  ]);
});

test("meter changes keep absolute timing, trailing silence, and reject excessive length", () => {
  const tab = score({
    barCount: 2,
    notes: [{ string: 3, fret: 2, tick: 96, duration: 24 }]
  });
  const changed = changeTabMeter(tab, 6, 8).tab!;
  expect(changed).toMatchObject({
    beatsPerBar: 6,
    beatUnit: 8,
    barCount: 3,
    notes: tab.notes
  });
  expect(changeTabMeter(score({ barCount: 128 }), 6, 8).error).toBe(
    "TabEditLimit"
  );
  expect(pasteTabBar(changed, 0, copyTabBar(tab, 0)).error).toBe(
    "TabClipboardMeter"
  );
});

test("combined note and rest capacity reports a limit without changing the source", () => {
  const tab = score({
    notes: Array.from({ length: TAB_MAX_NOTES }, (_, index) => ({
      string: 0,
      fret: 0,
      tick: index * 2,
      duration: 1
    }))
  });
  expect(putTabRest(tab, { tick: 4096, duration: 1 }).error).toBe(
    "TabEditLimit"
  );
  expect(tab.notes).toHaveLength(TAB_MAX_NOTES);
  expect(insertTabBar(score({ barCount: 128 }), 128).error).toBe(
    "TabEditLimit"
  );
});

test("duplet and triplet durations fit their distinct rhythmic ratios", () => {
  expect(durationTicks(8, "duplet")).toBe(18);
  expect(durationTicks(8, "triplet")).toBe(8);
  const duplet = putTabNote(score(), {
    string: 5,
    fret: 3,
    tick: 0,
    duration: 18,
    tuplet: { actual: 2, normal: 3, denominator: 8 }
  });
  expect(duplet.tab?.notes[0].tuplet).toEqual({
    actual: 2,
    normal: 3,
    denominator: 8
  });
});

test.each([
  [2, 2],
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [12, 8]
] as const)(
  "approved time signature %s/%s preserves notes and remains serializable",
  (beats, unit) => {
    const original = score({
      notes: [{ string: 5, fret: 3, tick: 0, duration: 12 }]
    });
    const changed = changeTabMeter(original, beats, unit).tab!;
    expect(changed.notes).toEqual(original.notes);
    expect(normalizeTablature(JSON.parse(JSON.stringify(changed)))).toEqual(
      changed
    );
  }
);

test("bar coverage counts a six-string chord once and distinguishes missing duration from overflow", () => {
  const full = score({
    notes: Array.from({ length: 6 }, (_, string) => ({
      string,
      fret: 0,
      tick: 0,
      duration: 96
    }))
  });
  expect(tabBarCoverage(full, 0)).toEqual({
    covered: 96,
    expected: 96,
    overflow: false
  });
  expect(
    tabBarCoverage(
      score({ notes: [{ string: 5, fret: 3, tick: 0, duration: 24 }] }),
      0
    ).covered
  ).toBe(24);
  expect(
    tabBarCoverage(
      score({ notes: [{ string: 5, fret: 3, tick: 72, duration: 48 }] }),
      0
    ).overflow
  ).toBe(true);
});

test("a tied string cannot hide overflow from a different string in the same chord", () => {
  const tab = score({
    version: 3,
    notes: [
      { string: 0, fret: 3, tick: 72, duration: 48, tie: true },
      { string: 1, fret: 5, tick: 72, duration: 48 }
    ]
  });
  expect(tabBarCoverage(tab, 0).overflow).toBe(true);
  expect(
    tabBarCoverage({ ...tab, notes: [tab.notes[0]] }, 0).overflow
  ).toBe(false);
});

test("deleting a chord pitch retains the other strings and adds no global rest", () => {
  const tab = score({
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 24 },
      { string: 4, fret: 2, tick: 0, duration: 24 }
    ]
  });
  const next = deleteTabSelection(tab, [tab.notes[1]]).tab!;
  expect(next.notes).toEqual([tab.notes[0]]);
  expect(next.rests).toEqual([]);
});

test("deleting the last pitch fills only the silence not occupied by another sustaining string", () => {
  const tab = score({
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 48 },
      { string: 4, fret: 2, tick: 0, duration: 24 }
    ]
  });
  const next = deleteTabSelection(tab, [tab.notes[1]]).tab!;
  expect(next.rests).toEqual([{ tick: 24, duration: 24 }]);
  expect(next.notes).toEqual([tab.notes[0]]);
  expect(tab.notes).toHaveLength(2);
});

test("range deletion preserves later events, existing pauses and total bar count", () => {
  const tab = score({
    barCount: 2,
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 12 },
      { string: 5, fret: 5, tick: 24, duration: 24 },
      { string: 0, fret: 0, tick: 96, duration: 24 }
    ],
    rests: [{ tick: 12, duration: 12 }]
  });
  const next = deleteTabSelection(tab, tab.notes.slice(0, 2), {
    start: 0,
    end: 48
  }).tab!;
  expect(next.notes).toEqual([tab.notes[2]]);
  expect(next.barCount).toBe(2);
  expect(tabBarCoverage(next, 0).covered).toBe(48);
  expect(next.rests!.reduce((sum, rest) => sum + rest.duration, 0)).toBe(48);
});

test("selection clipboard retains relative timing, rests, chord strings and expression without shared mutable metadata", () => {
  const tab = score({
    version: 3,
    notes: [
      {
        string: 5,
        fret: 3,
        tick: 24,
        duration: 12,
        velocity: 48,
        techniques: ["vibrato"],
        tuplet: { actual: 3, normal: 2, denominator: 4 }
      },
      { string: 4, fret: 2, tick: 24, duration: 12 }
    ],
    rests: [{ tick: 36, duration: 12 }]
  });
  const copied = copyTabSelection(tab, 24, 48);
  expect(copied.ticks).toBe(24);
  expect(copied.notes.map((note) => note.tick)).toEqual([0, 0]);
  expect(copied.rests).toEqual([{ tick: 12, duration: 12 }]);
  expect(copied.notes[1].techniques).not.toBe(tab.notes[1].techniques);
  const pasted = pasteTabSelection(tab, 96, copied).tab!;
  expect(
    pasted.notes.filter((note) => note.tick === 96).map((note) => note.string)
  ).toEqual([4, 5]);
  expect(pasted.rests).toContainEqual({ tick: 108, duration: 12 });
  expect(pasted.barCount).toBe(2);
});

test("single-note clipboard never copies its chord peer, and insertion replaces a pause without erasing its remainder", () => {
  const tab = score({
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 12 },
      { string: 4, fret: 2, tick: 0, duration: 12 }
    ],
    rests: [{ tick: 24, duration: 48 }]
  });
  const copied = copyTabSelection(tab, 0, 12, { tick: 0, string: 5 });
  expect(copied.notes).toHaveLength(1);
  const pasted = pasteTabSelection(tab, 36, copied, 3).tab!;
  expect(pasted.notes).toContainEqual({
    string: 3,
    fret: 3,
    tick: 36,
    duration: 12
  });
  expect(pasted.rests).toEqual([
    { tick: 24, duration: 12 },
    { tick: 48, duration: 24 }
  ]);
});

test("conflicting or oversized paste is atomic and leaves the original score unchanged", () => {
  const tab = score({ notes: [{ string: 5, fret: 3, tick: 0, duration: 24 }] });
  const before = JSON.stringify(tab),
    copied = copyTabSelection(tab, 0, 24);
  expect(pasteTabSelection(tab, 0, copied).error).toBe("TabNoteCollision");
  expect(pasteTabSelection(tab, 128 * 96, copied).error).toBe("TabEditLimit");
  expect(JSON.stringify(tab)).toBe(before);
});
