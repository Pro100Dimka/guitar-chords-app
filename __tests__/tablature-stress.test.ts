import {
  emptyTablature,
  normalizeTablature,
  roundTabTick,
  tabBarTicks,
  tablatureLength,
  Tablature
} from "../src/components/tablature";
import {
  copyTabBar,
  deleteTabBar,
  durationTicks,
  insertTabBar,
  tabBarCoverage
} from "../src/screens/play/tablature-editor";

test("1,000 seeded scores preserve timing, rests, notes and meter across bar edits", () => {
  let seed = 20261126;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * limit);
  };
  const units = [2, 4, 8] as const;
  const denominators = [4, 8, 16, 32, 64, 128];
  const modifiers = ["plain", "dotted", "triplet", "quintuplet"] as const;
  for (let trial = 0; trial < 1000; trial++) {
    const beats = 1 + random(12);
    const unit = units[random(units.length)];
    const tempo = 40 + random(161);
    const bars = 1 + random(8);
    const base = emptyTablature(tempo, beats, unit);
    const size = tabBarTicks(base);
    const input: Tablature = {
      ...base,
      version: 3,
      barCount: bars,
      rests: []
    };
    for (let bar = 0; bar < bars; bar++) {
      const start = bar * size;
      let position = start;
      for (let event = 0; event < 8; event++) {
        const duration = Math.min(
          durationTicks(
            denominators[random(denominators.length)],
            modifiers[random(modifiers.length)]
          ),
          roundTabTick(start + size - position)
        );
        if (duration <= 0) break;
        if (random(3) === 0) {
          input.rests!.push({ tick: position, duration });
        } else {
          const strings = new Set([random(6)]);
          if (random(3) === 0) strings.add(random(6));
          for (const string of strings)
            input.notes.push({
              tick: position,
              string,
              fret: random(25),
              duration,
              velocity: 1 + random(127)
            });
        }
        position = roundTabTick(position + duration);
      }
    }
    const normalized = normalizeTablature(input)!;
    expect(normalized).toBeDefined();
    const before = JSON.stringify(normalized);
    expect(JSON.stringify(normalizeTablature(JSON.parse(before)))).toBe(before);
    expect(tablatureLength(normalized)).toBe(bars * size);
    const insertion = random(bars + 1);
    const inserted = insertTabBar(normalized, insertion).tab!;
    expect(inserted).toBeDefined();
    expect(JSON.stringify(deleteTabBar(inserted, insertion).tab)).toBe(before);
    const copied = copyTabBar(normalized, random(bars));
    const appended = insertTabBar(normalized, bars, copied).tab!;
    expect(appended).toBeDefined();
    expect(copyTabBar(appended, bars)).toEqual(copied);
    for (let bar = 0; bar < bars; bar++) {
      const coverage = tabBarCoverage(normalized, bar);
      expect(coverage.covered).toBeLessThanOrEqual(size);
      expect(coverage.overflow).toBe(false);
    }
    expect(JSON.stringify(normalized)).toBe(before);
  }
});
