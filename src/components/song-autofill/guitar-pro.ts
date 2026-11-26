import type { model } from "@coderline/alphatab";
import {
  chordShapeOptions,
  createSongEditorState,
  isChordLine,
  isSectionBoundary,
  songChordSequence,
  songPlaybackLines,
  songSections
} from "../../screens/song/chords";
import { allRhythms } from "../../screens/song/rhythms";
import type { SongRhythm } from "../preferences";
import {
  normalizeTablature,
  roundTabTick,
  TAB_MAX_BARS,
  TAB_TICKS_PER_BEAT,
  TAB_TUNING,
  type TabNote
} from "../tablature";
import type { ChordProviderContext } from "./chord-provider-context";
import { noteNames } from "../../screens/tuner/tunings";
import { sourcePartKey, sourceSong } from "./source-metadata";

const instrumental = (name: string) =>
  /intro|outro|interlude|intrelude|instrumental|bridge|solo|вступ|интро|проигрыш|кода|соло/i.test(
    name
  );

function barRhythm(bar: model.Bar, beats: number): SongRhythm | undefined {
  const meter = ([2, 3, 4] as const).find((value) => value === beats);
  const events = bar.voices[0]?.beats.filter((beat) => beat.notes.length) ?? [];
  const division = [2, 3, 4].find((value) =>
    events.every((beat) => Number.isInteger((beat.playbackStart * value) / 960))
  );
  if (!meter || !events.length || !division || beats * division > 32) return;
  const pattern = Array<string>(beats * division).fill("-");
  for (const beat of events) {
    const strum = ({ 1: "U", 2: "D" } as Record<number, string>)[
      beat.brushType
    ];
    if (beat.notes.length > 1 && !strum) return;
    pattern[Math.round((beat.playbackStart * division) / 960)] =
      strum ?? String(7 - beat.notes[0].string);
  }
  const strum = pattern.join("");
  return {
    strum,
    strumMeter: meter,
    strumDivision: division,
    strumPreset:
      allRhythms.find(
        (item) =>
          item.pattern === strum &&
          item.division === division &&
          item.meter === beats
      )?.id ?? ""
  };
}

/** Import the source's timed guitar part, then align its harmony to the lyrics. */
export async function readGuitarPro({
  data,
  content,
  title,
  artist,
  source,
  context,
  signal
}: {
  data: Uint8Array;
  content: string;
  title: string;
  artist: string;
  source: { name: string; url: string };
  context: ChordProviderContext;
  signal?: AbortSignal;
}) {
  const originalContent = content;
  content = createSongEditorState(sourceSong(content, undefined, false).content)
    .text.split("\n")
    .filter(
      (line) =>
        !/^\s*[eBGDAE]\s*\|/i.test(line) &&
        !/^\s*[|:{}][\s|:{}]*(?:\d+\s*(?:раз[а-я]*|times)?)?\s*$/i.test(line) &&
        !/^\s*[▲△◇]\s*[-:]/.test(line) &&
        !/^\s*(?:простой|сложный|гитарный)\s+бой(?:\s|[.:])/i.test(line)
    )
    .join("\n");
  const encoding = require("@sinonjs/text-encoding");
  for (const name of ["TextDecoder", "TextEncoder"])
    if (!Object.hasOwn(globalThis, name))
      Object.assign(globalThis, { [name]: encoding[name] });
  const {
    importer,
    Settings,
    midi
  }: typeof import("@coderline/alphatab") = require("@coderline/alphatab");
  let score: model.Score | undefined;
  for (const encodingName of ["windows-1251", "utf-8", "windows-1252"]) {
    const settings = new Settings();
    settings.importer.gp3To5encoding = encodingName;
    const parsed = importer.ScoreLoader.loadScoreFromBytes(data, settings);
    if (
      context.matchingIdentity(title, parsed.title) &&
      context.sameArtist(artist, parsed.artist)
    ) {
      score = parsed;
      break;
    }
  }
  if (!score) return;
  if (
    score.masterBars.some(
      (bar) => bar.section && instrumental(bar.section.text)
    )
  )
    content = content
      .split(/\n\s*\n/)
      .map((paragraph) => {
        const rows = paragraph.split("\n");
        const lastLyric = rows.reduce(
          (last, line, index) =>
            line.trim() && !isChordLine(line) && !isSectionBoundary(line)
              ? index
              : last,
          -1
        );
        return rows.slice(0, lastLyric + 1).join("\n");
      })
      .filter((paragraph) => paragraph.trim())
      .join("\n\n");
  const candidates = score.tracks
    .flatMap((track) =>
      track.staves
        .filter((staff) => staff.tuning.length === 6 && !staff.isPercussion)
        .map((staff) => ({
          staff,
          weight:
            staff.bars
              .flatMap((bar) => bar.voices.flatMap((voice) => voice.beats))
              .reduce(
                (total, beat) =>
                  total + (beat.notes.length > 1 ? 8 : beat.notes.length),
                0
              ) +
            (track.playbackInfo.program >= 24 &&
            track.playbackInfo.program <= 31
              ? 1000
              : 0) -
            (/voice|vocal|вокал/i.test(track.name) ? 10000 : 0)
        }))
    )
    .sort((left, right) => right.weight - left.weight);
  const staff = candidates[0]?.staff;
  if (!staff || !score.masterBars.length) return;
  const meter = score.masterBars[0];
  if (
    !(
      [2, 3, 4].includes(meter.timeSignatureNumerator) &&
      [2, 4, 8].includes(meter.timeSignatureDenominator)
    ) ||
    score.masterBars.some(
      (bar) =>
        bar.timeSignatureNumerator !== meter.timeSignatureNumerator ||
        bar.timeSignatureDenominator !== meter.timeSignatureDenominator
    )
  )
    return;
  const generator = new midi.MidiFileGenerator(
    score,
    null,
    new midi.AlphaSynthMidiFileHandler(new midi.MidiFile())
  );
  generator.generate();
  const timeline = generator.tickLookup.masterBars;
  if (timeline.length > TAB_MAX_BARS) return;
  const checkpoint = context.sourceWork(signal);
  const tuning = [...staff.tuning].reverse().map((pitch) => pitch + staff.capo);
  const words = songChordSequence(content);
  if (!words.length) return;
  const shapes = [...new Set(words)].flatMap((name) => {
    const shape = chordShapeOptions(name)[0];
    if (!shape) return [];
    const pitches = shape.frets.flatMap((fret, string) =>
      fret === null ? [] : [TAB_TUNING[string] + fret]
    );
    return [
      {
        name,
        tones: new Set(pitches.map((pitch) => pitch % 12)),
        bass: pitches[0] % 12
      }
    ];
  });
  const counts = new Map<string, number>();
  let section = "";
  const bars = timeline.map((entry) => {
    if (entry.masterBar.section || !section) {
      const name = (entry.masterBar.section?.text.trim() || "Verse")
        .replace(/^intrelude$/i, "Interlude")
        .replace(/\s+\d+$/, "");
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      section = `${name} ${count}`;
    }
    const bar = staff.bars[entry.masterBar.index];
    const notes = bar.voices.flatMap((voice) =>
      voice.beats.flatMap((beat) => beat.notes)
    );
    const attacks = bar.voices
      .flatMap((voice) => voice.beats)
      .filter((beat) => beat.notes.length);
    const firstAttack = Math.min(...attacks.map((beat) => beat.playbackStart));
    const bassNotes = attacks
      .filter((beat) => beat.playbackStart === firstAttack)
      .flatMap((beat) => beat.notes);
    const bass = bassNotes.length
      ? Math.min(...bassNotes.map((note) => note.realValue)) % 12
      : -1;
    const pitches = new Set(notes.map((note) => note.realValue % 12));
    const harmony = new Map(
      shapes.map((shape) => [
        shape.name,
        (notes.filter((note) => shape.tones.has(note.realValue % 12)).length /
          Math.max(1, notes.length)) *
          3 +
          [...shape.tones].filter((pitch) => pitches.has(pitch)).length /
            shape.tones.size +
          (bass === shape.bass ? 3 : 0)
      ])
    );
    return {
      entry,
      bar,
      section,
      instrumental: instrumental(section),
      harmony,
      chord: [...harmony].sort((a, b) => b[1] - a[1])[0]?.[0]
    };
  });
  const positions = bars.flatMap((bar, barIndex) =>
    Array.from(
      { length: Math.ceil((bar.entry.end - bar.entry.start) / 960) },
      (_, phase) => ({
        ...bar,
        barIndex,
        phase,
        position: bar.entry.start + phase * 960
      })
    )
  );
  if (words.length > positions.length) return;
  const firstVerse = Math.max(
    0,
    positions.findIndex((bar) => !bar.instrumental)
  );
  const sectionKeys = new Set(bars.map((bar) => sourcePartKey(bar.section)));
  const sourceCounts = new Map<string, number>(),
    openings = new Map<string, string[]>();
  const scopes: string[] = [];
  let previousFamily = "",
    previousScope = "";
  for (const paragraph of content
    .split(/\n\s*\n/)
    .filter((part) => part.trim())) {
    const paragraphWords = songChordSequence(paragraph);
    const heading =
      songSections(paragraph).find((part) => part.title)?.title ?? "";
    const key = sourcePartKey(heading),
      family =
        key.split(":")[0] ||
        [...openings].find(([, opening]) =>
          opening.every((chord, index) => paragraphWords[index] === chord)
        )?.[0] ||
        sourcePartKey(
          bars.find((bar) => !bar.instrumental)?.section ?? ""
        ).split(":")[0];
    const continuation = !heading && family === previousFamily;
    const count = key.split(":")[1]
      ? Number(key.split(":")[1])
      : (sourceCounts.get(family) ?? 0) + Number(!continuation);
    const scope = continuation ? previousScope : `${family}:${count}`;
    sourceCounts.set(family, count);
    if (!openings.has(family) && paragraphWords.length >= 4)
      openings.set(family, paragraphWords.slice(0, 4));
    const rows = paragraph.split("\n");
    const lastWords = rows.reduce(
      (last, line, index) =>
        line.trim() && !isChordLine(line) && !isSectionBoundary(line)
          ? index
          : last,
      -1
    );
    const lyricChords = songChordSequence(
      rows.slice(0, lastWords + 1).join("\n")
    ).length;
    scopes.push(
      ...paragraphWords.map((_, index) =>
        index >= lyricChords
          ? "instrumental"
          : sectionKeys.has(scope)
            ? scope
            : ""
      )
    );
    previousFamily = family;
    previousScope = scope;
  }
  let values = Array<number>(words.length + 1).fill(Number.NEGATIVE_INFINITY);
  values[0] = 0;
  const choices: boolean[][] = [];
  for (let at = 0; at < positions.length; at++) {
    const bar = positions[at],
      next = values.map((value) => value - (bar.instrumental ? 0 : 0.2));
    const matched = Array<boolean>(words.length + 1).fill(false);
    if (
      at >= firstVerse ||
      ["intro", "instrumental"].includes(scopes[0]?.split(":")[0])
    )
      for (let index = 1; index <= words.length; index++) {
        const harmony = bar.harmony.get(words[index - 1]) ?? 0;
        const scope = scopes[index - 1];
        const matchesSection =
          !scope ||
          (scope === "instrumental"
            ? bar.instrumental
            : sourcePartKey(bar.section) === scope ||
              (bar.instrumental &&
                !bar.phase &&
                sourcePartKey(bars[bar.barIndex - 1]?.section ?? "") ===
                  scope));
        const candidate = values[index - 1] + harmony;
        if (matchesSection && harmony >= 2 && candidate > next[index]) {
          next[index] = candidate;
          matched[index] = true;
        }
      }
    choices.push(matched);
    values = next;
    const pause = checkpoint();
    if (pause) await pause;
  }
  if (!Number.isFinite(values[words.length])) return;
  const assigned = new Map<number, number>();
  let cursor = words.length;
  for (let at = positions.length - 1; at >= 0 && cursor; at--)
    if (choices[at][cursor]) assigned.set(at, --cursor);
  if (cursor) return;
  const assignedBars = new Set(
    [...assigned.keys()].map((at) => positions[at].barIndex)
  );
  const lines = content.split(/\r?\n/),
    cueLines = songPlaybackLines(content);
  if (cueLines.length !== words.length) return;
  const rowStart = (index: number) => {
    let line = cueLines[index];
    while (line > 0 && isChordLine(lines[line - 1])) line--;
    return line;
  };
  const additions = new Map<number, string[]>(),
    seenSections = new Set<string>();
  const append = (line: number, value: string) =>
    additions.set(line, [...(additions.get(line) ?? []), value]);
  const appendChord = (line: number, name: string) => {
    const rows = additions.get(line) ?? [];
    const previous = rows.at(-1);
    if (previous && isChordLine(previous)) rows[rows.length - 1] += `  ${name}`;
    else rows.push(name);
    additions.set(line, rows);
  };
  const notes: TabNote[] = [],
    chords: { tick: number; name: string }[] = [];
  const previousNotes = new Map<number, TabNote>();
  const rhythmSections: Record<string, SongRhythm> = {};
  let previousExtra = "";
  for (const [at, bar] of positions.entries()) {
    const tick = roundTabTick((bar.position * TAB_TICKS_PER_BEAT) / 960);
    const index = assigned.get(at);
    const next = [...assigned]
      .filter(([position]) => position > at)
      .sort((a, b) => a[0] - b[0])[0];
    const previous = [...assigned]
      .filter(([position]) => position < at)
      .sort((a, b) => b[0] - a[0])[0];
    const line =
      index === undefined
        ? next
          ? rowStart(next[1])
          : lines.length
        : rowStart(index);
    const extra =
      !bar.phase &&
      !assignedBars.has(bar.barIndex) &&
      (!previous || rowStart(previous[1]) !== line) &&
      (bar.instrumental || at < firstVerse || !next);
    if (index !== undefined || extra) {
      if (!seenSections.has(bar.section) && (extra || !bar.instrumental)) {
        append(line, `\n[${bar.section}]`);
        seenSections.add(bar.section);
      }
      const name = index === undefined ? bar.chord : words[index];
      if (name && (index !== undefined || previousExtra !== name)) {
        chords.push({ name, tick });
        if (extra) appendChord(line, name);
      }
      previousExtra = extra ? (name ?? "") : "";
    }
    if (!rhythmSections[bar.section.toLowerCase()]) {
      const rhythm = barRhythm(
        bar.bar,
        (bar.entry.end - bar.entry.start) / 960
      );
      if (rhythm) rhythmSections[bar.section.toLowerCase()] = rhythm;
    }
    if (bar.phase) continue;
    for (const [voiceIndex, voice] of bar.bar.voices.entries())
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          const start = roundTabTick(
            tick + (beat.playbackStart * TAB_TICKS_PER_BEAT) / 960
          );
          const duration = roundTabTick(
            (beat.playbackDuration * TAB_TICKS_PER_BEAT) / 960
          );
          const string = note.string - 1;
          if (note.isTieDestination) {
            const previous = previousNotes.get(string);
            if (previous)
              previous.duration = roundTabTick(
                start + duration - previous.tick
              );
            continue;
          }
          const directions: Record<number, TabNote["pick"]> = {
            1: "upBrush",
            2: "downBrush",
            3: "arpeggio",
            4: "arpeggio"
          };
          const pick = directions[beat.brushType];
          const converted: TabNote = {
            string,
            fret: note.fret,
            tick: start,
            duration,
            ...(pick ? { pick } : {}),
            ...(note.isLetRing ? { techniques: ["letRing"] } : {}),
            ...(note.isDead ? { accent: "dead" } : {}),
            ...(voiceIndex ? { voice: voiceIndex + 1 } : {})
          };
          notes.push(converted);
          previousNotes.set(string, converted);
        }
      }
    const pause = checkpoint();
    if (pause) await pause;
  }
  const output = lines
    .flatMap((line, index) => [
      ...(additions.get(index) ?? []),
      ...(isSectionBoundary(line) ? [] : [line])
    ])
    .concat(additions.get(lines.length) ?? [])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const displayedChords = songChordSequence(output);
  if (
    displayedChords.length !== chords.length ||
    displayedChords.some((name, index) => name !== chords[index].name)
  )
    return;
  const tablature = normalizeTablature({
    version: 3,
    tempo: Math.round(score.tempo),
    beatsPerBar: meter.timeSignatureNumerator,
    beatUnit: meter.timeSignatureDenominator,
    barCount: timeline.length,
    notes,
    chords,
    tuning,
    sourceText: originalContent,
    arrangementSource: source
  });
  if (!tablature) return;
  const sectionIds = new Set(songSections(output).map((part) => part.id));
  return {
    content: output,
    tablature,
    tempo: tablature.tempo,
    tuning: tuning.map((pitch) => noteNames[pitch % 12]).join(" "),
    rhythm: {
      strum: "",
      strumMeter: 4 as const,
      strumDivision: 2,
      strumPreset: "",
      rhythmSections: Object.fromEntries(
        Object.entries(rhythmSections).filter(([id]) => sectionIds.has(id))
      )
    }
  };
}
