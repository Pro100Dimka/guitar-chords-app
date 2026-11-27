import {
  projectAudioTablature,
  type AudioTablatureProjection
} from "../src/components/audio-tablature";
import type {
  AudioNoteEvent,
  AudioNoteTranscription
} from "../src/components/audio-transcription";
import {
  normalizeTablature,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  TAB_TICKS_PER_BEAT,
  TAB_TUNING,
  tabTickEnd,
  type Tablature
} from "../src/components/tablature";

const event = (
  midi: number,
  start: number,
  end: number,
  evidence = 0.8
): AudioNoteEvent => ({
  midi,
  start,
  end,
  noteEvidence: evidence,
  onsetEvidence: evidence
});
const transcription = (
  events: AudioNoteEvent[],
  coverageEnd = 30,
  truncated = false
): AudioNoteTranscription => ({
  version: 1,
  events,
  limit: 24000,
  truncated,
  coverageEnd
});
const ready = (
  result: AudioTablatureProjection
): Extract<AudioTablatureProjection, { status: "ready" }> => {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.reason);
  return result;
};

function expectPhysicalStrings(tab: Tablature) {
  for (let i = 0; i < tab.notes.length; i++) {
    const note = tab.notes[i];
    expect(note.string).toBeGreaterThanOrEqual(0);
    expect(note.string).toBeLessThanOrEqual(5);
    expect(note.fret).toBeGreaterThanOrEqual(0);
    expect(note.fret).toBeLessThanOrEqual(24);
    for (const following of tab.notes.slice(i + 1)) {
      if (following.string === note.string)
        expect(tabTickEnd(note.tick, note.duration!)).toBeLessThanOrEqual(
          following.tick
        );
    }
  }
}

test("absolute audio times become fractional v3 ticks without a beat-grid snap", () => {
  const input = transcription([event(45, 12.125, 12.775)]);
  const original = JSON.stringify(input);
  const result = ready(
    projectAudioTablature(input, { start: 12, end: 14 }, 117.6)
  );
  expect(result.tempo).toBe(118);
  expect(result.tab.version).toBe(3);
  expect(result.tab.beatsPerBar).toBe(4);
  expect(result.tab.beatUnit).toBe(4);
  expect(result.assumptions).toEqual({
    tuning: "EADGBE",
    minFret: 0,
    maxFret: 24,
    meter: "4/4",
    layoutOnly: true
  });
  const note = result.tab.notes[0];
  expect(Number.isInteger(note.tick)).toBe(false);
  const secondsPerTick = 60 / (result.tempo * TAB_TICKS_PER_BEAT);
  expect(Math.abs(12 + note.tick * secondsPerTick - 12.125)).toBeLessThanOrEqual(
    secondsPerTick / 960
  );
  expect(
    Math.abs(
      12 + tabTickEnd(note.tick, note.duration!) * secondsPerTick - 12.775
    )
  ).toBeLessThanOrEqual(secondsPerTick / 960);
  expect(TAB_TUNING[note.string] + note.fret).toBe(45);
  expect(normalizeTablature(result.tab)).toEqual(result.tab);
  expect(JSON.stringify(input)).toBe(original);
});

test("correcting BPM changes the score grid while retaining detected seconds", () => {
  const input = transcription([event(64, 1.137, 1.827)]);
  for (const tempo of [40, 80, 123, 200]) {
    const result = ready(
      projectAudioTablature(input, { start: 1, end: 3 }, tempo)
    );
    const note = result.tab.notes[0];
    const secondsPerTick = 60 / (tempo * TAB_TICKS_PER_BEAT);
    expect(Math.abs(note.tick * secondsPerTick - 0.137)).toBeLessThanOrEqual(
      secondsPerTick / 960
    );
    expect(
      Math.abs(tabTickEnd(note.tick, note.duration!) * secondsPerTick - 0.827)
    ).toBeLessThanOrEqual(secondsPerTick / 960);
  }
});

test("selection boundaries report carry-in and shortened releases separately", () => {
  const result = ready(
    projectAudioTablature(
      transcription([
        event(40, 8, 10),
        event(64, 9, 13),
        event(45, 12, 13)
      ]),
      { start: 10, end: 12 },
      120
    )
  );
  expect(result.counts).toEqual({
    selected: 1,
    placed: 1,
    outOfRange: 0,
    unassigned: 0,
    carried: 1,
    shortened: 1
  });
  expect(result.tab.notes[0]).toMatchObject({ tick: 0, duration: 96 });
  expect(Object.keys(result.tab.notes[0]).sort()).toEqual(
    ["string", "fret", "tick", "duration", "velocity"].sort()
  );
});

test("a detected melody needs no chord labels and receives no invented techniques", () => {
  const notes = [event(60, 0.1, 0.5), event(62, 0.7, 1.1), event(64, 1.3, 1.8)];
  const result = ready(
    projectAudioTablature(transcription(notes), { start: 0, end: 2 }, 90)
  );
  expect(result.counts.placed).toBe(3);
  expect(result.tab.notes.map((note) => TAB_TUNING[note.string] + note.fret)).toEqual(
    [60, 62, 64]
  );
  result.tab.notes.forEach((note) => {
    expect(note.velocity).toBe(96);
    expect(note.pick).toBeUndefined();
    expect(note.leftFinger).toBeUndefined();
    expect(note.rightFinger).toBeUndefined();
    expect(note.techniques).toBeUndefined();
  });
});

test("six simultaneous open-string pitches use six distinct physical strings", () => {
  const result = ready(
    projectAudioTablature(
      transcription(TAB_TUNING.map((midi) => event(midi, 0.1, 1.5))),
      { start: 0, end: 2 },
      120
    )
  );
  expect(result.counts.placed).toBe(6);
  expect(result.counts.unassigned).toBe(0);
  expect(new Set(result.tab.notes.map((note) => note.string)).size).toBe(6);
  expectPhysicalStrings(result.tab);
});

test("a standard six-note F barre shape remains representable", () => {
  const pitches = [41, 48, 53, 57, 60, 65];
  const result = ready(
    projectAudioTablature(
      transcription(pitches.map((midi) => event(midi, 0, 2))),
      { start: 0, end: 3 },
      80
    )
  );
  expect(result.counts.placed).toBe(6);
  expect(result.tab.notes.map((note) => TAB_TUNING[note.string] + note.fret)).toEqual(
    pitches
  );
  expectPhysicalStrings(result.tab);
});

test("excess polyphony is explicitly unassigned, never hidden by normalization", () => {
  const result = ready(
    projectAudioTablature(
      transcription([40, 42, 45, 50, 55, 59, 64].map((midi) => event(midi, 0, 1))),
      { start: 0, end: 2 },
      100
    )
  );
  expect(result.counts.selected).toBe(7);
  expect(result.counts.placed).toBe(6);
  expect(result.counts.unassigned).toBe(1);
  expect(result.counts.shortened).toBe(0);
  expect(normalizeTablature(result.tab)?.notes).toEqual(result.tab.notes);
  expectPhysicalStrings(result.tab);
});

test("overlapping pitches confined to one string do not truncate each other's sustain", () => {
  const input = [event(40, 0, 3), event(40, 1, 2)];
  const result = ready(
    projectAudioTablature(transcription(input), { start: 0, end: 4 }, 60)
  );
  expect(result.counts).toMatchObject({
    selected: 2,
    placed: 1,
    unassigned: 1,
    shortened: 0
  });
  const note = result.tab.notes[0];
  const source = input.find((value) => value.start * TAB_TICKS_PER_BEAT === note.tick)!;
  expect(source).toBeDefined();
  expect(note.duration).toBe((source.end - source.start) * TAB_TICKS_PER_BEAT);
  expectPhysicalStrings(result.tab);
});

test("alternative guitar positions retain overlapping equal pitches on separate strings", () => {
  const result = ready(
    projectAudioTablature(
      transcription([event(64, 0, 3), event(64, 1, 2)]),
      { start: 0, end: 4 },
      60
    )
  );
  expect(result.counts.placed).toBe(2);
  expect(new Set(result.tab.notes.map((note) => note.string)).size).toBe(2);
  expect(result.tab.notes.every((note) => TAB_TUNING[note.string] + note.fret === 64)).toBe(
    true
  );
  expect(result.counts.shortened).toBe(0);
  expectPhysicalStrings(result.tab);
});

test("unsupported guitar pitches are counted without transposition or invented octaves", () => {
  const result = projectAudioTablature(
    transcription([21, 39, 89, 108].map((midi) => event(midi, 0, 1))),
    { start: 0, end: 2 },
    80
  );
  expect(result).toEqual({
    status: "unavailable",
    reason: "noPlayableNotes",
    counts: {
      selected: 4,
      placed: 0,
      outOfRange: 4,
      unassigned: 0,
      carried: 0,
      shortened: 0
    }
  });
});

test("incomplete native coverage cannot become apparent silence in a selected tail", () => {
  const input = transcription([event(64, 0.5, 1.5)], 2, true);
  expect(projectAudioTablature(input, { start: 0, end: 3 }, 80)).toEqual({
    status: "unavailable",
    reason: "incompleteCoverage"
  });
  expect(projectAudioTablature(input, { start: 0, end: 2 }, 80).status).toBe("ready");
});

test("event overflow requests a shorter selection instead of exporting a truncated tab", () => {
  const input = transcription(
    Array.from({ length: TAB_MAX_NOTES + 1 }, (_, index) =>
      event(64, index * 0.001, index * 0.001 + 0.0005)
    )
  );
  expect(projectAudioTablature(input, { start: 0, end: 3 }, 80)).toMatchObject({
    status: "unavailable",
    reason: "selectShorter",
    limit: "notes"
  });
});

test("bar capacity includes intentionally empty selected time", () => {
  const end = TAB_MAX_BARS * 4;
  const input = transcription([event(64, 0, 1)], end + 1);
  const result = ready(projectAudioTablature(input, { start: 0, end }, 60));
  expect(result.tab.barCount).toBe(TAB_MAX_BARS);
  expect(projectAudioTablature(input, { start: 0, end: end + 0.1 }, 60)).toEqual({
    status: "unavailable",
    reason: "selectShorter",
    limit: "bars"
  });
});

test("a sustained note crosses bar lines without fabricated reattacks or ties", () => {
  const result = ready(
    projectAudioTablature(
      transcription([event(64, 3.5, 5)]),
      { start: 0, end: 6 },
      60
    )
  );
  expect(result.tab.barCount).toBe(2);
  expect(result.tab.notes).toHaveLength(1);
  expect(result.tab.notes[0]).toMatchObject({ tick: 84, duration: 36 });
  expect(result.tab.notes[0].tie).toBeUndefined();
});

test.each([NaN, Infinity, 0, 39, 201])("rejects invalid tempo %s", (tempo) => {
  expect(
    projectAudioTablature(transcription([event(64, 0, 1)]), { start: 0, end: 2 }, tempo)
  ).toEqual({ status: "unavailable", reason: "invalidTempo" });
});

test.each([
  { start: -1, end: 1 },
  { start: 1, end: 1 },
  { start: 2, end: 1 },
  { start: NaN, end: 1 },
  { start: 0, end: Infinity }
])("rejects invalid source range %j", (range) => {
  expect(projectAudioTablature(transcription([]), range, 80)).toEqual({
    status: "unavailable",
    reason: "invalidRange"
  });
});

test.each([
  { midi: 64.5 },
  { start: -1 },
  { end: 0 },
  { noteEvidence: NaN },
  { onsetEvidence: 1.01 }
])("rejects malformed detected notes rather than silently discarding them: %j", (patch) => {
  expect(
    projectAudioTablature(
      transcription([{ ...event(64, 0, 1), ...patch }]),
      { start: 0, end: 2 },
      80
    )
  ).toEqual({ status: "unavailable", reason: "invalidNotes" });
});
