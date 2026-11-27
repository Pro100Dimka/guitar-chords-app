import { decodeAudioNoteTranscription } from "../src/components/audio-transcription";

const raw = () => ({
  engine: "chroma-v2",
  noteEventsVersion: 1,
  noteEventsLimit: 24000,
  noteEventsTruncated: false,
  noteEventsCoverageEnd: 10,
  noteEvents: [
    { start: 1, end: 3, midi: 52, noteEvidence: 0.8, onsetEvidence: 0.9 },
    { start: 1, end: 2, midi: 64, noteEvidence: 0.7, onsetEvidence: 0.8 },
    { start: 3, end: 5, midi: 52, noteEvidence: 0.75, onsetEvidence: 0.85 }
  ]
});

test("legacy absence is distinct from a complete empty note analysis", () => {
  expect(
    decodeAudioNoteTranscription({ engine: "chroma-v1" }, 10)
  ).toBeUndefined();
  expect(
    decodeAudioNoteTranscription({ ...raw(), noteEvents: [] }, 10)
  ).toEqual({
    version: 1,
    limit: 24000,
    truncated: false,
    coverageEnd: 10,
    events: []
  });
});

test("validated note events preserve independent pitches and repeated attacks", () => {
  const input = raw();
  const before = JSON.stringify(input);
  const result = decodeAudioNoteTranscription(input, 10)!;
  expect(result.events).toEqual(input.noteEvents);
  expect(result.events).not.toBe(input.noteEvents);
  expect(result.events[0]).not.toBe(input.noteEvents[0]);
  expect(JSON.stringify(input)).toBe(before);
});

test.each([
  { engine: "chroma-v1" },
  { noteEventsVersion: 2 },
  { noteEventsLimit: 99999 },
  { noteEventsTruncated: "false" },
  { noteEventsCoverageEnd: undefined },
  { noteEventsCoverageEnd: 9 },
  { noteEventsCoverageEnd: Infinity },
  { noteEvents: null },
  { noteEvents: "notes" },
  { noteEventsTruncated: true, noteEventsCoverageEnd: 5 }
])("rejects a partial or inconsistent note extension %j", (change) => {
  expect(() =>
    decodeAudioNoteTranscription({ ...raw(), ...change }, 10)
  ).toThrow("InvalidNoteTranscription");
});

test.each([
  { start: -1 },
  { start: NaN },
  { end: 1 },
  { end: 11 },
  { midi: 60.5 },
  { midi: 20 },
  { midi: 109 },
  { noteEvidence: Infinity },
  { noteEvidence: -0.1 },
  { onsetEvidence: 1.1 }
])("rejects malformed note evidence %j", (change) => {
  const input = raw();
  expect(() =>
    decodeAudioNoteTranscription(
      { ...input, noteEvents: [{ ...input.noteEvents[0], ...change }] },
      10
    )
  ).toThrow("InvalidNoteTranscription");
});

test("rejects unsorted attacks and overlapping repeats of the same MIDI pitch", () => {
  const input = raw();
  expect(() =>
    decodeAudioNoteTranscription(
      { ...input, noteEvents: input.noteEvents.slice().reverse() },
      10
    )
  ).toThrow("InvalidNoteTranscription");
  input.noteEvents[2].start = 2.9;
  expect(() => decodeAudioNoteTranscription(input, 10)).toThrow(
    "InvalidNoteTranscription"
  );
});

test("a capped prefix retains its explicit completeness boundary", () => {
  const input = {
    ...raw(),
    noteEventsTruncated: true,
    noteEventsCoverageEnd: 24,
    noteEvents: Array.from({ length: 24000 }, (_, index) => ({
      start: index / 1000,
      end: (index + 0.5) / 1000,
      midi: 60,
      noteEvidence: 0.8,
      onsetEvidence: 0.8
    }))
  };
  expect(decodeAudioNoteTranscription(input, 30)).toMatchObject({
    truncated: true,
    coverageEnd: 24
  });
  expect(() =>
    decodeAudioNoteTranscription({ ...input, noteEventsCoverageEnd: 20 }, 30)
  ).toThrow("InvalidNoteTranscription");
});
