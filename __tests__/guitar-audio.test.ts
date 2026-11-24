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
  expect(jest.mocked(performanceAudio.prepareGuitar).mock.calls.length).toBe(0);
  controller.abort();
  await jest.runAllTimersAsync();
  await cancelled;
  expect(jest.mocked(performanceAudio.prepareGuitar).mock.calls.length).toBe(0);
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

test("returning to the tuner does not resend cached waves until actual playback", async () => {
  prepareGuitar([40]);
  jest.mocked(performanceAudio.prepareGuitar).mockClear();
  await warmGuitar([40], 440, new AbortController().signal);
  expect(jest.mocked(performanceAudio.prepareGuitar).mock.calls.length).toBe(0);
  playGuitar([40]);
  expect(performanceAudio.prepareGuitar).toHaveBeenCalledTimes(1);
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

describe("responsive cold guitar preparation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(performanceAudio.prepareGuitar).mockClear();
    jest.mocked(performanceAudio.guitar).mockClear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("a cold preview yields before decoding and cancellation prevents delayed audio", async () => {
    const controller = new AbortController();
    const pending = playGuitar([41], 439, controller.signal);
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
    expect(performanceAudio.guitar).not.toHaveBeenCalled();
    controller.abort();
    await jest.runAllTimersAsync();
    await pending;
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
    expect(performanceAudio.guitar).not.toHaveBeenCalled();

    const retry = playGuitar([41], 439);
    expect(performanceAudio.guitar).not.toHaveBeenCalled();
    await jest.runAllTimersAsync();
    await retry;
    expect(performanceAudio.prepareGuitar).toHaveBeenCalledTimes(1);
    expect(performanceAudio.guitar).toHaveBeenCalledWith(
      jest.mocked(performanceAudio.prepareGuitar).mock.calls[0][1],
      "439:41"
    );
  });

  test("concurrent warmers share synthesis while retaining independent cancellation", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const a = warmGuitar([46], 433, first.signal, 1);
    const b = warmGuitar([46], 433, second.signal, 1);
    first.abort();
    await jest.runAllTimersAsync();
    expect(await a).toBeUndefined();
    expect(await b).toEqual(expect.any(String));
    expect(performanceAudio.prepareGuitar).toHaveBeenCalledTimes(1);
    expect(performanceAudio.prepareGuitar).toHaveBeenCalledWith(
      "433:46:string1",
      await b
    );
  });

  test("unfinished decoding yields again when the work budget is consumed", async () => {
    let clock = 0;
    jest.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const controller = new AbortController();
    const pending = warmGuitar([47], 436, controller.signal, 2);
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
    controller.abort();
    await jest.runAllTimersAsync();
    await pending;
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
  });
});

describe("awaited native guitar preparation", () => {
  beforeEach(() => {
    performanceAudio.preparedFingeringSupported = true;
    jest.mocked(performanceAudio.prepareFingering).mockReset();
    jest.mocked(performanceAudio.prepareGuitar).mockClear();
    jest.mocked(performanceAudio.guitar).mockClear();
  });
  afterEach(() => {
    performanceAudio.preparedFingeringSupported = false;
    jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(true);
    jest.useRealTimers();
  });

  test("cached taps probe the native key without re-sending PCM or decoding on the main queue", async () => {
    prepareGuitar([40]);
    jest.mocked(performanceAudio.prepareGuitar).mockClear();
    jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(true);
    await playGuitar([40]);
    expect(performanceAudio.prepareFingering).toHaveBeenCalledTimes(1);
    expect(performanceAudio.prepareFingering).toHaveBeenCalledWith("440:40", "");
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
    expect(performanceAudio.guitar).toHaveBeenCalledWith(
      expect.any(String),
      "440:40"
    );
  });

  test("an evicted native voice is restored before playback and cancelled restores stay silent", async () => {
    const wave = prepareGuitar([45]);
    jest.mocked(performanceAudio.prepareGuitar).mockClear();
    let finish!: (ready: boolean) => void;
    jest.mocked(performanceAudio.prepareFingering)
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const pending = playGuitar([45], 440, controller.signal);
    await Promise.resolve();
    expect(performanceAudio.prepareFingering).toHaveBeenLastCalledWith("440:45", wave);
    expect(performanceAudio.guitar).not.toHaveBeenCalled();
    controller.abort();
    finish(true);
    await pending;
    expect(performanceAudio.guitar).not.toHaveBeenCalled();

    jest.mocked(performanceAudio.prepareFingering)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await playGuitar([45]);
    expect(performanceAudio.guitar).toHaveBeenCalledTimes(1);
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
  });

  test("warmup waits for the native worker before reporting a string as ready", async () => {
    jest.useFakeTimers();
    let finish!: (ready: boolean) => void;
    jest.mocked(performanceAudio.prepareFingering)
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let ready = false;
    const pending = warmGuitar([53], 444, new AbortController().signal, 3).then((wave) => {
      ready = true;
      return wave;
    });
    await jest.runAllTimersAsync();
    expect(ready).toBe(false);
    expect(performanceAudio.prepareGuitar).not.toHaveBeenCalled();
    finish(true);
    expect(await pending).toEqual(expect.any(String));
    expect(ready).toBe(true);
  });

  test("a refused native preparation does not play a missing voice or reject a fire-and-forget preview", async () => {
    prepareGuitar([50]);
    jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
    await expect(playGuitar([50])).resolves.toBeUndefined();
    expect(performanceAudio.guitar).not.toHaveBeenCalled();
  });
});
