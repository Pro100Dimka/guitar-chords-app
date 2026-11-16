import { INote } from "@/@interfaces";
import { noteNames } from "./tunings";

export function calibratedNote(pitch: number, reference: number): INote | null {
  if (
    !Number.isFinite(pitch) ||
    pitch <= 0 ||
    !Number.isFinite(reference) ||
    reference <= 0
  )
    return null;
  const midi = Math.round(69 + 12 * Math.log2(pitch / reference));
  const refFreq = reference * 2 ** ((midi - 69) / 12);
  const cents = 1200 * Math.log2(pitch / refFreq);
  return {
    name: noteNames[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    pitch,
    refFreq,
    direction: Math.abs(cents) <= 5 ? "=" : cents < 0 ? "<" : ">"
  };
}

export function signalLevels(
  samples: number[],
  rate: number,
  spectrum: boolean
) {
  if (!samples.length || !Number.isFinite(rate) || rate <= 0) return [];
  let peak = 0.02;
  const clean = samples.map((sample) => {
    const value = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;
    peak = Math.max(peak, Math.abs(value));
    return value;
  });
  if (!spectrum) {
    return Array.from({ length: 128 }, (_, i) =>
      Math.max(
        -1,
        Math.min(1, clean[Math.floor((i * clean.length) / 128)] / peak)
      )
    );
  }
  if (clean.length === 1) return Array(32).fill(0) as number[];
  const windowed = clean.map(
    (sample, i) =>
      sample * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (samples.length - 1)))
  );
  return Array.from({ length: 32 }, (_, i) => {
    const frequency = 55 * (Math.min(5000, rate * 0.45) / 55) ** (i / 31);
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / rate);
    let previous = 0;
    let before = 0;
    for (const sample of windowed) {
      const next = sample + coefficient * previous - before;
      before = previous;
      previous = next;
    }
    const power = Math.max(
      0,
      previous ** 2 + before ** 2 - coefficient * previous * before
    );
    const amplitude = (4 * Math.sqrt(power)) / samples.length;
    return Math.max(
      0,
      Math.min(1, (20 * Math.log10(Math.max(0.00001, amplitude)) + 70) / 70)
    );
  });
}
