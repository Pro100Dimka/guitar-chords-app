import { fromByteArray, toByteArray } from "base64-js";
import samples from "../../assets/guitar-samples.json";
import acoustic from "../../assets/strummed-acoustic.json";
import { performanceAudio } from "./performance-audio";

export const guitarSamples = samples;
export const chordNotes = acoustic.notes;
export function recordedChord(chord: string, capo = 0) {
  const match = /^([A-G])([#b]?)(m?)$/.exec(chord);
  if (!match) return undefined;
  const roots: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
  };
  const accidental: Record<string, number> = { "#": 1, b: -1 };
  const pitch =
    (((roots[match[1]] + (accidental[match[2]] ?? 0) + capo) % 12) + 12) % 12;
  return acoustic.chords[pitch + (match[3] ? 12 : 0)];
}
const decode = (sample: { frequency: number; pcm: string }) => {
  const bytes = toByteArray(sample.pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    frequency: sample.frequency,
    data: Float32Array.from(
      { length: bytes.length / 2 },
      (_, i) => view.getInt16(i * 2, true) / 32768
    )
  };
};
const decoded = samples.map(decode);
const decodedChords = chordNotes.map(decode);

const previews = new Map<string, string>();
export function prepareGuitar(notes: number[], chord?: string) {
  const recorded = chord ? recordedChord(chord) : undefined;
  const key = `${recorded?.name ?? "notes"}:${notes.join(",")}`;
  const cached = previews.get(key);
  if (cached) return cached;
  const rate = 22050;
  const mix = recorded
    ? decode({ frequency: 0, pcm: recorded.pcm }).data
    : new Float32Array(rate * (notes.length > 1 ? 5 : 3));
  if (!recorded)
    notes.forEach((midi, string) => {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const sample = (notes.length > 1 ? decodedChords : decoded).reduce(
        (best, item) =>
          Math.abs(Math.log2(item.frequency / frequency)) <
          Math.abs(Math.log2(best.frequency / frequency))
            ? item
            : best
      );
      const step = frequency / sample.frequency;
      const offset = Math.round(string * rate * 0.016);
      const length = Math.min(
        mix.length - offset,
        Math.floor((sample.data.length - 1) / step)
      );
      for (let i = 0; i < length; i++) {
        const position = i * step,
          index = Math.floor(position),
          fraction = position - index;
        const value =
          sample.data[index] * (1 - fraction) +
          sample.data[index + 1] * fraction;
        mix[i + offset] +=
          (value *
            (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, i / (rate * 0.012)))) *
            Math.min(1, (length - i) / 900) *
            0.7) /
          Math.sqrt(notes.length);
      }
    });
  const bytes = new Uint8Array(44 + mix.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => (bytes[offset + i] = char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, mix.length * 2, true);
  mix.forEach((value, i) =>
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true)
  );
  const wave = fromByteArray(bytes);
  if (previews.size >= 32) previews.delete(previews.keys().next().value!);
  previews.set(key, wave);
  return wave;
}
export function playGuitar(notes: number[], chord?: string) {
  if (notes.length) performanceAudio.guitar(prepareGuitar(notes, chord));
}
