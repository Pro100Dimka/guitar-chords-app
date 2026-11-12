import { toByteArray } from "base64-js";
import { prepareGuitar } from "../src/components/guitar-audio";
import { chordShapes, guitarMidi } from "../src/screens/song/chords";

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
