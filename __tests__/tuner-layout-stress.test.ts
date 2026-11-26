import { chromaticLayout } from "../src/screens/tuner/chromatic-layout";
import { guitarLayout } from "../src/screens/tuner/guitar-layout";

test("1,000 phone and split-window stages keep tuner dials, strings and octave controls visible", () => {
  for (let trial = 0; trial < 1000; trial++) {
    const portrait = trial % 2 === 0;
    const width = portrait ? 240 + (trial * 17) % 261 : 400 + (trial * 23) % 625;
    const height = portrait
      ? Math.max(width, 240 + (trial * 31) % 900)
      : 180 + (trial * 19) % 220;
    const guitar = guitarLayout(width, height);
    expect(guitar.stringLeft).toBeGreaterThanOrEqual(25.99);
    expect(guitar.stringLeft + guitar.stringWidth).toBeLessThanOrEqual(width - 25.99);
    expect(guitar.hole.x).toBeGreaterThanOrEqual(-0.01);
    expect(guitar.hole.y).toBeGreaterThanOrEqual(-0.01);
    expect(guitar.hole.x + guitar.hole.width).toBeLessThanOrEqual(width + 0.01);
    expect(guitar.hole.y + guitar.hole.height).toBeLessThanOrEqual(height + 0.01);
    const chromatic = chromaticLayout(width, height);
    expect(chromatic.octaveTop + 44).toBeLessThanOrEqual(height + 0.01);
    expect(chromatic.panelLeft + chromatic.panelWidth).toBeLessThanOrEqual(width + 0.01);
    if (chromatic.compactControls) {
      expect(4 * 44 + 16).toBeLessThanOrEqual(width);
      expect(chromatic.hole.y - 13).toBeGreaterThanOrEqual(52);
      expect(chromatic.panelTop).toBeGreaterThanOrEqual(
        chromatic.hole.y + chromatic.hole.height + 13
      );
    }
  }
});
