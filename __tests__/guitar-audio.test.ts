import { toByteArray } from "base64-js";
import { prepareGuitar, warmGuitar } from "../src/components/guitar-audio";
import { playGuitar, guitarNoteKey, tabNoteExpression } from "../src/components/guitar-audio";
import { TAB_TECHNIQUES, TabNote } from "../src/components/tablature";

const renderedNote = (patch: Partial<TabNote>) => {
  const note: TabNote = { string: 1, fret: 0, tick: 0, duration: 24, ...patch };
  const bytes = toByteArray(prepareGuitar([45 + note.fret], 440, 1, tabNoteExpression(note, 80)));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: (bytes.length - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true) / 32768);
};
const energy = (pcm: number[], from = 0.05, to = 0.5) => {
  const segment = pcm.slice(Math.round(from * 22050), Math.round(to * 22050));
  return Math.sqrt(segment.reduce((sum, value) => sum + value * value, 0) / segment.length);
};

test("note dynamics and palm muting change the audible signal without changing its rate", () => {
  const soft = renderedNote({ velocity: 16 });
  const loud = renderedNote({ velocity: 104 });
  const plain = renderedNote({});
  const muted = renderedNote({ techniques: ["palmMute"] });
  expect(loud.length).toBe(soft.length);
  expect(energy(loud)).toBeGreaterThan(energy(soft) * 1.8);
  expect(energy(muted, 0.3, 0.6)).toBeLessThan(energy(plain, 0.3, 0.6) * 0.2);
});

test("detected release differences reuse the same velocity-only sample without changing its PCM", () => {
  const note: TabNote = {
    string: 1,
    fret: 0,
    tick: 0,
    duration: 12,
    velocity: 96
  };
  const versions = [
    { duration: 6.5, tempo: 80 },
    { duration: 17.125, tempo: 123 },
    { duration: 48, tempo: 160 }
  ];
  const keys = versions.map(({ duration, tempo }) =>
    guitarNoteKey({ ...note, duration }, tempo)
  );
  expect(new Set(keys).size).toBe(1);
  const wave = prepareGuitar([45], 440, 1, tabNoteExpression(note, 80));
  for (const { duration, tempo } of versions) {
    const expression = tabNoteExpression({ ...note, duration }, tempo)!;
    expect(prepareGuitar([45], 440, 1, expression)).toBe(wave);
    // Render with the previous, uncached per-note parameters as an audio
    // oracle: the reusable sample must be byte-for-byte the same sound.
    expect(
      prepareGuitar([45], 440, 1, {
        ...expression,
        seconds: (duration * 60) / (24 * tempo),
        repeatSeconds: 60 / tempo / 8
      })
    ).toBe(wave);
  }
});

const durationEffects: Array<[string, Partial<TabNote>]> = [
  ["bend", { techniques: ["bend"] }],
  ["slide", { techniques: ["slide"] }],
  ["vibrato", { techniques: ["vibrato"] }],
  ["whammy", { techniques: ["whammy"] }],
  ["staccato", { accent: "staccato" }],
  ["fade in", { fade: "in" }],
  ["fade out", { fade: "out" }],
  ["crescendo", { fade: "crescendo" }],
  ["diminuendo", { fade: "diminuendo" }]
];
test.each(durationEffects)(
  "%s retains its duration-dependent cache key and audible envelope",
  (_, patch) => {
    const note: TabNote = {
      string: 1,
      fret: 5,
      tick: 0,
      duration: 6,
      velocity: 96,
      ...patch
    };
    const longer = { ...note, duration: 24 };
    expect(guitarNoteKey(note, 80)).not.toBe(guitarNoteKey(longer, 80));
    expect(guitarNoteKey(note, 80)).not.toBe(guitarNoteKey(note, 160));
    expect(prepareGuitar([50], 440, 1, tabNoteExpression(note, 80))).not.toBe(
      prepareGuitar([50], 440, 1, tabNoteExpression(longer, 80))
    );
  }
);

test("tremolo tempo still changes the repeated attacks when note seconds are identical", () => {
  const note: TabNote = {
    string: 1,
    fret: 0,
    tick: 0,
    duration: 12,
    velocity: 96,
    techniques: ["tremolo"]
  };
  const faster = { ...note, duration: 24 };
  expect(guitarNoteKey(note, 80)).not.toBe(guitarNoteKey(faster, 160));
  expect(prepareGuitar([45], 440, 1, tabNoteExpression(note, 80))).not.toBe(
    prepareGuitar([45], 440, 1, tabNoteExpression(faster, 160))
  );
});

test("cache reuse keeps longer plain-note buffers and fermata expression timing", () => {
  const note: TabNote = {
    string: 1,
    fret: 0,
    tick: 0,
    duration: 128,
    velocity: 96
  };
  const wave = prepareGuitar([45], 440, 1, tabNoteExpression(note, 80));
  expect(toByteArray(wave)).toHaveLength(44 + 22050 * 4 * 2);
  expect(guitarNoteKey(note, 80)).not.toBe(
    guitarNoteKey({ ...note, duration: 24 }, 80)
  );
  const faded: TabNote = { ...note, duration: 24, fade: "out" };
  expect(tabNoteExpression(faded, 80)?.seconds).toBe(0.75);
  expect(tabNoteExpression({ ...faded, fermata: true }, 80)?.seconds).toBe(1.5);
});

test("all expression combinations keep native sample keys bounded and reusable", () => {
  const note: TabNote = { string: 5, fret: 24, tick: 0, duration: 96, velocity: 127,
    techniques: Object.keys(TAB_TECHNIQUES) as NonNullable<TabNote["techniques"]>,
    bend: 3, bendRelease: true, sourceFret: 0, accent: "strong", fade: "diminuendo", pick: "downBrush" };
  expect(guitarNoteKey(note, 40).length).toBeLessThan(256);
  expect(guitarNoteKey(note, 40)).toBe(guitarNoteKey({ ...note, techniques: [...note.techniques!].reverse() }, 40));
  expect(guitarNoteKey({ string: 0, fret: 0, tick: 0 }, 80)).toBe("440:40:string0");
});

test("tremolo retriggers the recorded attack instead of only changing sustain volume", () => {
  const pcm = renderedNote({ techniques: ["tremolo"] });
  const period = Math.round(22050 * 60 / 80 / 8);
  expect(pcm.slice(period * 2 + 300, period * 2 + 900)).toEqual(pcm.slice(period * 3 + 300, period * 3 + 900));
  expect(energy(pcm, period * 2 / 22050, (period * 3) / 22050)).toBeGreaterThan(0.0001);
});

test.each(Object.keys(TAB_TECHNIQUES).filter((key) => key !== "letRing"))("%s produces a finite, non-silent audition", (technique) => {
  const pcm = renderedNote({ fret: 5, techniques: [technique as NonNullable<TabNote["techniques"]>[number]] });
  expect(pcm.every(Number.isFinite)).toBe(true);
  expect(energy(pcm)).toBeGreaterThan(0.00001);
});
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
    await b;
    expect(performanceAudio.prepareGuitar).toHaveBeenCalledTimes(1);
    expect(performanceAudio.prepareGuitar).toHaveBeenCalledWith(
      "433:46:string1",
      expect.any(String)
    );
  });

  test("unfinished decoding yields again when the work budget is consumed", async () => {
    let clock = 0;
    jest.spyOn(
      (globalThis as typeof globalThis & { performance: { now: () => number } }).performance,
      "now"
    ).mockImplementation(() => (clock += 5));
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
    await pending;
    expect(ready).toBe(true);
  });

  test("a refused native preparation does not play a missing voice or reject a fire-and-forget preview", async () => {
    prepareGuitar([50]);
    jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
    await expect(playGuitar([50])).resolves.toBeUndefined();
    expect(performanceAudio.guitar).not.toHaveBeenCalled();
  });
});
