export interface TimedWord {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  uncertain?: boolean;
}

export interface TimedLyric {
  start: number;
  end: number;
  text: string;
  words: TimedWord[];
  uncertain?: boolean;
}

export interface TimedChord {
  start: number;
  end: number;
  label: string;
  confidence?: number;
  uncertain?: boolean;
}

/** All times are seconds on the original recording's unchanged timeline. */
export interface SongAnalysis {
  version: 1;
  duration: number;
  language: "uk" | "ru" | "en" | null;
  lyrics: TimedLyric[];
  chords: TimedChord[];
  warnings: string[];
  model: { lyrics: string; alignment: string; chords: string };
  metrics?: {
    elapsedSeconds: number;
    peakRssMb: number;
    device: string;
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = (): never => {
  throw new Error("AnalysisInvalid");
};
const finite = (value: unknown, min: number, max: number): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
    ? value
    : invalid();
const text = (value: unknown, limit: number, allowEmpty = false): string =>
  typeof value === "string" &&
  value.length <= limit &&
  (allowEmpty || value.trim())
    ? value
    : invalid();
const list = (value: unknown, limit: number): unknown[] =>
  Array.isArray(value) && value.length <= limit ? value : invalid();

/** Validate untrusted server/backup data before it reaches the player or SQLite. */
export function validateSongAnalysis(value: unknown): SongAnalysis {
  if (!record(value) || value.version !== 1) return invalid();
  const duration = finite(value.duration, 0.001, 7200);
  if (
    value.language !== null &&
    !["uk", "ru", "en"].includes(value.language as string)
  )
    return invalid();
  let textLength = 0;
  let wordCount = 0;
  const boundedText = (input: unknown, limit: number) => {
    const result = text(input, limit);
    textLength += result.length;
    if (textLength > 400000) invalid();
    return result;
  };
  const timing = (item: Record<string, unknown>, start = 0, end = duration) => {
    const itemStart = finite(item.start, start, end);
    const itemEnd = finite(item.end, itemStart, end);
    if (itemEnd <= itemStart) invalid();
    return { start: itemStart, end: itemEnd };
  };
  const uncertainty = (item: Record<string, unknown>) => {
    if (item.uncertain !== undefined && typeof item.uncertain !== "boolean")
      invalid();
    return item.uncertain === undefined
      ? {}
      : { uncertain: item.uncertain as boolean };
  };
  const confidence = (item: Record<string, unknown>) =>
    item.confidence === undefined
      ? {}
      : { confidence: finite(item.confidence, 0, 1) };
  let lastEnd = 0;
  const lyrics: TimedLyric[] = list(value.lyrics, 5000).map((entry) => {
    if (!record(entry)) return invalid();
    const time = timing(entry);
    if (time.start < lastEnd) invalid();
    lastEnd = time.end;
    let wordEnd = time.start;
    const words = list(entry.words, 2000).map((word) => {
      if (!record(word) || ++wordCount > 40000) return invalid();
      const wordTime = timing(word, time.start, time.end);
      if (wordTime.start < wordEnd) invalid();
      wordEnd = wordTime.end;
      return {
        ...wordTime,
        text: boundedText(word.text, 1000),
        ...confidence(word),
        ...uncertainty(word)
      };
    });
    return {
      ...time,
      text: boundedText(entry.text, 20000),
      words,
      ...uncertainty(entry)
    };
  });
  lastEnd = 0;
  const chords: TimedChord[] = list(value.chords, 15000).map((entry) => {
    if (!record(entry)) return invalid();
    const time = timing(entry);
    if (time.start < lastEnd) invalid();
    lastEnd = time.end;
    return {
      ...time,
      label: boundedText(entry.label, 80),
      ...confidence(entry),
      ...uncertainty(entry)
    };
  });
  if (!record(value.model)) return invalid();
  const result: SongAnalysis = {
    version: 1,
    duration,
    language: value.language as SongAnalysis["language"],
    lyrics,
    chords,
    warnings: list(value.warnings, 128).map((warning) => text(warning, 2000)),
    model: {
      lyrics: text(value.model.lyrics, 200),
      alignment: text(value.model.alignment, 200),
      chords: text(value.model.chords, 200)
    }
  };
  if (value.metrics !== undefined) {
    if (!record(value.metrics)) return invalid();
    result.metrics = {
      elapsedSeconds: finite(value.metrics.elapsedSeconds, 0, 604800),
      peakRssMb: finite(value.metrics.peakRssMb, 0, 1048576),
      device: text(value.metrics.device, 500)
    };
  }
  return result;
}
