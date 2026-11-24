import { signalLevels } from "../src/screens/tuner/chromatic-signal";

const spectrumAt = (samples: number[], rate: number, band: number) => {
  const frequency = 55 * (Math.min(5000, rate * 0.45) / 55) ** (band / 31);
  let real = 0;
  let imaginary = 0;
  samples.forEach((sample, index) => {
    const clean = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (samples.length - 1));
    const phase = (2 * Math.PI * frequency * index) / rate;
    real += clean * window * Math.cos(phase);
    imaginary += clean * window * Math.sin(phase);
  });
  const amplitude = (4 * Math.hypot(real, imaginary)) / samples.length;
  return Math.max(
    0,
    Math.min(1, (20 * Math.log10(Math.max(0.00001, amplitude)) + 70) / 70)
  );
};

test.each([8000, 11025, 44100, 48000])(
  "cached spectrum agrees with a direct Fourier calculation at %s Hz",
  (rate) => {
    for (const length of [64, 256, 512]) {
      const samples = Array.from(
        { length },
        (_, i) =>
          0.25 * Math.sin((2 * Math.PI * 440 * i) / rate) +
          0.1 * Math.cos((2 * Math.PI * 1234 * i) / rate)
      );
      samples[7] = NaN;
      samples[19] = Infinity;
      const expected = Array.from({ length: 32 }, (_, band) =>
        spectrumAt(samples, rate, band)
      );
      const actual = signalLevels(samples, rate, true);
      actual.forEach((level, band) =>
        expect(level).toBeCloseTo(expected[band], 8)
      );
    }
  }
);

test("equal-size audio frames reuse coefficients without reusing their output", () => {
  const first = signalLevels(Array(256).fill(0.1), 22050, true);
  const snapshot = [...first];
  const cosine = jest.spyOn(Math, "cos");
  try {
    const next = signalLevels(Array(256).fill(0), 22050, true);
    expect(cosine).not.toHaveBeenCalled();
    expect(next.every((level) => level === 0)).toBe(true);
    expect(first).toEqual(snapshot);
    expect(first.some((level) => level > 0)).toBe(true);
  } finally {
    cosine.mockRestore();
  }
});

test.each([false, true])(
  "an oversized visualization uses only the latest bounded audio frame, spectrum=%s",
  (spectrum) => {
    let reads = 0;
    let earliest = Infinity;
    const sample = (index: number) => 0.25 * Math.sin(index / 7);
    const size = 1_000_000;
    const samples = new Proxy([] as number[], {
      get: (_target, key) => {
        if (key === "length") return size;
        const index = Number(key);
        reads++;
        earliest = Math.min(earliest, index);
        return sample(index);
      }
    });
    const levels = signalLevels(samples, 44100, spectrum);
    expect(reads).toBeLessThanOrEqual(4096);
    expect(earliest).toBeGreaterThanOrEqual(size - 2048);
    expect(levels).toEqual(
      signalLevels(
        Array.from({ length: 2048 }, (_, i) => sample(size - 2048 + i)),
        44100,
        spectrum
      )
    );
  }
);
