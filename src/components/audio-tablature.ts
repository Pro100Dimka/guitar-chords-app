import type {
  AudioNoteEvent,
  AudioNoteTranscription
} from "./audio-transcription";
import type { ChordRange } from "./offline-chord-section";
import {
  normalizeTablature,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  TAB_TUNING,
  type TabNote,
  type Tablature
} from "./tablature";

/**
 * For a completed projection: selected = placed + outOfRange + unassigned.
 * carried/shortened are boundary annotations on emitted notes, not losses;
 * a note spanning both selection boundaries legitimately increments both.
 */
export interface AudioTablatureCounts {
  /** Source events intersecting the requested absolute interval. */
  selected: number;
  placed: number;
  /** Selected pitches outside standard EADGBE with frets 0–24. */
  outOfRange: number;
  /** Selected in-range notes the bounded fingering search could not place. */
  unassigned: number;
  /** Emitted notes whose detected release extends past the selection end. */
  shortened: number;
  /** Emitted notes already sounding at the selection start, not new attacks. */
  carried: number;
}

export type AudioTablatureUnavailableReason =
  | "invalidRange"
  | "invalidTempo"
  | "invalidNotes"
  | "incompleteCoverage"
  | "selectShorter"
  | "noPlayableNotes";

export type AudioTablatureProjection =
  | {
      status: "ready";
      tab: Tablature;
      range: ChordRange;
      tempo: number;
      counts: AudioTablatureCounts;
      assumptions: {
        tuning: "EADGBE";
        minFret: 0;
        maxFret: 24;
        meter: "4/4";
        layoutOnly: true;
      };
    }
  | {
      status: "unavailable";
      reason: AudioTablatureUnavailableReason;
      limit?: "notes" | "bars";
      counts?: AudioTablatureCounts;
    };

// This is the document's numerical precision, not a musical quantization grid.
const UNITS_PER_TICK = 960;
const BAR_UNITS = 4 * TAB_TICKS_PER_BEAT * UNITS_PER_TICK;
const BEAM_WIDTH = 16;
const MAX_FRET_SPAN = 4;
const FIXED_VELOCITY = 96;

interface Candidate {
  source: AudioNoteEvent;
  sourceIndex: number;
  start: number;
  end: number;
  positions: Array<{ string: number; fret: number }>;
}
interface HeldNote {
  fret: number;
  end: number;
}
interface Placement {
  candidate: Candidate;
  string: number;
  fret: number;
  parent: Placement | null;
}
interface FingeringState {
  held: Array<HeldNote | null>;
  path: Placement | null;
  placed: number;
  evidence: number;
  cost: number;
  position: number;
  lastString: number;
  order: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function validEvent(event: AudioNoteEvent): boolean {
  return (
    !!event &&
    finite(event.start) &&
    finite(event.end) &&
    event.start >= 0 &&
    event.end > event.start &&
    Number.isInteger(event.midi) &&
    event.midi >= 0 &&
    event.midi <= 127 &&
    finite(event.noteEvidence) &&
    event.noteEvidence >= 0 &&
    event.noteEvidence <= 1 &&
    finite(event.onsetEvidence) &&
    event.onsetEvidence >= 0 &&
    event.onsetEvidence <= 1
  );
}

/** Conservative four-finger geometry, including barres over compatible strings. */
function playableShape(held: Array<HeldNote | null>): boolean {
  const fretted = held.flatMap((note, string) =>
    note && note.fret > 0 ? [{ string, fret: note.fret }] : []
  );
  if (!fretted.length) return true;
  const frets = fretted.map((note) => note.fret);
  if (Math.max(...frets) - Math.min(...frets) > MAX_FRET_SPAN) return false;
  if (fretted.length <= 4) return true;
  if (new Set(frets).size > 4) return false;

  const covers = fretted.map((_, index) => 1 << index);
  for (let first = 0; first < fretted.length; first++) {
    for (let last = first + 1; last < fretted.length; last++) {
      const from = fretted[first];
      const to = fretted[last];
      if (from.fret !== to.fret) continue;
      // A barre cannot pass over a sounding open or lower-fretted string.
      if (
        held.some(
          (note, string) =>
            note &&
            string > from.string &&
            string < to.string &&
            note.fret < from.fret
        )
      )
        continue;
      let mask = 0;
      fretted.forEach((note, index) => {
        if (
          note.fret === from.fret &&
          note.string >= from.string &&
          note.string <= to.string
        )
          mask |= 1 << index;
      });
      covers.push(mask);
    }
  }
  // At most six fretted strings: this search has at most 64 states.
  const full = (1 << fretted.length) - 1;
  const fingers = new Uint8Array(full + 1).fill(7);
  fingers[0] = 0;
  for (let mask = 0; mask < full; mask++) {
    if (fingers[mask] >= 4) continue;
    const firstMissing = (~mask & full) & -(~mask & full);
    for (const cover of covers) {
      if (!(cover & firstMissing)) continue;
      const next = mask | cover;
      fingers[next] = Math.min(fingers[next], fingers[mask] + 1);
    }
  }
  return fingers[full] <= 4;
}

const compareStates = (a: FingeringState, b: FingeringState) =>
  b.placed - a.placed ||
  b.evidence - a.evidence ||
  a.cost - b.cost ||
  a.order - b.order;

function stateKey(state: FingeringState): string {
  return `${state.held
    .map((note) => (note ? `${note.fret}:${note.end}` : "-"))
    .join("|")}/${state.position}/${state.lastString}`;
}

function placeNotes(candidates: Candidate[]): Placement[] {
  let serial = 0;
  let beam: FingeringState[] = [
    {
      held: Array.from({ length: TAB_TUNING.length }, () => null),
      path: null,
      placed: 0,
      evidence: 0,
      cost: 0,
      position: 0,
      lastString: 0,
      order: serial++
    }
  ];
  const shapeCache = new Map<string, boolean>();
  for (const candidate of candidates) {
    const next: FingeringState[] = [];
    for (const previous of beam) {
      const held = previous.held.map((note) =>
        note && note.end > candidate.start ? note : null
      );
      // An unassigned note is explicit in the final counts. Do not shorten a
      // previously detected sustain merely to free its string for this note.
      next.push({ ...previous, held, order: serial++ });
      for (const position of candidate.positions) {
        if (held[position.string]) continue;
        const sounding = held.slice();
        sounding[position.string] = {
          fret: position.fret,
          end: candidate.end
        };
        const shapeKey = sounding.map((note) => note?.fret ?? -1).join(",");
        let playable = shapeCache.get(shapeKey);
        if (playable === undefined) {
          playable = playableShape(sounding);
          if (shapeCache.size >= 512) shapeCache.clear();
          shapeCache.set(shapeKey, playable);
        }
        if (!playable) continue;
        const frets = sounding.flatMap((note) =>
          note && note.fret > 0 ? [note.fret] : []
        );
        const hand = frets.length ? Math.min(...frets) : previous.position;
        const span = frets.length ? Math.max(...frets) - hand : 0;
        next.push({
          held: sounding,
          path: {
            candidate,
            ...position,
            parent: previous.path
          },
          placed: previous.placed + 1,
          evidence:
            previous.evidence +
            candidate.source.noteEvidence +
            candidate.source.onsetEvidence,
          cost:
            previous.cost +
            Math.abs(hand - previous.position) * 0.25 +
            span * 0.2 +
            position.fret * 0.08 +
            Math.abs(position.string - previous.lastString) * 0.02,
          position: hand,
          lastString: position.string,
          order: serial++
        });
      }
    }
    next.sort(compareStates);
    const seen = new Set<string>();
    beam = [];
    for (const state of next) {
      const key = stateKey(state);
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(state);
      if (beam.length === BEAM_WIDTH) break;
    }
  }
  const placements: Placement[] = [];
  for (let entry = beam[0].path; entry; entry = entry.parent)
    placements.push(entry);
  return placements.sort(
    (a, b) => a.candidate.start - b.candidate.start || a.string - b.string
  );
}

/**
 * Project detected pitches, never chord templates, onto one standard guitar.
 * The bounded search proposes a fingering; it does not recover original strings.
 * A 4/4 layout is assumed. Source timing remains continuous to the v3 storage
 * precision, with tick zero at range.start. Changing BPM regenerates ticks from
 * source seconds, rather than stretching the recording's timing.
 */
export function projectAudioTablature(
  notes: AudioNoteTranscription,
  range: ChordRange,
  tempo: number
): AudioTablatureProjection {
  if (
    !range ||
    !finite(range.start) ||
    !finite(range.end) ||
    range.start < 0 ||
    range.end <= range.start
  )
    return { status: "unavailable", reason: "invalidRange" };
  if (!finite(tempo) || tempo < 40 || tempo > 200)
    return { status: "unavailable", reason: "invalidTempo" };
  if (
    !notes ||
    notes.version !== 1 ||
    notes.limit !== 24000 ||
    typeof notes.truncated !== "boolean" ||
    !finite(notes.coverageEnd) ||
    notes.coverageEnd < 0 ||
    !Array.isArray(notes.events) ||
    notes.events.length > notes.limit ||
    !notes.events.every(validEvent)
  )
    return { status: "unavailable", reason: "invalidNotes" };
  if (range.end > notes.coverageEnd)
    return { status: "unavailable", reason: "incompleteCoverage" };

  const bpm = Math.round(tempo);
  const unitsPerSecond = (bpm * TAB_TICKS_PER_BEAT * UNITS_PER_TICK) / 60;
  const duration = Math.round((range.end - range.start) * unitsPerSecond);
  if (duration > TAB_MAX_BARS * BAR_UNITS)
    return { status: "unavailable", reason: "selectShorter", limit: "bars" };
  const counts: AudioTablatureCounts = {
    selected: 0,
    placed: 0,
    outOfRange: 0,
    unassigned: 0,
    shortened: 0,
    carried: 0
  };
  const candidates: Candidate[] = [];
  for (const [sourceIndex, source] of notes.events.entries()) {
    if (source.end <= range.start || source.start >= range.end) continue;
    counts.selected++;
    const positions = TAB_TUNING.flatMap((open, string) => {
      const fret = source.midi - open;
      return fret >= 0 && fret <= 24 ? [{ string, fret }] : [];
    });
    if (!positions.length) {
      counts.outOfRange++;
      continue;
    }
    const start = Math.max(
      0,
      Math.round(
        (Math.max(source.start, range.start) - range.start) * unitsPerSecond
      )
    );
    const end = Math.min(
      duration,
      Math.round(
        (Math.min(source.end, range.end) - range.start) * unitsPerSecond
      )
    );
    if (end <= start) {
      counts.unassigned++;
      continue;
    }
    candidates.push({ source, sourceIndex, start, end, positions });
  }
  if (candidates.length > TAB_MAX_NOTES)
    return {
      status: "unavailable",
      reason: "selectShorter",
      limit: "notes",
      counts
    };
  candidates.sort(
    (a, b) =>
      a.start - b.start ||
      a.positions.length - b.positions.length ||
      b.source.noteEvidence +
        b.source.onsetEvidence -
        a.source.noteEvidence -
        a.source.onsetEvidence ||
      a.sourceIndex - b.sourceIndex
  );
  const placements = placeNotes(candidates);
  counts.placed = placements.length;
  counts.unassigned = counts.selected - counts.outOfRange - counts.placed;
  counts.carried = placements.filter(
    ({ candidate }) => candidate.source.start < range.start
  ).length;
  counts.shortened = placements.filter(
    ({ candidate }) => candidate.source.end > range.end
  ).length;
  if (!placements.length)
    return { status: "unavailable", reason: "noPlayableNotes", counts };

  const projected: TabNote[] = placements.map(({ candidate, string, fret }) => ({
    string,
    fret,
    tick: candidate.start / UNITS_PER_TICK,
    duration: (candidate.end - candidate.start) / UNITS_PER_TICK,
    velocity: FIXED_VELOCITY
  }));
  const tab = normalizeTablature({
    version: 3,
    tempo: bpm,
    beatsPerBar: 4,
    beatUnit: 4,
    barCount: Math.max(1, Math.ceil(duration / BAR_UNITS)),
    notes: projected,
    rests: []
  });
  // The existing normalizer may deduplicate attacks or clip same-string tails.
  // Generated tablature must already satisfy those constraints without loss.
  if (!tab || JSON.stringify(tab.notes) !== JSON.stringify(projected))
    return { status: "unavailable", reason: "invalidNotes", counts };
  return {
    status: "ready",
    tab,
    range: { ...range },
    tempo: bpm,
    counts,
    assumptions: {
      tuning: "EADGBE",
      minFret: 0,
      maxFret: 24,
      meter: "4/4",
      layoutOnly: true
    }
  };
}
