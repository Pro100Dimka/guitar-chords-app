import { fromByteArray, toByteArray } from "base64-js";
import { performanceAudio } from "./performance-audio";
import {
  TAB_TECHNIQUES,
  TAB_TICKS_PER_BEAT,
  TAB_TUNING,
  tabNoteDuration,
  TabNote
} from "./tablature";

type GuitarExpression = Pick<
  TabNote,
  | "velocity"
  | "techniques"
  | "bend"
  | "bendRelease"
  | "accent"
  | "fade"
  | "pick"
> & {
  seconds: number;
  sourceInterval: number;
  harmonicInterval: number;
  repeatSeconds: number;
};
const guitarKey = (
  notes: number[],
  reference: number,
  stringIndex?: number,
  expression?: GuitarExpression
) =>
  `${reference}:${notes.join(",")}${stringIndex === undefined ? "" : `:string${stringIndex}`}${expression ? `:${JSON.stringify([expression.velocity, expression.techniques?.map((key) => Object.keys(TAB_TECHNIQUES).indexOf(key)), expression.bend, expression.bendRelease, expression.accent, expression.fade, expression.pick, expression.seconds, expression.sourceInterval, expression.harmonicInterval, expression.repeatSeconds])}` : ""}`;
export function tabNoteExpression(
  note: TabNote,
  tempo: number
): GuitarExpression | undefined {
  if (
    !(
      note.techniques?.length ||
      note.velocity !== undefined ||
      note.accent ||
      note.fade ||
      note.pick
    )
  )
    return undefined;
  return {
    velocity: note.velocity,
    techniques: [...(note.techniques ?? [])].sort(),
    bend: note.bend,
    bendRelease: note.bendRelease,
    accent: note.accent,
    fade: note.fade,
    pick: note.pick,
    seconds: Math.min(
      6,
      Math.max(
        0.025,
        ((tabNoteDuration(note) / TAB_TICKS_PER_BEAT) *
          60 *
          (note.fermata ? 2 : 1)) /
          tempo
      )
    ),
    sourceInterval: (note.sourceFret ?? Math.max(0, note.fret - 2)) - note.fret,
    harmonicInterval:
      ({ 5: 19, 7: 12, 12: 0 } as Record<number, number>)[note.fret] ?? 12,
    repeatSeconds: 60 / tempo / 8
  };
}
export const guitarNoteKey = (note: TabNote, tempo: number) =>
  guitarKey(
    [TAB_TUNING[note.string] + note.fret],
    440,
    note.string,
    tabNoteExpression(note, tempo)
  );

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
  stringIndex?: number,
  expression?: GuitarExpression
): Generator<void, string> {
  const key = guitarKey(notes, reference, stringIndex, expression);
  const cached = previews.get(key);
  if (cached) return cached;
  const samples: typeof import("../../assets/guitar-samples.json") = require("../../assets/guitar-samples.json");
  const rate = 22050;
  const mix = new Float32Array(
    Math.ceil(
      rate * Math.max(notes.length > 1 ? 5 : 3, expression?.seconds ?? 0)
    )
  );
  const techniques = new Set(expression?.techniques);
  const tremolo = techniques.has("tremolo");
  const rasgueado = techniques.has("rasgueado");
  const repeatPeriod = Math.max(1, Math.round(rate * (tremolo ? expression?.repeatSeconds ?? 0.1 : 0.045)));
  const accentGain = expression?.accent
    ? { accent: 1.15, strong: 1.35, staccato: 1, ghost: 0.45, dead: 0.6 }[
        expression.accent
      ]
    : 1;
  const fadeGain = expression?.fade
    ? {
        in: (progress: number) => Math.min(1, progress * 3),
        out: (progress: number) => 1 - progress,
        crescendo: (progress: number) => 0.3 + progress * 0.7,
        diminuendo: (progress: number) => 1 - progress * 0.7
      }[expression.fade]
    : undefined;
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
    const brush =
      expression?.pick &&
      (
        {
          downBrush: stringIndex ?? 0,
          upBrush: 5 - (stringIndex ?? 0),
          arpeggio: (stringIndex ?? 0) * 2
        } as Record<string, number>
      )[expression.pick];
    const offset = Math.round(rate * (string * 0.016 + (brush || 0) * 0.012));
    const length = Math.min(
      mix.length - offset,
      Math.floor((sample.data.length - 1) / step)
    );
    const attack =
      rate *
      (techniques.has("hammerOn") ||
      techniques.has("pullOff") ||
      techniques.has("tapping")
        ? 0.025
        : 0.012);
    const release = rate * 0.16;
    const gain =
      (0.7 / Math.sqrt(notes.length)) *
      Math.sqrt((expression?.velocity ?? 64) / 64);
    let phase = 0;
    let filtered = 0;
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) yield;
      const time = expression ? i / rate : 0;
      const progress = expression ? Math.min(1, time / expression.seconds) : 0;
      let semitones = 0;
      const repeated = tremolo || (rasgueado && time < 0.18);
      const attackFrame = repeated ? i % repeatPeriod : 0;
      if (repeated && attackFrame === 0) phase = 0;
      if (expression && techniques.size) {
        if (techniques.has("bend")) {
          const curve =
            expression?.bendRelease && progress > 0.65
              ? (1 - progress) / 0.35
              : Math.min(1, progress / 0.5);
          semitones += (expression?.bend ?? 1) * 2 * Math.max(0, curve);
        }
        if (techniques.has("slide"))
          semitones +=
            (expression?.sourceInterval ?? -2) * Math.max(0, 1 - progress * 4);
        if (techniques.has("hammerOn") || techniques.has("pullOff"))
          semitones +=
            (expression?.sourceInterval ?? -2) * Math.exp(-time * 100);
        if (techniques.has("vibrato"))
          semitones +=
            Math.sin(time * Math.PI * 11) * 0.2 * Math.min(1, progress * 4);
        if (techniques.has("whammy"))
          semitones -= Math.sin(progress * Math.PI) * 3;
        if (techniques.has("harmonic"))
          semitones += expression?.harmonicInterval ?? 12;
        if (techniques.has("trill"))
          semitones += Math.floor(time * 14) % 2 ? 2 : 0;
        if (techniques.has("grace") && time < 0.045)
          semitones += expression?.sourceInterval ?? -2;
        if (techniques.has("mordent") && time >= 0.04 && time < 0.09)
          semitones -= 1;
        if (techniques.has("turn") && time < 0.16)
          semitones += [1, 0, -1, 0][Math.min(3, Math.floor(time / 0.04))];
      }
      const position = expression ? phase : i * step,
        index = Math.floor(position),
        fraction = position - index;
      if (index + 1 >= sample.data.length) break;
      if (expression) phase += step * (semitones ? 2 ** (semitones / 12) : 1);
      let value =
        sample.data[index] * (1 - fraction) + sample.data[index + 1] * fraction;
      if (expression) {
        const muted =
          techniques.has("palmMute") ||
          ["ghost", "dead"].includes(expression.accent ?? "");
        filtered += (value - filtered) * (muted ? 0.16 : 0.65);
        if (muted)
          value =
            filtered *
            Math.exp(
              -time *
                (["ghost", "dead"].includes(expression.accent ?? "") ? 32 : 12)
            );
        if (techniques.has("harmonic")) value = (value - filtered) * 1.4;
        if (repeated)
          value *= Math.min(
            1,
            attackFrame / (rate * 0.003),
            tremolo || time < 0.135 ? (repeatPeriod - attackFrame) / (rate * 0.006) : 1
          );
        if (expression.accent === "dead")
          value =
            (value * 0.05 + ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.12) *
            Math.exp(-time * 35);
        if (techniques.has("slap") || techniques.has("pop"))
          value *= 1 + 0.8 * Math.exp(-time * 35);
        if (techniques.has("golpe"))
          value += Math.sin(time * Math.PI * 170) * Math.exp(-time * 45) * 0.25;
        if (techniques.has("pickScrape"))
          value +=
            ((Math.sin(i * 12.9898) * 43758.5453) % 1) *
            Math.exp(-time * 15) *
            0.12;
        value *= accentGain;
        if (expression.accent === "staccato")
          value *= Math.max(0, 1 - progress * 2);
        if (fadeGain) value *= fadeGain(progress);
        if (expression.pick === "up") value *= 0.88;
      }
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
  stringIndex?: number,
  expression?: GuitarExpression
) {
  const render = renderGuitar(notes, reference, stringIndex, expression);
  let step = render.next();
  while (!step.done) step = render.next();
  performanceAudio.prepareGuitar(
    guitarKey(notes, reference, stringIndex, expression),
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
  stringIndex?: number,
  expression?: GuitarExpression
) {
  if (signal.aborted) return;
  const key = guitarKey(notes, reference, stringIndex, expression);
  let task = warming.get(key);
  const cached = stringIndex === undefined && previews.get(key);
  if (cached && !task) return cached;
  if (!task) {
    const signals = new Set([signal]);
    const promise = (async () => {
      // Let the press/navigation render before any sample-bank decoding begins.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const render = renderGuitar(notes, reference, stringIndex, expression);
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
  stringIndex?: number,
  expression?: GuitarExpression
): Promise<void> {
  await warmGuitarWave(notes, reference, signal, stringIndex, expression);
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
