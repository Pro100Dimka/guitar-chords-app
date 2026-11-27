import type { ChordRange } from "./offline-chord-section";

/** Evidence from the note model; these values are not calibrated probabilities. */
export interface AudioNoteEvent {
  start: number;
  end: number;
  midi: number;
  noteEvidence: number;
  onsetEvidence: number;
}

export interface AudioNoteTranscription {
  version: 1;
  events: AudioNoteEvent[];
  limit: 24000;
  truncated: boolean;
  /** All decoded attacks before this absolute time are present. */
  coverageEnd: number;
}

export type AudioPlayingStyle =
  | "strumming"
  | "picking"
  | "mixed"
  | "undetermined";

export interface AudioAttack {
  time: number;
  spread: number;
  pitches: number[];
  kind: "single" | "chord" | "cluster";
}

export interface AudioRhythmSection extends ChordRange {
  style: AudioPlayingStyle;
  attackCount: number;
}

export interface AudioRhythmAnalysis {
  style: AudioPlayingStyle;
  complete: boolean;
  attackCount: number;
  attacks: AudioAttack[];
  sections: AudioRhythmSection[];
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const noteFields = [
  "noteEvents",
  "noteEventsVersion",
  "noteEventsLimit",
  "noteEventsTruncated",
  "noteEventsCoverageEnd"
] as const;

/** Legacy chord results may omit the extension; partial or corrupt ones fail. */
export function decodeAudioNoteTranscription(
  value: Record<string, unknown>,
  duration: number
): AudioNoteTranscription | undefined {
  if (noteFields.every((field) => value[field] === undefined)) return undefined;
  if (
    value.engine !== "chroma-v2" ||
    value.noteEventsVersion !== 1 ||
    value.noteEventsLimit !== 24000 ||
    typeof value.noteEventsTruncated !== "boolean" ||
    !finite(duration) ||
    duration <= 0 ||
    !finite(value.noteEventsCoverageEnd) ||
    value.noteEventsCoverageEnd < 0 ||
    value.noteEventsCoverageEnd > duration + 0.000001 ||
    !Array.isArray(value.noteEvents) ||
    value.noteEvents.length > 24000 ||
    (value.noteEventsTruncated &&
      (value.noteEvents.length !== 24000 ||
        value.noteEventsCoverageEnd >= duration)) ||
    (!value.noteEventsTruncated &&
      Math.abs(value.noteEventsCoverageEnd - duration) > 0.000001)
  )
    throw new Error("InvalidNoteTranscription");
  const coverageEnd = value.noteEventsTruncated
    ? value.noteEventsCoverageEnd
    : duration;
  const lastPitchEnd = new Map<number, number>();
  const events: AudioNoteEvent[] = [];
  for (const item of value.noteEvents) {
    if (
      !record(item) ||
      !finite(item.start) ||
      !finite(item.end) ||
      item.start < 0 ||
      item.start >= duration ||
      item.end <= item.start ||
      item.end > duration + 0.000001 ||
      !finite(item.midi) ||
      !Number.isInteger(item.midi) ||
      item.midi < 21 ||
      item.midi > 108 ||
      !finite(item.noteEvidence) ||
      item.noteEvidence < 0 ||
      item.noteEvidence > 1 ||
      !finite(item.onsetEvidence) ||
      item.onsetEvidence < 0 ||
      item.onsetEvidence > 1 ||
      (value.noteEventsTruncated && item.start > coverageEnd)
    )
      throw new Error("InvalidNoteTranscription");
    const previous = events[events.length - 1];
    if (
      (previous &&
        (item.start < previous.start ||
          (item.start === previous.start && item.midi < previous.midi))) ||
      item.start < (lastPitchEnd.get(item.midi) ?? 0)
    )
      throw new Error("InvalidNoteTranscription");
    const end = Math.min(item.end, duration);
    events.push({
      start: item.start,
      end,
      midi: item.midi,
      noteEvidence: item.noteEvidence,
      onsetEvidence: item.onsetEvidence
    });
    lastPitchEnd.set(item.midi, end);
  }
  return {
    version: 1,
    events,
    limit: 24000,
    truncated: value.noteEventsTruncated,
    coverageEnd
  };
}
