import type { ChordSegment, OfflineChordAnalysis } from "./offline-chords";

export interface ChordRange {
  start: number;
  end: number;
}

export type ChordSectionRow =
  | (ChordSegment & {
      kind: "chord";
      sourceStart: number;
      sourceEnd: number;
      startClipped: boolean;
      endClipped: boolean;
    })
  | (ChordRange & { kind: "gap" });

export interface OfflineChordSection extends ChordRange {
  rows: ChordSectionRow[];
  unknownSeconds: number;
  missingSeconds: number;
}

function parseTime(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!/^\d+(?::[0-5]?\d)?(?:\.\d{1,3})?$/.test(value)) return null;
  const parts = value.split(":");
  const [seconds, fraction = ""] = parts[parts.length - 1].split(".");
  // Sum integer units before dividing once. Adding fractional seconds to
  // minutes could otherwise disagree with the identical displayed EOF value.
  const milliseconds =
    (parts.length === 2 ? Number(parts[0]) * 60000 : 0) +
    Number(seconds) * 1000 +
    Number(fraction.padEnd(3, "0"));
  return Number.isSafeInteger(milliseconds) ? milliseconds / 1000 : null;
}

/** Accept seconds or MM:SS.sss; the displayed recording end means its exact end. */
export function parseChordRange(
  startText: string,
  endText: string,
  duration: number
): ChordRange | null {
  const start = parseTime(startText);
  let end = parseTime(endText);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    start === null ||
    end === null
  )
    return null;
  // chordTime displays hundredths; rounding must not drop or reject the tail.
  if (end === Math.round(duration * 100) / 100) end = duration;
  return start >= 0 && start < end && end <= duration ? { start, end } : null;
}

/** Inspect a validated full-recording result without rerunning its analyzer. */
export function chordSection(
  result: OfflineChordAnalysis,
  range: ChordRange = { start: 0, end: result.duration }
): OfflineChordSection {
  const { start, end } = range;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= end ||
    end > result.duration
  )
    throw new Error("InvalidChordSection");
  const rows: ChordSectionRow[] = [];
  let cursor = start;
  let unknownSeconds = 0;
  let missingSeconds = 0;
  const gap = (from: number, to: number) => {
    if (to <= from) return;
    rows.push({ kind: "gap", start: from, end: to });
    missingSeconds += to - from;
  };
  for (const segment of result.segments) {
    if (cursor >= end || segment.start >= end) break;
    if (segment.end <= cursor) continue;
    // The native validator tolerates sub-millisecond rounding overlaps. Keep
    // their source boundaries, but do not count the same instant twice.
    const from = Math.max(cursor, segment.start);
    const to = Math.min(end, segment.end);
    gap(cursor, from);
    rows.push({
      ...segment,
      kind: "chord",
      start: from,
      end: to,
      sourceStart: segment.start,
      sourceEnd: segment.end,
      startClipped: segment.start < start,
      endClipped: segment.end > end
    });
    if (segment.chord === "N") unknownSeconds += to - from;
    cursor = to;
  }
  gap(cursor, end);
  return { start, end, rows, unknownSeconds, missingSeconds };
}
