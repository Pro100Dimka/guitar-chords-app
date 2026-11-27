import { analyzeAudioRhythm } from "../src/components/audio-rhythm";
import type {
  AudioNoteEvent,
  AudioNoteTranscription
} from "../src/components/audio-transcription";

const event = (
  start: number,
  midi: number,
  duration = 0.8
): AudioNoteEvent => ({
  start,
  end: start + duration,
  midi,
  noteEvidence: 0.8,
  onsetEvidence: 0.8
});
const transcription = (
  events: AudioNoteEvent[],
  coverageEnd = 8
): AudioNoteTranscription => ({
  version: 1,
  events: events.slice().sort((a, b) => a.start - b.start || a.midi - b.midi),
  limit: 24000,
  truncated: false,
  coverageEnd
});
const strums = (offset = 0) =>
  [0, 1, 2, 3].flatMap((time) =>
    [40, 47, 52, 55, 59, 64].map((midi, index) =>
      event(offset + time + index * 0.01, midi, 0.4)
    )
  );
const picking = (offset = 0, duration = 0.8) =>
  Array.from({ length: 8 }, (_, index) =>
    event(offset + index * 0.5, [52, 55, 59, 64][index % 4], duration)
  );

test("repeated groups of simultaneous pitches suggest strumming without inventing directions", () => {
  const result = analyzeAudioRhythm(transcription(strums()), {
    start: 0,
    end: 4
  });
  expect(result.style).toBe("strumming");
  expect(result.attackCount).toBe(4);
  expect(result.attacks[0]).toEqual({
    time: 0,
    spread: 0.05,
    pitches: [40, 47, 52, 55, 59, 64],
    kind: "chord"
  });
  expect(result.attacks.every((attack) => !("direction" in attack))).toBe(true);
});

test("successive independently attacked ringing pitches suggest picking", () => {
  const result = analyzeAudioRhythm(transcription(picking()), {
    start: 0,
    end: 4
  });
  expect(result.style).toBe("picking");
  expect(result.attackCount).toBe(8);
  expect(result.attacks.every((attack) => attack.kind === "single")).toBe(true);
});

test("a monophonic melody alone does not establish a picking pattern", () => {
  const result = analyzeAudioRhythm(transcription(picking(0, 0.2)), {
    start: 0,
    end: 4
  });
  expect(result.style).toBe("undetermined");
  expect(result.attackCount).toBe(8);
});

test("activity without a confirmed onset is not fabricated as a picked attack", () => {
  const notes = transcription(
    picking().map((note) => ({ ...note, onsetEvidence: 0 }))
  );
  const result = analyzeAudioRhythm(notes, { start: 0, end: 4 });
  expect(result.style).toBe("undetermined");
  expect(result.attacks).toEqual([]);
  expect(result.complete).toBe(true);
});

test("different passages retain different playing-style estimates", () => {
  const notes = transcription([...strums(), ...picking(4)]);
  const result = analyzeAudioRhythm(notes, { start: 0, end: 8 });
  expect(result.style).toBe("mixed");
  expect(result.sections).toEqual([
    { start: 0, end: 4, style: "strumming", attackCount: 4 },
    { start: 4, end: 8, style: "picking", attackCount: 8 }
  ]);
  expect(result.attackCount).toBe(12);
});

test("a boundary inside a strum does not turn its remaining notes into a picking pattern", () => {
  const result = analyzeAudioRhythm(transcription(strums()), {
    start: 0.025,
    end: 1.1
  });
  expect(result.attacks).toHaveLength(1);
  expect(result.attacks[0]).toMatchObject({ time: 1, kind: "chord" });
  expect(result.style).toBe("undetermined");
  expect(
    analyzeAudioRhythm(transcription(strums()), { start: 0, end: 0.035 })
      .attacks
  ).toEqual([]);
});

test("a selected pause or a single attack cannot borrow a technique label from nearby context", () => {
  const notes = transcription(strums());
  expect(analyzeAudioRhythm(notes, { start: 3.6, end: 3.9 }).style).toBe(
    "undetermined"
  );
  expect(analyzeAudioRhythm(notes, { start: 1, end: 1.1 }).style).toBe(
    "undetermined"
  );
});

test("a monophonic subsection cannot borrow ringing-note evidence outside its range", () => {
  const notes = transcription(
    [
      ...[52, 55, 59, 64].map((midi, index) => event(index * 0.2, midi, 1)),
      ...[60, 62, 65, 67].map((midi, index) =>
        event(3.1 + index * 0.2, midi, 0.1)
      )
    ],
    4
  );
  expect(analyzeAudioRhythm(notes, { start: 0, end: 4 }).style).toBe("picking");
  expect(analyzeAudioRhythm(notes, { start: 3, end: 4 }).style).toBe(
    "undetermined"
  );
});

test("ringing beyond the selection end is not evidence within the selection", () => {
  const notes = transcription(
    [
      event(0.1, 60, 0.35),
      event(0.3, 64, 0.2),
      event(0.6, 67, 0.5),
      event(0.98, 69, 0.22)
    ],
    2
  );
  expect(analyzeAudioRhythm(notes, { start: 0, end: 2 }).style).toBe("picking");
  expect(analyzeAudioRhythm(notes, { start: 0, end: 1 }).style).toBe(
    "undetermined"
  );
});

test("a repeated pitch is a separate attack even within the grouping window", () => {
  const notes = transcription([event(0, 60, 0.06), event(0.06, 60, 0.1)]);
  const result = analyzeAudioRhythm(notes, { start: 0, end: 1 });
  expect(result.attacks.map((attack) => attack.time)).toEqual([0, 0.06]);
});

test("an event cap does not turn missing late data into a classified passage", () => {
  const notes = { ...transcription(strums(), 4), truncated: true };
  expect(analyzeAudioRhythm(notes, { start: 0, end: 5 })).toEqual({
    style: "undetermined",
    complete: false,
    attackCount: 0,
    attacks: [],
    sections: []
  });
  expect(analyzeAudioRhythm(notes, { start: 0, end: 4 }).complete).toBe(true);
});

test("bass-register clusters outside standard guitar range are not called guitar strums", () => {
  const notes = transcription(
    strums().map((note) => ({ ...note, midi: 21 + (note.midi % 12) }))
  );
  expect(analyzeAudioRhythm(notes, { start: 0, end: 4 }).attacks).toEqual([]);
});
