import { toByteArray } from "base64-js";
import { prepareGuitar, warmGuitar } from "../src/components/guitar-audio";
import { playGuitar } from "../src/components/guitar-audio";
import { performanceAudio } from "../src/components/performance-audio";
import { chordShapes, guitarMidi } from "../src/screens/song/chords";

test("background reference preparation yields, can be cancelled and keeps identical PCM", async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  jest.mocked(performanceAudio.prepareGuitar).mockClear();
  const cancelled = warmGuitar([43], 437, controller.signal);
  expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
  controller.abort();
  await jest.runAllTimersAsync();
  await cancelled;
  expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
  const pending = warmGuitar([43], 437, new AbortController().signal);
  await jest.runAllTimersAsync();
  await pending;
  const wave = jest
    .mocked(performanceAudio.prepareGuitar)
    .mock.calls.at(-1)![1];
  expect(prepareGuitar([43], 437)).toBe(wave);
  jest.useRealTimers();
});

test("a JS-cached string is prepared again before native playback after cache eviction", () => {
  prepareGuitar([40]);
  jest.mocked(performanceAudio.prepareGuitar).mockClear();
  playGuitar([40]);
  expect(performanceAudio.prepareGuitar).toHaveBeenCalledWith(
    "440:40",
    expect.any(String)
  );
  expect(performanceAudio.guitar).toHaveBeenCalledWith(
    expect.any(String),
    "440:40"
  );
});

test("loading tuner controls does not load the audio bank before it is needed", () => {
  const load = jest.fn(() =>
    jest.requireActual("../assets/guitar-samples.json")
  );
  jest.doMock("../assets/guitar-samples.json", load);
  try {
    jest.isolateModules(() => {
      const guitar = require("../src/components/guitar-audio");
      expect(load).not.toHaveBeenCalled();
      guitar.prepareGuitar([40]);
      guitar.prepareGuitar([45]);
      expect(load).toHaveBeenCalledTimes(1);
    });
  } finally {
    jest.dontMock("../assets/guitar-samples.json");
  }
});

test.each(["F", "Am", "Cmaj7", "D/F#"])(
  "%s fingerings produce distinct audio without clipped PCM",
  (chord) => {
    const waves = chordShapes(chord)
      .slice(0, 4)
      .map((frets) => {
        const notes = frets.flatMap((fret, string) =>
          fret === null ? [] : [guitarMidi[string] + fret]
        );
        const wave = prepareGuitar(notes);
        const bytes = toByteArray(wave);
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength
        );
        let peak = 0,
          energy = 0;
        for (let i = 44; i < bytes.length; i += 2) {
          const value = view.getInt16(i, true) / 32768;
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
        }
        expect(peak).toBeLessThan(0.9);
        expect(Math.sqrt(energy / ((bytes.length - 44) / 2))).toBeGreaterThan(
          0.005
        );
        expect(prepareGuitar(notes)).toBe(wave);
        return wave;
      });
    expect(new Set(waves).size).toBe(waves.length);
  }
);

function pitchWindow(
  wave: string,
  frequency: number,
  start: number,
  end: number
) {
  const bytes = toByteArray(wave),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    rate = view.getUint32(24, true);
  const samples = Array.from(
    { length: Math.floor((end - start) * rate) },
    (_, i) =>
      view.getInt16(44 + 2 * (Math.floor(start * rate) + i), true) / 32768
  );
  const min = Math.floor(rate / frequency / 1.04),
    max = Math.ceil(rate / frequency / 0.96);
  const scores = Array.from({ length: max + 2 }, (_, lag) => {
    if (lag < min - 1) return 0;
    let sum = 0,
      a = 0,
      b = 0;
    for (let i = 0; i < samples.length - lag; i++) {
      sum += samples[i] * samples[i + lag];
      a += samples[i] ** 2;
      b += samples[i + lag] ** 2;
    }
    return sum / Math.sqrt(a * b);
  });
  let peak = min;
  for (let lag = min; lag <= max; lag++)
    if (scores[lag] > scores[peak]) peak = lag;
  const delta =
    (0.5 * (scores[peak - 1] - scores[peak + 1])) /
    (scores[peak - 1] - 2 * scores[peak] + scores[peak + 1]);
  return rate / (peak + delta);
}

test.each(
  [432, 440, 442].flatMap((reference) =>
    [40, 45, 50, 55, 59, 64].map((midi) => [reference, midi])
  )
)(
  "reference %s Hz MIDI %s holds its pitch through attack and sustain",
  (reference, midi) => {
    const wave = prepareGuitar([midi], reference);
    const target = reference * 2 ** ((midi - 69) / 12);
    const windows = [
      [0.1, 0.5],
      [0.7, 1.1],
      [1, 1.4],
      [1.3, 1.7]
    ];
    const cents = windows.map(
      ([start, end]) =>
        1200 * Math.log2(pitchWindow(wave, target, start, end) / target)
    );
    for (const value of cents) expect(Math.abs(value)).toBeLessThanOrEqual(5);
  }
);
