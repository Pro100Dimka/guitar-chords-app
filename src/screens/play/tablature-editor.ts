import {
  normalizeTablature,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  tabBarTicks,
  tabNoteDuration,
  roundTabTick,
  tabTickEnd,
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

export const durationChoices = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const modifiers = {
  plain: 1,
  dotted: 1.5,
  doubleDotted: 1.75,
  triplet: 2 / 3,
  duplet: 3 / 2,
  quintuplet: 4 / 5
} as const;
export type DurationModifier = keyof typeof modifiers;

export function durationTicks(
  denominator: number,
  modifier: DurationModifier = "plain"
) {
  const base = (TAB_TICKS_PER_BEAT * 4) / denominator;
  return Math.round(base * modifiers[modifier] * 960) / 960;
}

export function durationParts(ticks: number) {
  for (const modifier of Object.keys(modifiers) as DurationModifier[])
    for (const denominator of durationChoices)
      if (durationTicks(denominator, modifier) === ticks)
        return { denominator, modifier };
  return undefined;
}

export function durationLabel(ticks: number) {
  const choice = durationParts(ticks);
  return choice
    ? `1/${choice.denominator}${{ plain: "", dotted: ".", doubleDotted: "..", triplet: " ×⅔", duplet: " ×³⁄₂", quintuplet: " ×⅘" }[choice.modifier]}`
    : `${Number((ticks / TAB_TICKS_PER_BEAT).toFixed(2))} ♩`;
}

const sameNote = (a: Pick<TabNote, "tick" | "string">, b: TabNote) =>
  roundTabTick(a.tick) === roundTabTick(b.tick) && a.string === b.string;

function result(value: Tablature): TabEditResult {
  const maxEnd = TAB_MAX_BARS * tabBarTicks(value);
  if (
    value.notes.length + (value.rests?.length ?? 0) > TAB_MAX_NOTES ||
    (value.barCount ?? 1) > TAB_MAX_BARS ||
    value.notes.some(
      (note) => tabTickEnd(note.tick, tabNoteDuration(note)) > maxEnd
    ) ||
    value.rests?.some((rest) => tabTickEnd(rest.tick, rest.duration) > maxEnd)
  )
    return { error: "TabEditLimit" };
  const expressive =
    value.notes.some(
      (note) =>
        Object.keys(note).some(
          (key) => !["tick", "string", "fret", "duration"].includes(key)
        ) ||
        !Number.isInteger(note.tick) ||
        !Number.isInteger(tabNoteDuration(note))
    ) ||
    value.rests?.some(
      (rest) => !Number.isInteger(rest.tick) || !Number.isInteger(rest.duration)
    );
  const tab = normalizeTablature({
    ...value,
    version: expressive ? 3 : value.version
  });
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
  beatUnit: 2 | 4 | 8
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
        tick: roundTabTick(note.tick - start),
        duration: roundTabTick(
          Math.min(tabNoteDuration(note), end - note.tick)
        )
      })),
    rests: (tab.rests ?? [])
      .filter(
        (rest) => rest.tick < end && tabTickEnd(rest.tick, rest.duration) > start
      )
      .map((rest) => ({
        tick: roundTabTick(Math.max(start, rest.tick) - start),
        duration: roundTabTick(
          Math.min(end, tabTickEnd(rest.tick, rest.duration)) -
            Math.max(start, rest.tick)
        )
      }))
  };
}

const clipNote = (note: TabNote, end: number): TabNote => ({
  ...note,
  duration: roundTabTick(Math.min(tabNoteDuration(note), end - note.tick))
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

/** Rhythm coverage counts simultaneous chord notes once, including tied sustains. */
export function tabBarCoverage(tab: Tablature, bar: number) {
  const size = tabBarTicks(tab),
    start = bar * size,
    end = start + size;
  const events = [
    ...tab.notes.map((note) => ({
      start: note.tick,
      end: tabTickEnd(note.tick, tabNoteDuration(note)),
      tied: note.tie === true
    })),
    ...(tab.rests ?? []).map((rest) => ({
      start: rest.tick,
      end: tabTickEnd(rest.tick, rest.duration),
      tied: false
    }))
  ]
    .filter((event) => event.start < end && event.end > start)
    .sort((a, b) => a.start - b.start);
  let covered = 0,
    at = start;
  for (const event of events) {
    const from = Math.max(start, event.start),
      to = Math.min(end, event.end);
    covered += Math.max(0, to - Math.max(at, from));
    at = Math.max(at, to);
  }
  return {
    covered: roundTabTick(covered),
    expected: size,
    overflow: events.some(
      (event) => event.start >= start && event.end > end && !event.tied
    )
  };
}

export function copyTabSelection(
  tab: Tablature,
  start: number,
  end: number,
  only?: Pick<TabNote, "tick" | "string">
): TabBarClipboard {
  return {
    ticks: roundTabTick(end - start),
    notes: tab.notes
      .filter(
        (note) =>
          note.tick >= start &&
          note.tick < end &&
          (!only || sameNote(only, note))
      )
      .map((note) => ({
        ...note,
        tick: roundTabTick(note.tick - start),
        duration: roundTabTick(
          Math.min(tabNoteDuration(note), end - note.tick)
        ),
        ...(note.techniques ? { techniques: [...note.techniques] } : {}),
        ...(note.tuplet ? { tuplet: { ...note.tuplet } } : {})
      })),
    rests: only
      ? []
      : (tab.rests ?? [])
          .filter(
            (rest) =>
              rest.tick < end && tabTickEnd(rest.tick, rest.duration) > start
          )
          .map((rest) => ({
            tick: roundTabTick(Math.max(start, rest.tick) - start),
            duration: roundTabTick(
              Math.min(end, tabTickEnd(rest.tick, rest.duration)) -
                Math.max(start, rest.tick)
            )
          }))
  };
}

/** Deleting pitches preserves time; only silence unoccupied by other strings becomes a rest. */
export function deleteTabSelection(
  tab: Tablature,
  removed: TabNote[],
  range?: { start: number; end: number }
): TabEditResult {
  const notes = tab.notes.filter((note) => !removed.includes(note));
  const rests = (tab.rests ?? []).map((rest) => ({ ...rest }));
  const spans = range
    ? [range]
    : removed.map((note) => ({
        start: note.tick,
        end: tabTickEnd(note.tick, tabNoteDuration(note))
      }));
  for (const span of spans) {
    let gaps = [{ ...span }];
    const occupied = [
      ...notes.map((note) => ({
        start: note.tick,
        end: tabTickEnd(note.tick, tabNoteDuration(note))
      })),
      ...rests.map((rest) => ({
        start: rest.tick,
        end: tabTickEnd(rest.tick, rest.duration)
      }))
    ];
    for (const block of occupied)
      gaps = gaps.flatMap((gap) =>
        block.end <= gap.start || block.start >= gap.end
          ? [gap]
          : [
              ...(block.start > gap.start
                ? [{ start: gap.start, end: block.start }]
                : []),
              ...(block.end < gap.end
                ? [{ start: block.end, end: gap.end }]
                : [])
            ]
      );
    rests.push(
      ...gaps
        .filter((gap) => gap.end > gap.start)
        .map((gap) => ({
          tick: gap.start,
          duration: roundTabTick(gap.end - gap.start)
        }))
    );
  }
  return result({ ...tab, notes, rests });
}

/** Paste is atomic and never overwrites an occupied string or a sounding rest. */
export function pasteTabSelection(
  tab: Tablature,
  at: number,
  clipboard: TabBarClipboard,
  string?: number
): TabEditResult {
  const notes = clipboard.notes.map((note) => ({
    ...note,
    tick: tabTickEnd(at, note.tick),
    string:
      string !== undefined && clipboard.notes.length === 1
        ? string
        : note.string
  }));
  if (notes.some((note) => tab.notes.some((entry) => sameNote(note, entry))))
    return { error: "TabNoteCollision" };
  const end = tabTickEnd(at, clipboard.ticks);
  const rests = (tab.rests ?? []).flatMap((rest) =>
    rest.tick >= end || tabTickEnd(rest.tick, rest.duration) <= at
      ? [rest]
      : [
          ...(rest.tick < at
            ? [{ tick: rest.tick, duration: roundTabTick(at - rest.tick) }]
            : []),
          ...(tabTickEnd(rest.tick, rest.duration) > end
            ? [
                {
                  tick: end,
                  duration: roundTabTick(
                    tabTickEnd(rest.tick, rest.duration) - end
                  )
                }
              ]
            : [])
        ]
  );
  return result({
    ...tab,
    version: 3,
    barCount: Math.max(tab.barCount ?? 1, Math.ceil(end / tabBarTicks(tab))),
    notes: [...tab.notes, ...notes],
    rests: [
      ...rests,
      ...clipboard.rests.map((rest) => ({
        ...rest,
        tick: tabTickEnd(at, rest.tick)
      }))
    ]
  });
}
