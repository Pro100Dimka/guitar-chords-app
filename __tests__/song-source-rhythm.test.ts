import { normalizeRhythm } from "../src/components/preferences";
import {
  pickingPatterns,
  rhythmMeterLabel,
  rhythms,
  sourceArrangement,
  sourceRhythm
} from "../src/screens/song/rhythms";

const six = {
  strum: "D-DU-UDU",
  strumMeter: 4,
  strumDivision: 2,
  strumPreset: "six"
};

describe("published rhythm instructions", () => {
  test.each([
    "Бой: шестёрка",
    "Бій: шістка",
    "Strumming pattern:\n↓ ↓↑ ↑↓↑",
    "Бой: ↓ · ↓ ↑ · ↑ ↓ ↑",
    "Бой: ↓ ↓↑ ↑↓↑ (шестёрка)",
    "Бой: D-DU-UDU (4/4)"
  ])("keeps the established strumming pattern from %s", (text) => {
    expect(sourceRhythm(text)).toEqual(six);
  });

  test.each([...rhythms, ...pickingPatterns])(
    "keeps the explicit timing of the existing $id preset",
    (preset) => {
      const kind = preset.id.startsWith("pick-") ? "Picking" : "Strumming";
      const result = sourceRhythm(
        `${kind}: ${preset.pattern} (${rhythmMeterLabel(preset.meter, preset.division)})`
      );
      expect(result).toEqual({
        strum: preset.pattern,
        strumMeter: preset.meter,
        strumDivision: preset.division,
        strumPreset: preset.id
      });
    }
  );

  test.each([4, 5, 6])(
    "preserves the literal bass string %s in a known picking note list",
    (bass) => {
      const result = sourceRhythm(`Перебор: ${bass}-3-2-3-1-3-2-3`);
      expect(result).toEqual({
        strum: `${bass}3231323`,
        strumMeter: 4,
        strumDivision: 2,
        strumPreset: ""
      });
      expect(normalizeRhythm(result)).toEqual(result);
    }
  );

  test.each([
    "Перебор: Б-3-2-3-1-3-2-3 (восьмёрка)",
    "Fingerpicking: B3231323 (eight)"
  ])("accepts a consistent parenthetical preset label: %s", (text) => {
    expect(sourceRhythm(text)).toEqual({
      strum: "B3231323",
      strumMeter: 4,
      strumDivision: 2,
      strumPreset: "pick-eight"
    });
  });

  test("preserves a literal numeric bass despite a named preset annotation", () => {
    expect(sourceRhythm("Перебор: 6-3-2-3-1-3-2-3 (восьмерка)")).toEqual({
      strum: "63231323",
      strumMeter: 4,
      strumDivision: 2,
      strumPreset: ""
    });
  });

  test.each(["6-3-2-1-", "6·3·2·1·"])(
    "preserves an exact picking grid with explicit rests: %s",
    (notation) => {
      expect(sourceRhythm(`Перебор: ${notation}`)).toEqual({
        strum: "6-3-2-1-",
        strumMeter: 4,
        strumDivision: 2,
        strumPreset: ""
      });
    }
  );

  test.each([
    ["6/8", 2, 3],
    ["3/4", 3, 2],
    ["вальс", 3, 2]
  ])(
    "uses the explicit %s meter for six picking notes",
    (label, meter, division) => {
      expect(sourceRhythm(`Перебор: 6-3-2-1-2-3 (${label})`)).toEqual({
        strum: "632123",
        strumMeter: meter,
        strumDivision: division,
        strumPreset: ""
      });
    }
  );

  test.each([
    "Перебор: 6-3-2-1-2-3",
    "Перебор: B32123",
    "Перебор: 6-3-2-1-2-3 (4/4)",
    "Перебор: 6-3-2-3-1-3-2-3 (четверка)",
    "Перебор: 6-3-1-2-3-2-1-3",
    "Перебор: 7-3-2-3-1-3-2-3",
    "Перебор: 1-3-2-3-1-3-2-3",
    "Перебор: 6--3--2--3--1--3--2--3",
    "Перебор: 6-3-2-3-1-3-2-3-",
    "Перебор: 6·3·2·3·1·3·2·3",
    "Бой: ↓ · · ↓ ↑ · ↑ ↓ ↑",
    "Бой: D--DU-UDU",
    "Бой: ↓ ↓↑ ↑↓↑ (восьмерка)",
    "Бой: ↓ ↓↑ ↑↓↑ (на ваше усмотрение)",
    "Бой: ↓ ↓↑ ↑↓↑ с глушением",
    "Бой: ↓ ↓↑ ↑↓↑ (с глушением)",
    "Автор советует играть боем шестерка"
  ])(
    "does not guess timing, mute positions, or arbitrary prose: %s",
    (text) => {
      expect(sourceRhythm(text)).toBeUndefined();
    }
  );

  test.each(["Бой: шестёрка с глушением", "Strumming: D-XUD-XU"])(
    "keeps explicitly located mute strokes: %s",
    (text) => {
      expect(sourceRhythm(text)).toEqual({
        strum: "D-XUD-XU",
        strumMeter: 4,
        strumDivision: 2,
        strumPreset: "muted"
      });
    }
  );

  test.each(["Рекомендуемый Бой: Восьмерка", "Рекомендую бой восьмерка"])(
    "recognizes the published recommendation label: %s",
    (text) => {
      expect(sourceRhythm(text)).toMatchObject({
        strum: "DUDUDUDU",
        strumPreset: "eighth"
      });
      expect(sourceRhythm(`${text}\nБой: шестерка`)).toBeUndefined();
    }
  );

  test("accepts repeated identical instructions but rejects changed literal strings", () => {
    expect(sourceRhythm("Бой: шестерка\nБой: ↓ ↓↑ ↑↓↑")).toEqual(six);
    expect(
      sourceRhythm("Перебор: 6-3-2-3-1-3-2-3\nПеребор: 5-3-2-3-1-3-2-3")
    ).toBeUndefined();
  });
});

describe("source arrangement sections", () => {
  test("keeps general strumming and literal picking for individual sections", () => {
    expect(
      sourceArrangement(
        "Бой: шестерка\nКуплет:\nПеребор: 6-3-2-3-1-3-2-3\n[Am]Example verse\nПрипев:\nБой: восьмерка\n[C]Example chorus"
      )
    ).toEqual({
      ...six,
      rhythmSections: {
        куплет: {
          strum: "63231323",
          strumMeter: 4,
          strumDivision: 2,
          strumPreset: ""
        },
        припев: {
          strum: "DUDUDUDU",
          strumMeter: 4,
          strumDivision: 2,
          strumPreset: "eighth"
        }
      }
    });
  });

  test("retains instructions in section headings", () => {
    expect(
      sourceArrangement("Куплет (перебор: вальс):\n[Am]Example words")
        ?.rhythmSections["куплет (перебор: вальс)"]
    ).toEqual({
      strum: "B32123",
      strumMeter: 3,
      strumDivision: 2,
      strumPreset: "pick-waltz"
    });
  });

  test("conflicting repeated sections do not receive an arbitrary assignment", () => {
    const arrangement = sourceArrangement(
      "Куплет:\nПеребор: 6-3-2-3-1-3-2-3\n[Am]First verse\nКуплет:\nПеребор: 5-3-2-3-1-3-2-3\n[Am]Second verse\nПрипев:\nБой: шестерка\n[C]Chorus words"
    );
    expect(arrangement?.rhythmSections).toEqual({ припев: six });
  });
});
