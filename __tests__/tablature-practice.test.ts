import {
  defaultTabPractice,
  normalizeTabPractice
} from "../src/components/tablature-practice";

test("default practice preserves immediate playback and independent settings", () => {
  const defaults = defaultTabPractice();
  expect(defaults).toEqual({
    metronome: false,
    volume: 0.7,
    countInBars: 0,
    countInBetweenLoops: false,
    trainer: {
      enabled: false,
      startBpm: 60,
      targetBpm: 100,
      stepBpm: 5,
      repeats: 3
    }
  });
  defaults.trainer.enabled = true;
  expect(defaultTabPractice().trainer.enabled).toBe(false);
});

test.each([null, undefined, false, [], "settings", { trainer: [] }])(
  "invalid settings use safe defaults: %j",
  (value) => expect(normalizeTabPractice(value)).toEqual(defaultTabPractice())
);

test("normalization clamps numeric ranges and uses strict switches", () => {
  expect(
    normalizeTabPractice({
      metronome: "true",
      volume: 5,
      countInBars: 3,
      countInBetweenLoops: true,
      trainer: {
        enabled: true,
        startBpm: 400,
        targetBpm: -1,
        stepBpm: 0,
        repeats: 22
      }
    })
  ).toEqual({
    metronome: false,
    volume: 1,
    countInBars: 0,
    countInBetweenLoops: true,
    trainer: {
      enabled: true,
      startBpm: 300,
      targetBpm: 300,
      stepBpm: 1,
      repeats: 16
    }
  });
  expect(
    normalizeTabPractice({
      volume: -1,
      trainer: { startBpm: 21.7, targetBpm: 40.2, stepBpm: 25, repeats: 0 }
    })
  ).toMatchObject({
    volume: 0,
    trainer: { startBpm: 22, targetBpm: 40, stepBpm: 20, repeats: 1 }
  });
});

test("nonfinite preferences never reach audio or timing calculations", () => {
  expect(
    normalizeTabPractice({
      volume: NaN,
      trainer: {
        startBpm: Infinity,
        targetBpm: NaN,
        stepBpm: -Infinity,
        repeats: "4"
      }
    })
  ).toEqual(defaultTabPractice());
});

test("valid settings round-trip without sharing a mutable trainer object", () => {
  const input = {
    ...defaultTabPractice(),
    metronome: true,
    countInBars: 2,
    volume: 0.35
  };
  const normalized = normalizeTabPractice(input);
  expect(normalized).toEqual(input);
  expect(normalized.trainer).not.toBe(input.trainer);
});
