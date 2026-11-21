import {
  emptyTablature,
  normalizeTablature,
  TAB_MAX_NOTES,
  Tablature
} from "../src/components/tablature";
import {
  changeTabMeter,
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
