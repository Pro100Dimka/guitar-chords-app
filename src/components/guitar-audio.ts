import { fromByteArray, toByteArray } from "base64-js";
import { performanceAudio } from "./performance-audio";

const decode = (sample: { frequency: number; pcm: string }) => {
  const bytes = toByteArray(sample.pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = new Float32Array(bytes.length / 2);
  for (let i = 0; i < data.length; i++)
    data[i] = view.getInt16(i * 2, true) / 32768;
  return {
    frequency: sample.frequency,
    data
  };
};
const decoded = new Map<
  Parameters<typeof decode>[0],
  ReturnType<typeof decode>
>();

const previews = new Map<string, string>();
export function prepareGuitar(notes: number[], reference = 440) {
  const key = `${reference}:${notes.join(",")}`;
  const cached = previews.get(key);
  if (cached) {
    performanceAudio.prepareGuitar(key, cached);
    return cached;
  }
  const samples: typeof import("../../assets/guitar-samples.json") = require("../../assets/guitar-samples.json");
  const rate = 22050;
  const mix = new Float32Array(rate * (notes.length > 1 ? 5 : 3));
  notes.forEach((midi, string) => {
    const frequency = reference * 2 ** ((midi - 69) / 12);
    const source = samples.reduce((best, item) =>
      Math.abs(Math.log2(item.frequency / frequency)) <
      Math.abs(Math.log2(best.frequency / frequency))
        ? item
        : best
    );
    let sample = decoded.get(source);
    if (!sample) {
      sample = decode(source);
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
  for (let i = 0; i < mix.length; i++)
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mix[i])) * 32767, true);
  const wave = fromByteArray(bytes);
  if (previews.size >= 32) previews.delete(previews.keys().next().value!);
  previews.set(key, wave);
  performanceAudio.prepareGuitar(key, wave);
  return wave;
}
export function playGuitar(notes: number[], reference = 440) {
  if (notes.length)
    performanceAudio.guitar(
      prepareGuitar(notes, reference),
      `${reference}:${notes.join(",")}`
    );
}
