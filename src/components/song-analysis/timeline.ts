import type { SongAnalysis } from "./types";
import { chordPattern, transposeChord } from "../../screens/song/chords";

export type Interval = { start: number; end: number };
/** End-exclusive lookup keeps silence and instrumental gaps genuinely empty. */
export function activeInterval<T extends Interval>(
  items: readonly T[],
  seconds: number
): number {
  if (!Number.isFinite(seconds) || seconds < 0) return -1;
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (items[middle].start <= seconds) low = middle + 1;
    else high = middle - 1;
  }
  return high >= 0 && seconds < items[high].end ? high : -1;
}

export function timelineAt(analysis: SongAnalysis, positionMs: number) {
  const seconds = positionMs / 1000;
  const line = activeInterval(analysis.lyrics, seconds);
  return {
    line,
    word: line < 0 ? -1 : activeInterval(analysis.lyrics[line].words, seconds),
    chord: activeInterval(analysis.chords, seconds)
  };
}

export function chordDisplay(
  sounding: string,
  transpose: number,
  capo: number
) {
  return {
    original: sounding,
    target: transposeHarmony(sounding, transpose),
    fingering: transposeHarmony(sounding, transpose - capo)
  };
}

function transposeHarmony(chord: string, semitones: number): string {
  if (chordPattern.test(chord) || semitones === 0)
    return transposeChord(chord, semitones);
  // Recognized harmony can be richer than the existing guitar-shape vocabulary.
  // Preserve its quality; move only the root and an absolute slash-bass note.
  const parts = chord.match(
    /^([A-G][#b]?)(:[^\s/]+|(?:mMaj|maj|min|dim|aug|sus|add|m|M)?[0-9#b()+,-]*)(?:\/([A-G][#b]?|[#b]*\d+))?$/
  );
  if (!parts) return chord;
  const [, root, quality, bass] = parts;
  const shiftedBass =
    bass && /^[A-G]/.test(bass) ? transposeChord(bass, semitones) : bass;
  return `${transposeChord(root, semitones)}${quality}${shiftedBass ? `/${shiftedBass}` : ""}`;
}

export function formatTime(seconds: number) {
  const value =
    Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10) / 10;
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

export function parseTime(value: string): number {
  const clean = value.trim().replace(",", ".");
  if (!/^(?:\d+:)?\d+(?:\.\d+)?$/.test(clean)) return NaN;
  const parts = clean.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 2 && parts[1] >= 60) return NaN;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}
