/** Musical ticks always count quarter notes, independently of the meter. */
export const TAB_TICKS_PER_BEAT = 24;
export const TAB_MAX_NOTES = 2048;
export const TAB_MAX_BARS = 128;
export const TAB_TUNING = [40, 45, 50, 55, 59, 64] as const;
export const TAB_TECHNIQUES = {
  hammerOn: "h",
  pullOff: "p",
  slide: "/",
  bend: "b",
  vibrato: "~",
  palmMute: "PM",
  letRing: "l.r.",
  harmonic: "◇",
  tapping: "T",
  tremolo: "///",
  trill: "tr",
  whammy: "↘",
  grace: "♪",
  slap: "S",
  pop: "P",
  rasgueado: "rasg.",
  mordent: "mord.",
  turn: "turn",
  golpe: "G",
  pickScrape: "scr."
} as const;
export type TabTechnique = keyof typeof TAB_TECHNIQUES;

export interface TabNote {
  /** Zero is the low E string; five is the high e string. */
  string: number;
  fret: number;
  tick: number;
  /** Optional only for legacy callers. Normalized notes always have duration. */
  duration?: number;
  velocity?: number;
  techniques?: TabTechnique[];
  bend?: number;
  bendRelease?: boolean;
  sourceFret?: number;
  accent?: "accent" | "strong" | "staccato" | "ghost" | "dead";
  fade?: "in" | "out" | "crescendo" | "diminuendo";
  pick?: "down" | "up" | "downBrush" | "upBrush" | "arpeggio";
  leftFinger?: number;
  rightFinger?: "p" | "i" | "m" | "a" | "c";
  voice?: number;
  tie?: boolean;
  fermata?: boolean;
  tuplet?: { actual: number; normal: number; denominator: number };
}

export interface TabRest {
  tick: number;
  duration: number;
}

export interface Tablature {
  /** Version 3 adds expression and fractional ticks; old documents retain their timing. */
  version: 1 | 2 | 3;
  /** Quarter notes per minute, also in meters with an eighth-note denominator. */
  tempo: number;
  beatsPerBar: number;
  beatUnit?: 2 | 4 | 8;
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
// Version 3 stores time in exact 1/960-tick subdivisions. Round arithmetic
// back to that grid before comparing musical event boundaries.
export const roundTabTick = (tick: number) => Math.round(tick * 960) / 960;
export const tabTickEnd = (tick: number, duration: number) =>
  roundTabTick(tick + duration);
export const tabNoteSymbols = (note: TabNote): string =>
  [
    ...(note.techniques ?? []).map((technique) => TAB_TECHNIQUES[technique]),
    note.tie ? "⌒" : "",
    note.fermata ? "𝄐" : "",
    note.tuplet ? `${note.tuplet.actual}:${note.tuplet.normal}` : "",
    note.accent
      ? { accent: ">", strong: ">>", staccato: "·", ghost: "( )", dead: "×" }[
          note.accent
        ]
      : ""
  ]
    .filter(Boolean)
    .join(" ");

export function tabNoteEnd(tab: Tablature, note: TabNote): number {
  let end = tabTickEnd(note.tick, tabNoteDuration(note));
  if (!note.tie && !note.techniques?.includes("letRing")) return end;
  let current = note;
  const following = tab.notes.filter(
    (next) => next.string === note.string && next.tick > note.tick
  );
  for (const next of following) {
    if (!current.tie || next.tick !== end || next.fret !== note.fret) break;
    end = tabTickEnd(next.tick, tabNoteDuration(next));
    current = next;
  }
  if (note.techniques?.includes("letRing"))
    end =
      following.find((next) => next.tick >= end)?.tick ?? tablatureLength(tab);
  const rest = tab.rests?.find((entry) => entry.tick >= note.tick);
  return Math.min(end, rest?.tick ?? end);
}

/** Reject a damaged document instead of silently losing individual events. */
export function normalizeTablature(value: unknown): Tablature | undefined {
  if (
    !record(value) ||
    ![1, 2, 3].includes(value.version as number) ||
    !integer(value.tempo, 40, 200) ||
    !integer(value.beatsPerBar, 1, 32) ||
    (value.beatUnit !== undefined &&
      ![2, 4, 8].includes(value.beatUnit as number)) ||
    (value.barCount !== undefined &&
      !integer(value.barCount, 1, TAB_MAX_BARS)) ||
    !Array.isArray(value.notes) ||
    (value.rests !== undefined && !Array.isArray(value.rests))
  )
    return undefined;

  const inputRests = (value.rests ?? []) as unknown[];
  if (value.notes.length + inputRests.length > TAB_MAX_NOTES) return undefined;
  const beatUnit = (value.beatUnit ?? 4) as 2 | 4 | 8;
  const barTicks = (value.beatsPerBar * TAB_TICKS_PER_BEAT * 4) / beatUnit;
  const end = TAB_MAX_BARS * barTicks;
  const musicalTick = (
    tick: unknown,
    min: number,
    max: number
  ): tick is number =>
    value.version === 3
      ? typeof tick === "number" &&
        Number.isFinite(tick) &&
        Math.round(tick * 960) >= Math.round(min * 960) &&
        Math.round(tick * 960) <= Math.round(max * 960) &&
        Math.abs(tick * 960 - Math.round(tick * 960)) < 0.00001
      : integer(tick, Math.max(0, min), max);
  const uniqueNotes = new Map<string, TabNote>();
  for (const note of value.notes) {
    if (
      !record(note) ||
      !integer(note.string, 0, 5) ||
      !integer(note.fret, 0, 24) ||
      !musicalTick(note.tick, 0, end - (value.version === 3 ? 1 / 960 : 1)) ||
      (note.duration !== undefined &&
        !musicalTick(
          note.duration,
          value.version === 3 ? 1 / 960 : 1,
          end - note.tick
        ))
    )
      return undefined;
    const normalized: TabNote = {
      string: note.string,
      fret: note.fret,
      tick: value.version === 3 ? Math.round(note.tick * 960) / 960 : note.tick,
      ...(note.duration !== undefined
        ? {
            duration:
              value.version === 3
                ? Math.round((note.duration as number) * 960) / 960
                : (note.duration as number)
          }
        : {})
    };
    const optional = <K extends keyof TabNote>(
      key: K,
      valid: (entry: unknown) => entry is TabNote[K]
    ) => {
      const entry = note[key];
      if (entry === undefined) return true;
      if (!valid(entry)) return false;
      normalized[key] = entry;
      return true;
    };
    const choice =
      <T extends string>(choices: readonly T[]) =>
      (entry: unknown): entry is T =>
        typeof entry === "string" && choices.includes(entry as T);
    if (
      ![
        optional("velocity", (entry): entry is number =>
          integer(entry, 1, 127)
        ),
        optional(
          "bend",
          (entry): entry is number =>
            typeof entry === "number" &&
            Number.isFinite(entry) &&
            entry >= 0 &&
            entry <= 3
        ),
        optional("sourceFret", (entry): entry is number =>
          integer(entry, 0, 24)
        ),
        optional("leftFinger", (entry): entry is number =>
          integer(entry, 1, 4)
        ),
        optional("voice", (entry): entry is number => integer(entry, 1, 4)),
        ...(["bendRelease", "tie", "fermata"] as const).map((key) =>
          optional(key, (entry): entry is boolean => typeof entry === "boolean")
        ),
        optional(
          "accent",
          choice(["accent", "strong", "staccato", "ghost", "dead"] as const)
        ),
        optional(
          "fade",
          choice(["in", "out", "crescendo", "diminuendo"] as const)
        ),
        optional(
          "pick",
          choice(["down", "up", "downBrush", "upBrush", "arpeggio"] as const)
        ),
        optional("rightFinger", choice(["p", "i", "m", "a", "c"] as const)),
        optional(
          "tuplet",
          (entry): entry is NonNullable<TabNote["tuplet"]> =>
            record(entry) &&
            integer(entry.actual, 2, 16) &&
            integer(entry.normal, 1, 16) &&
            typeof entry.denominator === "number" &&
            [1, 2, 4, 8, 16, 32, 64, 128].includes(entry.denominator)
        ),
        optional(
          "techniques",
          (entry): entry is TabTechnique[] =>
            Array.isArray(entry) &&
            entry.length <= Object.keys(TAB_TECHNIQUES).length &&
            entry.every(
              (item) =>
                typeof item === "string" && Object.hasOwn(TAB_TECHNIQUES, item)
            )
        )
      ].every(Boolean)
    )
      return undefined;
    if (normalized.techniques)
      normalized.techniques = [...new Set(normalized.techniques)];
    if (normalized.tuplet) normalized.tuplet = { ...normalized.tuplet };
    uniqueNotes.set(`${normalized.tick}:${normalized.string}`, normalized);
  }
  const notes = [...uniqueNotes.values()].sort(
    (a, b) => a.tick - b.tick || a.string - b.string
  );
  const rests: TabRest[] = [];
  for (const rest of inputRests) {
    if (
      !record(rest) ||
      !musicalTick(rest.tick, 0, end - (value.version === 3 ? 1 / 960 : 1)) ||
      !musicalTick(
        rest.duration,
        value.version === 3 ? 1 / 960 : 1,
        end - rest.tick
      )
    )
      return undefined;
    rests.push({
      tick: Math.round(rest.tick * 960) / 960,
      duration: Math.round(rest.duration * 960) / 960
    });
  }
  rests.sort((a, b) => a.tick - b.tick);
  if (
    rests.some(
      (rest, index) =>
        index > 0 &&
        tabTickEnd(rests[index - 1].tick, rests[index - 1].duration) > rest.tick
    )
  )
    return undefined;

  // A legacy take had no release times. Preserve its old final bar boundary.
  const legacyEnd = Math.max(
    barTicks,
    Math.ceil(((notes.at(-1)?.tick ?? -1) + 1) / barTicks) * barTicks
  );
  const nextByString = new Map<number, number>();
  let restIndex = rests.length - 1;
  for (let index = notes.length - 1; index >= 0; index--) {
    const note = notes[index];
    const next = nextByString.get(note.string) ?? end;
    if (note.duration === undefined)
      note.duration = Math.min(
        TAB_TICKS_PER_BEAT,
        next - note.tick,
        (value.version === 1 ? legacyEnd : end) - note.tick
      );
    // Store the physical release as well as using it for validation. Otherwise
    // deleting a later attack can revive an old hidden tail across a rest.
    note.duration = roundTabTick(Math.min(note.duration, next - note.tick));
    const soundingEnd = tabTickEnd(note.tick, note.duration);
    // Notes are visited backwards and rests do not overlap. Only the rest
    // covering the attack and the first rest after it can intersect its tail.
    while (restIndex >= 0 && rests[restIndex].tick > note.tick) restIndex--;
    const previousRest = rests[restIndex];
    const nextRest = rests[restIndex + 1];
    if (
      (previousRest &&
        tabTickEnd(previousRest.tick, previousRest.duration) > note.tick) ||
      (nextRest && nextRest.tick < soundingEnd)
    )
      return undefined;
    nextByString.set(note.string, note.tick);
  }
  const tab: Tablature = {
    version: value.version === 3 ? 3 : 2,
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
  beatUnit: 2 | 4 | 8 = 4
): Tablature {
  return {
    version: 2,
    tempo: integer(tempo, 40, 200) ? tempo : 80,
    beatsPerBar: integer(beatsPerBar, 1, 32) ? beatsPerBar : 4,
    beatUnit: beatUnit === 2 || beatUnit === 8 ? beatUnit : 4,
    barCount: 1,
    notes: [],
    rests: []
  };
}

/** The exclusive end includes release times and intentionally empty bars. */
export function tablatureLength(tab: Tablature): number {
  const barTicks = tabBarTicks(tab);
  let lastEnd = 0;
  for (const note of tab.notes)
    lastEnd = Math.max(lastEnd, tabTickEnd(note.tick, tabNoteDuration(note)));
  for (const rest of tab.rests ?? [])
    lastEnd = Math.max(lastEnd, tabTickEnd(rest.tick, rest.duration));
  return Math.max(
    (tab.barCount ?? 1) * barTicks,
    Math.ceil(lastEnd / barTicks) * barTicks,
    barTicks
  );
}

const fraction = (numerator: number, denominator: number): string => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const top = Math.round(numerator * 960);
  const bottom = Math.round(denominator * 960);
  const divisor = gcd(top, bottom);
  return bottom === divisor
    ? String(top / divisor)
    : `${top / divisor}/${bottom / divisor}`;
};
const names = ["E", "A", "D", "G", "B", "e"];
const beatPosition = (tick: number, start: number, beatTicks: number) => {
  const relative = Math.max(0, tick - start);
  const whole = 1 + Math.floor(relative / beatTicks);
  return relative % beatTicks
    ? `${whole}+${fraction(relative % beatTicks, beatTicks)}`
    : String(whole);
};

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
  let noteOffset = 0;
  let restOffset = 0;
  const allRests = tab.rests ?? [];
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * barTicks;
    const notes: TabNote[] = [];
    while (
      noteOffset < tab.notes.length &&
      tab.notes[noteOffset].tick < start + barTicks
    )
      notes.push(tab.notes[noteOffset++]);
    while (
      restOffset < allRests.length &&
      allRests[restOffset].tick + allRests[restOffset].duration <= start
    )
      restOffset++;
    const rests: TabRest[] = [];
    for (
      let index = restOffset;
      index < allRests.length && allRests[index].tick < start + barTicks;
      index++
    )
      rests.push(allRests[index]);
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
    const position = (tick: number) => beatPosition(tick, start, beatTicks);
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

/** Recognize generated previews, including old releases cut by a reattack. */
export function isTablaturePreview(text: string, value: Tablature): boolean {
  const tab = normalizeTablature(value);
  if (!tab) return false;
  const expected = tablatureText(tab);
  if (text === expected || text === legacyTablatureText(tab)) return true;
  const barTicks = tabBarTicks(tab);
  const beatTicks = tabBeatTicks(tab);
  const clipped = new Map<string, TabNote>();
  const nextByString = new Map<number, number>();
  for (let index = tab.notes.length - 1; index >= 0; index--) {
    const note = tab.notes[index];
    if (note.tick + tabNoteDuration(note) === nextByString.get(note.string)) {
      const bar = Math.floor(note.tick / barTicks);
      clipped.set(
        `${bar}:${names[note.string]}${note.fret}@${beatPosition(note.tick, bar * barTicks, beatTicks)}`,
        note
      );
    }
    nextByString.set(note.string, note.tick);
  }
  if (!clipped.size) return false;
  // Only the non-sounding part of a known note may differ. Every other byte,
  // including user text, note positions, frets and rests, must still match.
  let bar = -1;
  const repaired = text.split("\n").map((line) => {
    if (/^\d+$/.test(line)) bar = Number(line) - 1;
    if (!line.startsWith("♪ ")) return line;
    return `♪ ${line
      .slice(2)
      .split("; ")
      .map((entry) => {
        const [key, duration, ...extra] = entry.split("=");
        const note = clipped.get(`${bar}:${key}`);
        const parts = /^(\d+)(?:\/(\d+))?$/.exec(duration ?? "");
        if (!note || !parts || extra.length) return entry;
        const ticks = (Number(parts[1]) * 96) / Number(parts[2] ?? 1);
        if (
          !integer(
            ticks,
            tabNoteDuration(note),
            TAB_MAX_BARS * barTicks - note.tick
          ) ||
          duration !== fraction(ticks, 96)
        )
          return entry;
        return `${key}=${fraction(tabNoteDuration(note), 96)}`;
      })
      .join("; ")}`;
  });
  return repaired.join("\n") === expected;
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
