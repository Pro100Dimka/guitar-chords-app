/** Practice preferences are separate from the musical document and its history. */
export interface TabPracticeSettings {
  metronome: boolean;
  volume: number;
  countInBars: 0 | 1 | 2;
  countInBetweenLoops: boolean;
  trainer: {
    enabled: boolean;
    /** Quarter-note BPM, including when the score uses an eighth-note meter. */
    startBpm: number;
    targetBpm: number;
    stepBpm: number;
    repeats: number;
  };
}

export function defaultTabPractice(): TabPracticeSettings {
  return {
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
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = true
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, integer ? Math.round(value) : value))
    : fallback;

export function normalizeTabPractice(value: unknown): TabPracticeSettings {
  const defaults = defaultTabPractice();
  const input = object(value);
  const trainer = object(input.trainer);
  const startBpm = number(trainer.startBpm, defaults.trainer.startBpm, 20, 300);
  return {
    metronome: input.metronome === true,
    volume: number(input.volume, defaults.volume, 0, 1, false),
    countInBars:
      input.countInBars === 1 || input.countInBars === 2
        ? input.countInBars
        : 0,
    countInBetweenLoops: input.countInBetweenLoops === true,
    trainer: {
      enabled: trainer.enabled === true,
      startBpm,
      targetBpm: Math.max(
        startBpm,
        number(trainer.targetBpm, defaults.trainer.targetBpm, 20, 300)
      ),
      stepBpm: number(trainer.stepBpm, defaults.trainer.stepBpm, 1, 20),
      repeats: number(trainer.repeats, defaults.trainer.repeats, 1, 16)
    }
  };
}
