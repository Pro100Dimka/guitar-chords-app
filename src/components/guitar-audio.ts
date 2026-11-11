import { fromByteArray, toByteArray } from "base64-js";
import samples from "../../assets/guitar-samples.json";
import { performanceAudio } from "./performance-audio";

export const guitarSamples = samples;
const decoded = samples.map((sample) => {
  const bytes = toByteArray(sample.pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    frequency: sample.frequency,
    data: Float32Array.from(
      { length: bytes.length / 2 },
      (_, i) => view.getInt16(i * 2, true) / 32768
    )
  };
});

export function playGuitar(notes: number[]) {
  if (!notes.length) return;
  const rate = 22050;
  const mix = new Float32Array(rate * 3);
  notes.forEach((midi, string) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const sample = decoded.reduce((best, item) =>
      Math.abs(Math.log2(item.frequency / frequency)) <
      Math.abs(Math.log2(best.frequency / frequency))
        ? item
        : best
    );
    const step = frequency / sample.frequency;
    const offset = Math.round(string * rate * 0.025);
    const length = Math.min(
      mix.length - offset,
      Math.floor((sample.data.length - 1) / step)
    );
    for (let i = 0; i < length; i++) {
      const position = i * step,
        index = Math.floor(position),
        fraction = position - index;
      const value =
        sample.data[index] * (1 - fraction) + sample.data[index + 1] * fraction;
      mix[i + offset] +=
        (value * Math.min(1, i / 80, (length - i) / 600) * 0.7) /
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
  performanceAudio.guitar(fromByteArray(bytes));
}
