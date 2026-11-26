import { NativeModules, Platform } from "react-native";
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types
} from "@react-native-documents/picker";
import type { FormValues } from "../screens/create-song-chords";
import initialValues from "../screens/create-song-chords/formik/initial-values";
import { songFieldLimits } from "../@interfaces";
import { chordSection, type ChordRange } from "./offline-chord-section";

export interface ChordSegment {
  start: number;
  end: number;
  chord: string;
  confidence: number;
}

export interface OfflineChordAnalysis {
  engine: "chroma-v1" | "chroma-v2";
  duration: number;
  segments: ChordSegment[];
  key: string | null;
  tempo: number | null;
  elapsedMs: number;
  fileName: string;
}

interface NativeAnalyzer {
  analyzeFile(uri: string): Promise<unknown>;
  cancel(): Promise<void>;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const keyPattern = /^[A-G](?:#|b)?m?$/;
// Native v2 uses canonical qualities, not the editor's wider notation grammar.
const extendedChordPattern =
  /^[A-G](?:#|b)?(?:m|5|sus2|sus4|6|m6|7|maj7|m7|dim|aug|add9|madd9)?$/;
// The native core permits 900 seconds at 16 kHz, with one label per 1024 samples.
const maxSegments = Math.ceil((900 * 16000) / 1024);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
let active: symbol | undefined;

export const chordAnalysisCancelled = (error: unknown) =>
  (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) ||
  (record(error) && error.code === "Cancelled") ||
  (error instanceof Error && error.message === "Cancelled");

function validateResult(
  value: unknown
): Omit<OfflineChordAnalysis, "fileName"> {
  if (
    !record(value) ||
    (value.engine !== "chroma-v1" && value.engine !== "chroma-v2") ||
    !finite(value.duration) ||
    value.duration < 1 ||
    value.duration > 900.001 ||
    !finite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    !Array.isArray(value.segments) ||
    value.segments.length > maxSegments ||
    (value.key !== null &&
      (typeof value.key !== "string" || !keyPattern.test(value.key))) ||
    (value.tempo !== null &&
      (!finite(value.tempo) || value.tempo < 40 || value.tempo > 200))
  )
    throw new Error("InvalidChordAnalysis");
  const chordPattern =
    value.engine === "chroma-v2" ? extendedChordPattern : keyPattern;
  let previousEnd = 0;
  const segments = value.segments.map((segment: unknown): ChordSegment => {
    if (
      !record(segment) ||
      !finite(segment.start) ||
      !finite(segment.end) ||
      segment.start < 0 ||
      segment.start < previousEnd - 0.001 ||
      segment.end <= segment.start ||
      segment.end > (value.duration as number) + 0.001 ||
      typeof segment.chord !== "string" ||
      !(segment.chord === "N" || chordPattern.test(segment.chord)) ||
      !finite(segment.confidence) ||
      segment.confidence < 0 ||
      segment.confidence > 1
    )
      throw new Error("InvalidChordAnalysis");
    previousEnd = segment.end;
    return {
      start: segment.start,
      end: segment.end,
      chord: segment.chord,
      confidence: segment.confidence
    };
  });
  return {
    engine: value.engine,
    duration: value.duration,
    elapsedMs: value.elapsedMs,
    key: value.key as string | null,
    tempo: value.tempo as number | null,
    segments
  };
}

/** Reads only the selected local URI. PCM and analysis stay in the native worker. */
export async function analyzeAudioFile(
  signal?: AbortSignal,
  onSelected?: () => void
): Promise<OfflineChordAnalysis> {
  if (signal?.aborted) throw new Error("Cancelled");
  if (active) throw new Error("Busy");
  const analyzer = NativeModules.OfflineChordAnalysis as
    | NativeAnalyzer
    | undefined;
  if (
    !["ios", "android"].includes(Platform.OS) ||
    typeof analyzer?.analyzeFile !== "function" ||
    typeof analyzer.cancel !== "function"
  )
    throw new Error("ChordAnalysisUnsupported");
  const owner = Symbol();
  active = owner;
  let cancellation: Promise<void> | undefined;
  let nativeStarted = false;
  let abort: (() => void) | undefined;
  try {
    // Keep the picker owned until it closes; a second caller cannot open another.
    const [file] = await pick({
      type: [types.audio],
      allowMultiSelection: false
    });
    if (signal?.aborted) throw new Error("Cancelled");
    if (!file?.uri || !/^(file|content):\/\//.test(file.uri))
      throw new Error("FileUnavailable");
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => {
        if (active !== owner || cancellation) return;
        cancellation = nativeStarted
          ? Promise.resolve().then(() => analyzer.cancel())
          : Promise.resolve();
        // The next request may start only after native resources are released.
        cancellation = cancellation.catch(() => undefined);
        void cancellation.then(() => reject(new Error("Cancelled")));
      };
    });
    signal?.addEventListener("abort", abort!, { once: true });
    onSelected?.();
    const result = await Promise.race([
      Promise.resolve().then(() => {
        if (signal?.aborted) throw new Error("Cancelled");
        nativeStarted = true;
        return analyzer.analyzeFile(file.uri);
      }),
      interrupted
    ]);
    if (signal?.aborted) throw new Error("Cancelled");
    return {
      ...validateResult(result),
      fileName: (file.name ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, songFieldLimits.title)
    };
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    await cancellation;
    if (active === owner) active = undefined;
  }
}

export function chordTime(seconds: number) {
  const hundredths = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(hundredths / 6000)}:${String(
    Math.floor((hundredths % 6000) / 100)
  ).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
}

export function offlineChordDraft(
  result: OfflineChordAnalysis,
  fallbackTitle: string,
  notice: string,
  unknownLabel: string,
  section?: {
    range?: ChordRange;
    missingLabel: string;
    rangeNotice?: string;
    boundaryNotice: string;
  }
): Partial<FormValues> {
  const selectedRows = chordSection(result, section?.range).rows;
  const rows = section
    ? selectedRows
    : selectedRows.filter((row) => row.kind === "chord");
  const clipped = rows.some(
    (row) => row.kind === "chord" && (row.startClipped || row.endClipped)
  );
  const content = [
    notice,
    ...(section?.rangeNotice ? [section.rangeNotice] : []),
    ...(clipped && section ? [section.boundaryNotice] : []),
    "",
    ...rows.map((row) => {
      const label =
        row.kind === "gap"
          ? section!.missingLabel
          : row.chord === "N"
            ? unknownLabel
            : `[${row.chord}]`;
      const mark =
        section && row.kind === "chord" && (row.startClipped || row.endClipped)
          ? " *"
          : "";
      return `${label} ${chordTime(row.start)}–${chordTime(row.end)}${mark}`;
    })
  ].join("\n");
  if (content.length > songFieldLimits.content)
    throw new Error("ChordChartTooLarge");
  const title =
    result.fileName.replace(/\.[a-zA-Z0-9]{1,8}$/, "").trim() || fallbackTitle;
  const suffix = section?.range
    ? ` (${chordTime(section.range.start)}–${chordTime(section.range.end)})`
    : "";
  return {
    ...initialValues,
    title: `${title.slice(0, songFieldLimits.title - suffix.length)}${suffix}`,
    ...(result.tempo !== null ? { tempo: Math.round(result.tempo) } : {}),
    content
  };
}
