import { SharedValue } from "react-native-reanimated";
import {
  GraphicsMode,
  InstrumentType,
  MicrophoneAccess,
  ParagraphTuple,
  TuningType
} from "./@types";
import { InstrumentString } from "./screens/tuner/instruments";
import { Note } from "./stores/notes";

export interface IWaveProfillerProps {
  sampleRate: number;
  micAccess: MicrophoneAccess;
  setBufferId: (_: number) => void;
  setAudioBuffer: (_: number[]) => void;
  isFocused: boolean;
  waveformH: number;
  addRMS: (_: number) => void;
  audioBuffer: number[];
  bufferId: number;
}
export interface IMainNoteProps {
  positionY?: number;
  currentString?: InstrumentString;
  pitch: number;
  gaugeDeviation?: number;
  gaugeColor: string;
}

export interface ITextItem {
  p: ParagraphTuple;
  y: number;
  x?: number;
  w?: number;
}
export interface IStringsProps {
  currentString?: InstrumentString;
  volume: number;
  gaugeColor: string;
  stringNotes: Note[];
}
export interface ConfigState {
  instrument: InstrumentType;
  tuning: TuningType;
  graphics: GraphicsMode;
  manual: boolean;
  setInstrument: (_: InstrumentType) => void;
  setTuning: (_: TuningType) => void;
  setGraphics: (_: GraphicsMode) => void;
  setManual: (_: boolean) => void;
}
export interface ITuningGaugeProps {
  positionY: number;
  gaugeDeviation?: number;
  gaugeColor: string;
}
export interface IGaugeProps {
  gaugeX: SharedValue<number>;
  gaugeRadius: number;
  gaugeColor: string;
  width: number;
}
export interface IGaugeTextProps extends IMainNoteProps {
  gaugeDeviation?: number;
  gaugeColor: string;
  currentString?: InstrumentString;
  pitch: number;
  width: number;
}
export interface IString {
  name: string;
  thickness: number;
  baseColor: [number, number, number];
  octave: number;
}
export interface StringWithVibrationProps {
  x: number;
  top: number;
  bottom: number;
  thickness: number;
  baseColor: number[];
  active: boolean;
  volume?: number;
}
