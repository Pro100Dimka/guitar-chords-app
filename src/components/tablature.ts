export const TAB_TICKS_PER_BEAT = 24;
export const TAB_MAX_NOTES = 2048;
export const TAB_MAX_BARS = 128;
export const TAB_TUNING = [40, 45, 50, 55, 59, 64] as const;

export interface TabNote {
  /** Zero is the low E string; five is the high e string. */
  string: number;
  fret: number;
  tick: number;
}

export interface Tablature {
  version: 1;
  tempo: number;
  beatsPerBar: number;
  notes: TabNote[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

/** Reject a damaged document instead of silently losing individual notes. */
export function normalizeTablature(value: unknown): Tablature | undefined {
  if (
    !record(value) ||
    value.version !== 1 ||
    !integer(value.tempo, 40, 200) ||
    !integer(value.beatsPerBar, 1, 8) ||
    !Array.isArray(value.notes) ||
    value.notes.length > TAB_MAX_NOTES
  )
    return undefined;

  const maxTick = TAB_MAX_BARS * value.beatsPerBar * TAB_TICKS_PER_BEAT - 1;
  const notes = new Map<string, TabNote>();
  for (const note of value.notes) {
    if (
      !record(note) ||
      !integer(note.string, 0, 5) ||
      !integer(note.fret, 0, 24) ||
      !integer(note.tick, 0, maxTick)
    )
      return undefined;
    notes.set(`${note.tick}:${note.string}`, {
      string: note.string,
      fret: note.fret,
      tick: note.tick
    });
  }
  return {
    version: 1,
    tempo: value.tempo,
    beatsPerBar: value.beatsPerBar,
    notes: [...notes.values()].sort(
      (a, b) => a.tick - b.tick || a.string - b.string
    )
  };
}

export function emptyTablature(tempo = 80, beatsPerBar = 4): Tablature {
  return {
    version: 1,
    tempo: integer(tempo, 40, 200) ? tempo : 80,
    beatsPerBar: integer(beatsPerBar, 1, 8) ? beatsPerBar : 4,
    notes: []
  };
}

/** The end is exclusive and includes the remainder of the final bar. */
export function tablatureLength(tab: Tablature): number {
  const barTicks = tab.beatsPerBar * TAB_TICKS_PER_BEAT;
  const lastTick = tab.notes.reduce(
    (last, note) => Math.max(last, note.tick),
    -1
  );
  return Math.max(barTicks, Math.ceil((lastTick + 1) / barTicks) * barTicks);
}

/**
 * Portable reading preview. Event columns preserve note order and simultaneous
 * attacks; exact timing is retained in the structured tablature, not this text.
 */
export function tablatureText(value: Tablature): string {
  const tab = normalizeTablature(value);
  if (!tab) return "";
  const barTicks = tab.beatsPerBar * TAB_TICKS_PER_BEAT;
  const bars = tablatureLength(tab) / barTicks;
  const names = ["E", "A", "D", "G", "B", "e"];
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
