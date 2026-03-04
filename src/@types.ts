import {
  GRAPHIC_MODES,
  INSTRUMENT_IDS,
  TUNING_IDS
} from "./stores/configStore";

export type MicrophoneAccess = "pending" | "granted" | "denied";
export type PitchFilterParams = {
  minFreq: number;
  maxFreq: number;
  threshold: number;
};
export type ParagraphTuple = [string, number, number, string];
export type ParagraphProps = [string[], [number, number, number]];

export type InstrumentType = (typeof INSTRUMENT_IDS)[number];
export type TuningType = (typeof TUNING_IDS)[number];
export type GraphicsMode = (typeof GRAPHIC_MODES)[number];
export type Point = { x: number; y: number } | any;
