/** Musical ticks always count quarter notes, independently of the meter. */
export const TAB_TICKS_PER_BEAT = 24;
export const TAB_MAX_NOTES = 2048;
export const TAB_MAX_BARS = 128;
export const TAB_TUNING = [40, 45, 50, 55, 59, 64] as const;

export interface TabNote {
  /** Zero is the low E string; five is the high e string. */
  string: number;
  fret: number;
  tick: number;
  /** Optional only for legacy callers. Normalized notes always have duration. */
  duration?: number;
}

export interface TabRest {
  tick: number;
  duration: number;
}

export interface Tablature {
  /** Version 1 is accepted for migration; normalization writes version 2. */
  version: 1 | 2;
  /** Quarter notes per minute, also in meters with an eighth-note denominator. */
  tempo: number;
  beatsPerBar: number;
  beatUnit?: 4 | 8;
  /** Retains intentionally empty final bars. */
  barCount?: number;
  notes: TabNote[];
  rests?: TabRest[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

export const tabBeatTicks = (tab: Tablature): number =>
  (TAB_TICKS_PER_BEAT * 4) / (tab.beatUnit ?? 4);
export const tabBarTicks = (tab: Tablature): number =>
  tab.beatsPerBar * tabBeatTicks(tab);
export const tabNoteDuration = (note: TabNote): number =>
  note.duration ?? TAB_TICKS_PER_BEAT;

/** Reject a damaged document instead of silently losing individual events. */
export function normalizeTablature(value: unknown): Tablature | undefined {
  if (
    !record(value) ||
    ![1, 2].includes(value.version as number) ||
    !integer(value.tempo, 40, 200) ||
    !integer(value.beatsPerBar, 1, 8) ||
    (value.beatUnit !== undefined &&
      ![4, 8].includes(value.beatUnit as number)) ||
    (value.barCount !== undefined &&
      !integer(value.barCount, 1, TAB_MAX_BARS)) ||
    !Array.isArray(value.notes) ||
    (value.rests !== undefined && !Array.isArray(value.rests))
  )
    return undefined;

  const inputRests = (value.rests ?? []) as unknown[];
  if (value.notes.length + inputRests.length > TAB_MAX_NOTES) return undefined;
  const beatUnit = (value.beatUnit ?? 4) as 4 | 8;
  const barTicks = (value.beatsPerBar * TAB_TICKS_PER_BEAT * 4) / beatUnit;
  const end = TAB_MAX_BARS * barTicks;
  const uniqueNotes = new Map<string, TabNote>();
  for (const note of value.notes) {
    if (
      !record(note) ||
      !integer(note.string, 0, 5) ||
      !integer(note.fret, 0, 24) ||
      !integer(note.tick, 0, end - 1) ||
      (note.duration !== undefined &&
        !integer(note.duration, 1, end - note.tick))
    )
      return undefined;
    uniqueNotes.set(`${note.tick}:${note.string}`, {
      string: note.string,
      fret: note.fret,
      tick: note.tick,
      ...(note.duration !== undefined
        ? { duration: note.duration as number }
        : {})
    });
  }
  const notes = [...uniqueNotes.values()].sort(
    (a, b) => a.tick - b.tick || a.string - b.string
  );
  const rests: TabRest[] = [];
  for (const rest of inputRests) {
    if (
      !record(rest) ||
      !integer(rest.tick, 0, end - 1) ||
      !integer(rest.duration, 1, end - rest.tick)
    )
      return undefined;
    rests.push({ tick: rest.tick, duration: rest.duration });
  }
  rests.sort((a, b) => a.tick - b.tick);
  if (
    rests.some(
      (rest, index) =>
        index > 0 &&
        rests[index - 1].tick + rests[index - 1].duration > rest.tick
    )
  )
    return undefined;

  // A legacy take had no release times. Preserve its old final bar boundary.
  const legacyEnd = Math.max(
    barTicks,
    Math.ceil(((notes.at(-1)?.tick ?? -1) + 1) / barTicks) * barTicks
  );
  const nextByString = new Map<number, number>();
  for (let index = notes.length - 1; index >= 0; index--) {
    const note = notes[index];
    const next = nextByString.get(note.string) ?? end;
    if (note.duration === undefined)
      note.duration = Math.min(
        TAB_TICKS_PER_BEAT,
        next - note.tick,
        (value.version === 1 ? legacyEnd : end) - note.tick
      );
    // A new attack on the same physical string ends the previous note.
    const soundingEnd = Math.min(note.tick + note.duration, next);
    if (
      rests.some(
        (rest) =>
          rest.tick < soundingEnd && rest.tick + rest.duration > note.tick
      )
    )
      return undefined;
    nextByString.set(note.string, note.tick);
  }
  const tab: Tablature = {
    version: 2,
    tempo: value.tempo,
    beatsPerBar: value.beatsPerBar,
    beatUnit,
    barCount: (value.barCount as number | undefined) ?? 1,
    notes,
    rests
  };
  tab.barCount = tablatureLength(tab) / barTicks;
  return tab;
}

export function emptyTablature(
  tempo = 80,
  beatsPerBar = 4,
  beatUnit: 4 | 8 = 4
): Tablature {
  return {
    version: 2,
    tempo: integer(tempo, 40, 200) ? tempo : 80,
    beatsPerBar: integer(beatsPerBar, 1, 8) ? beatsPerBar : 4,
    beatUnit: beatUnit === 8 ? 8 : 4,
    barCount: 1,
    notes: [],
    rests: []
  };
}

/** The exclusive end includes release times and intentionally empty bars. */
export function tablatureLength(tab: Tablature): number {
  const barTicks = tabBarTicks(tab);
  const lastEnd = [...tab.notes, ...(tab.rests ?? [])].reduce(
    (last, event) =>
      Math.max(last, event.tick + (event.duration ?? TAB_TICKS_PER_BEAT)),
    0
  );
  return Math.max(
    (tab.barCount ?? 1) * barTicks,
    Math.ceil(lastEnd / barTicks) * barTicks,
    barTicks
  );
}

const fraction = (numerator: number, denominator: number): string => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(numerator, denominator);
  return denominator === divisor
    ? String(numerator / divisor)
    : `${numerator / divisor}/${denominator / divisor}`;
};
const names = ["E", "A", "D", "G", "B", "e"];

/**
 * Portable preview. Frets align by event; the rhythm line supplies exact note
 * values and beat positions, including dotted notes, triplets and rests.
 */
export function tablatureText(value: Tablature): string {
  const tab = normalizeTablature(value);
  if (!tab) return "";
  const barTicks = tabBarTicks(tab);
  const beatTicks = tabBeatTicks(tab);
  const bars = tablatureLength(tab) / barTicks;
  const output = [
    `TAB · ${tab.tempo} BPM · ${tab.beatsPerBar}/${tab.beatUnit}`,
    ""
  ];
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * barTicks;
    const notes = tab.notes.filter(
      (note) => note.tick >= start && note.tick < start + barTicks
    );
    const rests = (tab.rests ?? []).filter(
      (rest) =>
        rest.tick < start + barTicks && rest.tick + rest.duration > start
    );
    const ticks = new Set(
      Array.from(
        { length: tab.beatsPerBar },
        (_, beat) => start + beat * beatTicks
      )
    );
    notes.forEach((note) => ticks.add(note.tick));
    rests.forEach((rest) => ticks.add(Math.max(start, rest.tick)));
    const columns = [...ticks].sort((a, b) => a - b);
    const entries = new Map(
      notes.map((note) => [`${note.tick}:${note.string}`, note])
    );
    output.push(`${bar + 1}`);
    for (let string = 5; string >= 0; string--) {
      const line = columns
        .map((tick) => {
          const fret = entries.get(`${tick}:${string}`)?.fret;
          return fret === undefined ? "---" : String(fret).padEnd(3, "-");
        })
        .join("");
      output.push(`${names[string]}|${line}|`);
    }
    const position = (tick: number) => {
      const relative = Math.max(0, tick - start);
      const whole = 1 + Math.floor(relative / beatTicks);
      return relative % beatTicks
        ? `${whole}+${fraction(relative % beatTicks, beatTicks)}`
        : String(whole);
    };
    const rhythm = [
      ...notes.map((note) => ({
        tick: note.tick,
        text: `${names[note.string]}${note.fret}@${position(note.tick)}=${fraction(tabNoteDuration(note), 96)}`
      })),
      ...rests.map((rest) => ({
        tick: Math.max(start, rest.tick),
        text: `R${rest.tick < start ? "~" : ""}@${position(rest.tick)}=${fraction(Math.min(rest.tick + rest.duration, start + barTicks) - Math.max(start, rest.tick), 96)}`
      }))
    ].sort((a, b) => a.tick - b.tick);
    if (rhythm.length)
      output.push(`♪ ${rhythm.map((event) => event.text).join("; ")}`);
    output.push("");
  }
  return output.join("\n").trimEnd();
}

/** Exact v1 preview for recognizing previously generated library content. */
export function legacyTablatureText(value: Tablature): string {
  const tab = normalizeTablature(value);
  if (!tab) return "";
  const barTicks = tab.beatsPerBar * TAB_TICKS_PER_BEAT;
  const bars = Math.max(
    1,
    Math.ceil(((tab.notes.at(-1)?.tick ?? -1) + 1) / barTicks)
  );
  const output = [`TAB · ${tab.tempo} BPM · ${tab.beatsPerBar}/4`, ""];
  let offset = 0;
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * barTicks;
    const notes = new Map<number, Map<number, number>>();
    const ticks = new Set(
      Array.from(
        { length: tab.beatsPerBar },
        (_, beat) => start + beat * TAB_TICKS_PER_BEAT
      )
    );
    while (
      offset < tab.notes.length &&
      tab.notes[offset].tick < start + barTicks
    ) {
      const note = tab.notes[offset++];
      ticks.add(note.tick);
      if (!notes.has(note.tick)) notes.set(note.tick, new Map());
      notes.get(note.tick)!.set(note.string, note.fret);
    }
    const columns = [...ticks].sort((a, b) => a - b);
    output.push(`${bar + 1}`);
    for (let string = 5; string >= 0; string--) {
      const line = columns
        .map((tick) => {
          const fret = notes.get(tick)?.get(string);
          return fret === undefined ? "---" : String(fret).padEnd(3, "-");
        })
        .join("");
      output.push(`${names[string]}|${line}|`);
    }
    output.push("");
  }
  return output.join("\n").trimEnd();
}
