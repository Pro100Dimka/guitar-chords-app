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

const maxVisualizationSamples = 2048;
let spectrumPlan:
  | {
      length: number;
      rate: number;
      window: Float64Array;
      coefficients: Float64Array;
      samples: Float64Array;
    }
  | undefined;

const cleanSample = (sample: number) =>
  Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;

export function signalLevels(
  samples: number[],
  rate: number,
  spectrum: boolean
) {
  if (!samples.length || !Number.isFinite(rate) || rate <= 0) return [];
  // Only the latest visual frame is needed. Native pitch detection uses the
  // original audio; a delayed or oversized event must not block its display.
  const length = Math.min(samples.length, maxVisualizationSamples);
  const offset = samples.length - length;
  if (!spectrum) {
    let peak = 0.02;
    for (let i = offset; i < samples.length; i++)
      peak = Math.max(peak, Math.abs(cleanSample(samples[i])));
    return Array.from({ length: 128 }, (_, i) =>
      Math.max(
        -1,
        Math.min(
          1,
          cleanSample(samples[offset + Math.floor((i * length) / 128)]) / peak
        )
      )
    );
  }
  if (length === 1) return Array(32).fill(0) as number[];
  if (spectrumPlan?.length !== length || spectrumPlan.rate !== rate) {
    spectrumPlan = {
      length,
      rate,
      window: Float64Array.from(
        { length },
        (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
      ),
      coefficients: Float64Array.from({ length: 32 }, (_, i) => {
        const frequency = 55 * (Math.min(5000, rate * 0.45) / 55) ** (i / 31);
        return 2 * Math.cos((2 * Math.PI * frequency) / rate);
      }),
      samples: new Float64Array(length)
    };
  }
  const plan = spectrumPlan;
  for (let i = 0; i < length; i++)
    plan.samples[i] = cleanSample(samples[offset + i]) * plan.window[i];
  return Array.from({ length: 32 }, (_, i) => {
    const coefficient = plan.coefficients[i];
    let previous = 0;
    let before = 0;
    for (let j = 0; j < length; j++) {
      const next = plan.samples[j] + coefficient * previous - before;
      before = previous;
      previous = next;
    }
    const power = Math.max(
      0,
      previous ** 2 + before ** 2 - coefficient * previous * before
    );
    const amplitude = (4 * Math.sqrt(power)) / length;
    return Math.max(
      0,
      Math.min(1, (20 * Math.log10(Math.max(0.00001, amplitude)) + 70) / 70)
    );
  });
}
