import type { ChordRange } from "./offline-chord-section";
import type {
  AudioAttack,
  AudioNoteEvent,
  AudioNoteTranscription,
  AudioPlayingStyle,
  AudioRhythmAnalysis,
  AudioRhythmSection
} from "./audio-transcription";
import { TAB_TUNING } from "./tablature";

// These are conservative texture heuristics, not a technique-recognition model.
// A grouped attack cannot identify a hand, a finger, or an up/down stroke.
const ATTACK_SPREAD = 0.07;
const CONTEXT_SECONDS = 4;
const TIME_EPSILON = 1e-9;
const MAX_GUITAR_FRET = 24;

interface AttackEvidence extends AudioAttack {
  events: AudioNoteEvent[];
}

/** Necessary string capacity only; this does not recover a fingering. */
function canUseDistinctStrings(pitches: number[]): boolean {
  if (pitches.length > TAB_TUNING.length) return false;
  let states = new Set([0]);
  for (const pitch of pitches) {
    let compatible = 0;
    TAB_TUNING.forEach((open, string) => {
      if (pitch >= open && pitch <= open + MAX_GUITAR_FRET)
        compatible |= 1 << string;
    });
    const next = new Set<number>();
    for (const occupied of states) {
      for (let string = 0; string < TAB_TUNING.length; string++) {
        const bit = 1 << string;
        if (compatible & bit && !(occupied & bit)) next.add(occupied | bit);
      }
    }
    if (!next.size) return false;
    states = next;
  }
  return true;
}

function hasAssignableOverlaps(events: AudioNoteEvent[]): boolean {
  let active: AudioNoteEvent[] = [];
  // Events retain onset order. A released note frees its string even when its
  // attack belongs to the same 70 ms group as the following note.
  for (const event of events) {
    active = active.filter((note) => note.end > event.start);
    active.push(event);
    if (!canUseDistinctStrings(active.map((note) => note.midi))) return false;
  }
  return true;
}

function groupAttacks(notes: AudioNoteEvent[]): AttackEvidence[] {
  const groups: AttackEvidence[] = [];
  for (const note of notes) {
    // Use the standard six-string guitar range. The source is still a mix;
    // register filtering does not separate the guitar from other instruments.
    if (
      note.midi < TAB_TUNING[0] ||
      note.midi > TAB_TUNING[TAB_TUNING.length - 1] + MAX_GUITAR_FRET ||
      note.onsetEvidence < 0.5 ||
      note.noteEvidence < 0.35
    )
      continue;
    let group = groups[groups.length - 1];
    if (
      !group ||
      note.start - group.time > ATTACK_SPREAD + TIME_EPSILON ||
      group.pitches.includes(note.midi)
    ) {
      group = {
        time: note.start,
        spread: 0,
        pitches: [],
        events: [],
        kind: "single"
      };
      groups.push(group);
    }
    group.events.push(note);
    group.pitches.push(note.midi);
    group.spread = note.start - group.time;
  }
  for (const group of groups) {
    group.pitches.sort((a, b) => a - b);
    group.kind =
      group.pitches.length === 1
        ? "single"
        : group.pitches.length >= 3 &&
            group.pitches[group.pitches.length - 1] - group.pitches[0] >= 7 &&
            hasAssignableOverlaps(group.events)
          ? "chord"
          : "cluster";
  }
  return groups;
}

function playingStyle(
  groups: AttackEvidence[],
  end: number
): AudioPlayingStyle {
  if (groups.length < 4) return "undetermined";
  const chords = groups.filter((group) => group.kind === "chord").length;
  const singles = groups.filter((group) => group.kind === "single");
  const pitchClasses = new Set(
    singles.flatMap((group) => group.pitches).map((midi) => midi % 12)
  );
  // Successive attacks on different ringing pitches provide arpeggio evidence.
  // A monophonic melody alone must not be advertised as a picking pattern.
  let ringing = 0;
  for (let i = 1; i < singles.length; i++) {
    const previous = singles[i - 1].events[0];
    const next = singles[i].events[0];
    if (
      previous.midi !== next.midi &&
      Math.min(previous.end, next.end, end) - next.start >
        0.05 + TIME_EPSILON &&
      canUseDistinctStrings([previous.midi, next.midi])
    )
      ringing++;
  }
  const arpeggio =
    singles.length >= 4 &&
    pitchClasses.size >= 3 &&
    ringing / (singles.length - 1) >= 0.4;
  if (chords >= 3 && arpeggio && chords / groups.length >= 0.25) return "mixed";
  if (chords >= 3 && chords / groups.length >= 0.6) return "strumming";
  if (
    arpeggio &&
    singles.length / groups.length >= 0.65 &&
    chords / groups.length <= 0.2
  )
    return "picking";
  return "undetermined";
}

function overallStyle(
  sections: AudioRhythmSection[],
  duration: number
): AudioPlayingStyle {
  const lengths = { strumming: 0, picking: 0, mixed: 0, undetermined: 0 };
  for (const section of sections)
    lengths[section.style] += section.end - section.start;
  if (lengths.undetermined > duration * 0.5) return "undetermined";
  if (
    lengths.mixed >= duration * 0.2 ||
    (lengths.strumming >= duration * 0.2 && lengths.picking >= duration * 0.2)
  )
    return "mixed";
  if (lengths.strumming >= duration * 0.5) return "strumming";
  if (lengths.picking >= duration * 0.5) return "picking";
  return "undetermined";
}

/** Classify existing note attacks; never infer pick directions or a preset. */
export function analyzeAudioRhythm(
  notes: AudioNoteTranscription,
  range: ChordRange
): AudioRhythmAnalysis {
  const unavailable: AudioRhythmAnalysis = {
    style: "undetermined",
    complete: false,
    attackCount: 0,
    attacks: [],
    sections: []
  };
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.start >= range.end ||
    range.end > notes.coverageEnd
  )
    return unavailable;
  // Group the original timeline first, so selection cannot turn part of one
  // strum into invented separate picking attacks.
  const groups = groupAttacks(notes.events).filter(
    (group) =>
      !notes.truncated || group.time + ATTACK_SPREAD < notes.coverageEnd
  );
  const selected = groups.filter(
    (group) =>
      group.time >= range.start && group.time + group.spread < range.end
  );
  // Internal four-second bins are onset-anchored classification contexts, not
  // independently cropped transcriptions. Groups formed from the full recording
  // stay intact. The outer selection deliberately requires full containment, so
  // re-analyzing exact bin boundaries as a new selection can change its label.
  const sections: AudioRhythmSection[] = [];
  let cursor = 0;
  for (
    let start = Math.floor(range.start / CONTEXT_SECONDS) * CONTEXT_SECONDS;
    start < range.end;
    start += CONTEXT_SECONDS
  ) {
    const end = Math.min(start + CONTEXT_SECONDS, notes.coverageEnd);
    const window: AttackEvidence[] = [];
    // Assign a selected group by its first onset, even when later note attacks
    // cross the bin boundary; never split it or count it again in the next bin.
    while (cursor < selected.length && selected[cursor].time < end) {
      window.push(selected[cursor++]);
    }
    const clippedStart = Math.max(start, range.start);
    const clippedEnd = Math.min(end, range.end);
    const local = window.filter(
      (group) => group.time >= clippedStart && group.time < clippedEnd
    );
    const attackCount = local.length;
    // Technique evidence must belong to the selected passage. Nearby ringing
    // notes cannot turn a selected monophonic phrase or pause into picking.
    const style = playingStyle(local, clippedEnd);
    const previous = sections[sections.length - 1];
    if (previous?.style === style) {
      previous.end = clippedEnd;
      previous.attackCount += attackCount;
    } else {
      sections.push({
        start: clippedStart,
        end: clippedEnd,
        style,
        attackCount
      });
    }
  }
  return {
    style: overallStyle(sections, range.end - range.start),
    complete: true,
    attackCount: selected.length,
    attacks: selected.map(({ time, spread, pitches, kind }) => ({
      time,
      spread,
      pitches,
      kind
    })),
    sections
  };
}
