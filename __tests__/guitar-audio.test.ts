import { toByteArray } from "base64-js";
import { prepareGuitar, recordedChord } from "../src/components/guitar-audio";
import { chordShapes, guitarMidi } from "../src/screens/song/chords";

test("recorded chords follow enharmonic names and capo without replacing extended chords", () => {
  expect(recordedChord("Bb")?.name).toBe(recordedChord("A#")?.name);
  expect(recordedChord("Am", 3)?.name).toBe("Cm");
  expect(recordedChord("B", 1)?.name).toBe("C");
  expect(recordedChord("Cmaj7")).toBeUndefined();
  expect(recordedChord("D/F#")).toBeUndefined();
});

test.each(
  ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].flatMap(
    (root) => [root, `${root}m`]
  )
)(
  "%s has distinct up/down takes and a safe five-second native preview",
  (chord) => {
    const entry = recordedChord(chord)!;
    expect(new Set([...entry.down, ...entry.up]).size).toBe(6);
    const wave = prepareGuitar([60, 64, 67], chord);
    expect(wave.length).toBeLessThan(400000);
    const bytes = toByteArray(wave);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(bytes.length).toBe(44 + 22050 * 5 * 2);
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2)
      peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeGreaterThan(1000);
    expect(peak).toBeLessThan(32700);
    expect(Math.abs(view.getInt16(44, true))).toBeLessThan(50);
    expect(view.getInt16(bytes.length - 2, true)).toBe(0);
  }
);

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
