import {
  normalizeTablature,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  tabBarTicks,
  tabNoteDuration,
  tablatureLength,
  TabNote,
  TabRest,
  Tablature
} from "../../components/tablature";

export type TabEditResult =
  | { tab: Tablature; error?: never }
  | { tab?: never; error: string };

export interface TabBarClipboard {
  ticks: number;
  notes: TabNote[];
  rests: TabRest[];
}

export const durationChoices = [1, 2, 4, 8, 16] as const;
export type DurationModifier = "plain" | "dotted" | "triplet";
const modifiers: DurationModifier[] = ["plain", "dotted", "triplet"];

export function durationTicks(
  denominator: number,
  modifier: DurationModifier = "plain"
) {
  const base = (TAB_TICKS_PER_BEAT * 4) / denominator;
  return (
    base * (modifier === "dotted" ? 1.5 : modifier === "triplet" ? 2 / 3 : 1)
  );
}

export function durationParts(ticks: number) {
  for (const modifier of modifiers)
    for (const denominator of durationChoices)
      if (durationTicks(denominator, modifier) === ticks)
        return { denominator, modifier };
  return undefined;
}

export function durationLabel(ticks: number) {
  const choice = durationParts(ticks);
  return choice
    ? `1/${choice.denominator}${choice.modifier === "dotted" ? "." : choice.modifier === "triplet" ? " ×⅔" : ""}`
    : `${Number((ticks / TAB_TICKS_PER_BEAT).toFixed(2))} ♩`;
}

const sameNote = (a: Pick<TabNote, "tick" | "string">, b: TabNote) =>
  a.tick === b.tick && a.string === b.string;

function result(value: Tablature): TabEditResult {
  const maxEnd = TAB_MAX_BARS * tabBarTicks(value);
  if (
    value.notes.length + (value.rests?.length ?? 0) > TAB_MAX_NOTES ||
    (value.barCount ?? 1) > TAB_MAX_BARS ||
    value.notes.some((note) => note.tick + tabNoteDuration(note) > maxEnd) ||
    value.rests?.some((rest) => rest.tick + rest.duration > maxEnd)
  )
    return { error: "TabEditLimit" };
  const tab = normalizeTablature(value);
  return tab ? { tab } : { error: "TabRestCollision" };
}

/** Never silently overwrite another note when changing its string or position. */
export function putTabNote(
  tab: Tablature,
  note: TabNote,
  previous?: Pick<TabNote, "tick" | "string">
): TabEditResult {
  const notes = tab.notes.filter(
    (entry) => !previous || !sameNote(previous, entry)
  );
  if (notes.some((entry) => sameNote(note, entry)))
    return { error: "TabNoteCollision" };
  return result({ ...tab, notes: [...notes, note] });
}

export function putTabRest(
  tab: Tablature,
  rest: TabRest,
  previousTick?: number
): TabEditResult {
  const rests = (tab.rests ?? []).filter(
    (entry) => entry.tick !== previousTick
  );
  if (rests.some((entry) => entry.tick === rest.tick))
    return { error: "TabRestCollision" };
  return result({ ...tab, rests: [...rests, rest] });
}

export function changeTabMeter(
  tab: Tablature,
  beatsPerBar: number,
  beatUnit: 4 | 8
): TabEditResult {
  const previousLength = tablatureLength(tab);
  const next = { ...tab, beatsPerBar, beatUnit };
  return result({
    ...next,
    barCount: Math.ceil(previousLength / tabBarTicks(next))
  });
}

/** Copy attacks in this bar. Sustain is cropped at its right boundary. */
export function copyTabBar(tab: Tablature, bar: number): TabBarClipboard {
  const ticks = tabBarTicks(tab);
  const start = bar * ticks;
  const end = start + ticks;
  return {
    ticks,
    notes: tab.notes
      .filter((note) => note.tick >= start && note.tick < end)
      .map((note) => ({
        ...note,
        tick: note.tick - start,
        duration: Math.min(tabNoteDuration(note), end - note.tick)
      })),
    rests: (tab.rests ?? [])
      .filter((rest) => rest.tick < end && rest.tick + rest.duration > start)
      .map((rest) => ({
        tick: Math.max(start, rest.tick) - start,
        duration:
          Math.min(end, rest.tick + rest.duration) - Math.max(start, rest.tick)
      }))
  };
}

const clipNote = (note: TabNote, end: number): TabNote => ({
  ...note,
  duration: Math.min(tabNoteDuration(note), end - note.tick)
});
const clipRest = (rest: TabRest, end: number): TabRest => ({
  ...rest,
  duration: Math.min(rest.duration, end - rest.tick)
});

/** Insert before bar, or append when bar equals the current bar count. */
export function insertTabBar(
  tab: Tablature,
  bar: number,
  clipboard?: TabBarClipboard
): TabEditResult {
  const ticks = tabBarTicks(tab);
  const count = tablatureLength(tab) / ticks;
  if (bar < 0 || bar > count || count >= TAB_MAX_BARS)
    return { error: "TabEditLimit" };
  if (clipboard && clipboard.ticks !== ticks)
    return { error: "TabClipboardMeter" };
  const start = bar * ticks;
  return result({
    ...tab,
    barCount: count + 1,
    notes: [
      ...tab.notes.map((note) =>
        note.tick >= start
          ? { ...note, tick: note.tick + ticks }
          : clipNote(note, start)
      ),
      ...(clipboard?.notes.map((note) => ({
        ...note,
        tick: note.tick + start
      })) ?? [])
    ],
    rests: [
      ...(tab.rests ?? []).map((rest) =>
        rest.tick >= start
          ? { ...rest, tick: rest.tick + ticks }
          : clipRest(rest, start)
      ),
      ...(clipboard?.rests.map((rest) => ({
        ...rest,
        tick: rest.tick + start
      })) ?? [])
    ]
  });
}

/** Removing the only bar leaves one empty bar. Earlier sustains end at the cut. */
export function deleteTabBar(tab: Tablature, bar: number): TabEditResult {
  const ticks = tabBarTicks(tab);
  const count = tablatureLength(tab) / ticks;
  if (bar < 0 || bar >= count) return { error: "TabEditLimit" };
  const start = bar * ticks;
  const end = start + ticks;
  return result({
    ...tab,
    barCount: Math.max(1, count - 1),
    notes: tab.notes
      .filter((note) => note.tick < start || note.tick >= end)
      .map((note) =>
        note.tick >= end
          ? { ...note, tick: note.tick - ticks }
          : clipNote(note, start)
      ),
    rests: (tab.rests ?? [])
      .filter((rest) => rest.tick < start || rest.tick >= end)
      .map((rest) =>
        rest.tick >= end
          ? { ...rest, tick: rest.tick - ticks }
          : clipRest(rest, start)
      )
  });
}

/** Replace this bar, preserving the placement of all later bars. Undo is one edit. */
export function pasteTabBar(
  tab: Tablature,
  bar: number,
  clipboard: TabBarClipboard
): TabEditResult {
  const ticks = tabBarTicks(tab);
  const count = tablatureLength(tab) / ticks;
  if (clipboard.ticks !== ticks) return { error: "TabClipboardMeter" };
  if (bar < 0 || bar >= count) return { error: "TabEditLimit" };
  const start = bar * ticks;
  const end = start + ticks;
  return result({
    ...tab,
    notes: [
      ...tab.notes
        .filter((note) => note.tick < start || note.tick >= end)
        .map((note) => (note.tick < start ? clipNote(note, start) : note)),
      ...clipboard.notes.map((note) => ({ ...note, tick: note.tick + start }))
    ],
    rests: [
      ...(tab.rests ?? [])
        .filter((rest) => rest.tick < start || rest.tick >= end)
        .map((rest) => (rest.tick < start ? clipRest(rest, start) : rest)),
      ...clipboard.rests.map((rest) => ({ ...rest, tick: rest.tick + start }))
    ]
  });
}
