import { fromByteArray, toByteArray } from "base64-js";
import { performanceAudio } from "./performance-audio";

const clock = globalThis as typeof globalThis & {
  performance: { now: () => number };
};
type GuitarSample = { frequency: number; data: Float32Array };
function* decode(sample: {
  frequency: number;
  pcm: string;
}): Generator<void, GuitarSample> {
  const padding = sample.pcm.endsWith("==")
    ? 2
    : sample.pcm.endsWith("=")
      ? 1
      : 0;
  const data = new Float32Array(((sample.pcm.length * 3) / 4 - padding) / 2);
  let position = 0;
  // Each complete base64 chunk decodes to a whole number of PCM16 samples.
  for (let offset = 0; offset < sample.pcm.length; offset += 16384) {
    yield;
    const bytes = toByteArray(sample.pcm.slice(offset, offset + 16384));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length; i += 2)
      data[position++] = view.getInt16(i, true) / 32768;
  }
  return { frequency: sample.frequency, data };
}
const decoded = new Map<Parameters<typeof decode>[0], GuitarSample>();

const previews = new Map<string, string>();
const warming = new Map<
  string,
  { signals: Set<AbortSignal>; promise: Promise<string | undefined> }
>();
function* renderGuitar(
  notes: number[],
  reference: number,
  stringIndex?: number
): Generator<void, string> {
  const key = `${reference}:${notes.join(",")}${stringIndex === undefined ? "" : `:string${stringIndex}`}`;
  const cached = previews.get(key);
  if (cached) return cached;
  const samples: typeof import("../../assets/guitar-samples.json") = require("../../assets/guitar-samples.json");
  const rate = 22050;
  const mix = new Float32Array(rate * (notes.length > 1 ? 5 : 3));
  for (const [string, midi] of notes.entries()) {
    const frequency = reference * 2 ** ((midi - 69) / 12);
    const source =
      samples[stringIndex ?? -1] ??
      samples.reduce((best, item) =>
        Math.abs(Math.log2(item.frequency / frequency)) <
        Math.abs(Math.log2(best.frequency / frequency))
          ? item
          : best
      );
    let sample = decoded.get(source);
    if (!sample) {
      sample = yield* decode(source);
      decoded.set(source, sample);
    }
    const step = frequency / sample.frequency;
    const offset = Math.round(string * rate * 0.016);
    const length = Math.min(
      mix.length - offset,
      Math.floor((sample.data.length - 1) / step)
    );
    const attack = rate * 0.012;
    const release = rate * 0.16;
    const gain = 0.7 / Math.sqrt(notes.length);
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) yield;
      const position = i * step,
        index = Math.floor(position),
        fraction = position - index;
      const value =
        sample.data[index] * (1 - fraction) + sample.data[index + 1] * fraction;
      const fadeIn =
        i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1;
      const fadeOut =
        length - i < release
          ? 0.5 - 0.5 * Math.cos((Math.PI * (length - i)) / release)
          : 1;
      mix[i + offset] += value * fadeIn * fadeOut * gain;
    }
  }
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
  for (let i = 0; i < mix.length; i++) {
    if (i % 8192 === 0) yield;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mix[i])) * 32767, true);
  }
  const chunks: string[] = [];
  // A non-final chunk must contain complete base64 triplets.
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    yield;
    chunks.push(fromByteArray(bytes.subarray(offset, offset + 12288)));
  }
  const wave = chunks.join("");
  if (previews.size >= 32) previews.delete(previews.keys().next().value!);
  previews.set(key, wave);
  return wave;
}
export function prepareGuitar(
  notes: number[],
  reference = 440,
  stringIndex?: number
) {
  const render = renderGuitar(notes, reference, stringIndex);
  let step = render.next();
  while (!step.done) step = render.next();
  performanceAudio.prepareGuitar(
    `${reference}:${notes.join(",")}${stringIndex === undefined ? "" : `:string${stringIndex}`}`,
    step.value
  );
  return step.value;
}
async function prepareNativeGuitar(key: string, wave: string) {
  if (!performanceAudio.preparedFingeringSupported) {
    performanceAudio.prepareGuitar(key, wave);
    return;
  }
  // Probe native residency without retransmitting the WAV on every tap. The
  // promise also guarantees that worker-side decoding finishes before attack.
  if (await performanceAudio.prepareFingering(key, "")) return;
  if (!(await performanceAudio.prepareFingering(key, wave)))
    throw new Error("Guitar preparation failed");
}
async function warmGuitarWave(
  notes: number[],
  reference: number,
  signal: AbortSignal,
  stringIndex?: number
) {
  if (signal.aborted) return;
  const key = `${reference}:${notes.join(",")}${stringIndex === undefined ? "" : `:string${stringIndex}`}`;
  let task = warming.get(key);
  const cached = stringIndex === undefined && previews.get(key);
  if (cached && !task) return cached;
  if (!task) {
    const signals = new Set([signal]);
    const promise = (async () => {
      // Let the press/navigation render before any sample-bank decoding begins.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const render = renderGuitar(notes, reference, stringIndex);
      const active = () => [...signals].some((consumer) => !consumer.aborted);
      try {
        while (active()) {
          const deadline = clock.performance.now() + 4;
          do {
            const step = render.next();
            if (step.done) {
              await prepareNativeGuitar(key, step.value);
              return step.value;
            }
          } while (active() && clock.performance.now() < deadline);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        render.return("");
        warming.delete(key);
      }
    })();
    task = { signals, promise };
    warming.set(key, task);
  }
  task.signals.add(signal);
  try {
    const wave = await task.promise;
    return signal.aborted ? undefined : wave;
  } finally {
    task.signals.delete(signal);
  }
}
export async function warmGuitar(
  notes: number[],
  reference: number,
  signal: AbortSignal,
  stringIndex?: number
): Promise<void> {
  await warmGuitarWave(notes, reference, signal, stringIndex);
}
export async function playGuitar(
  notes: number[],
  reference = 440,
  signal = new AbortController().signal
) {
  if (!notes.length || signal.aborted) return;
  const key = `${reference}:${notes.join(",")}`;
  try {
    let wave = previews.get(key);
    if (!wave) wave = await warmGuitarWave(notes, reference, signal);
    else if (performanceAudio.preparedFingeringSupported)
      await prepareNativeGuitar(key, wave);
    else performanceAudio.prepareGuitar(key, wave);
    if (!signal.aborted && wave) performanceAudio.guitar(wave, key);
  } catch {
    // Preview callers are fire-and-forget; a disposed native player must not
    // leave an unhandled rejection after navigation.
  }
}
