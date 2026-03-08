import { SharedValue } from "react-native-reanimated";
import {
  InstrumentString,
  MicrophoneAccess,
  ParagraphTuple,
  TFields
} from "./@types";
import { JSX } from "react";
import { SvgProps } from "react-native-svg";

export interface IModel {
  fields: TFields;
  foreignKeys?: string[];
}
export interface IInstrument {
  Icon: (props: SvgProps) => JSX.Element;
  stringNotes: IString[] | null;
}
export interface ITunerConfig {
  instruments: { [key: string]: IInstrument };
  tunings: string[];
  autoDetect: boolean;
  selectedTuning: string;
  selectedInstrument: string;
}
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
  stringNotes: IString[];
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
  octave: number;
  thickness?: number;
  baseColor?: [number, number, number];
}
export interface INote {
  name: string;
  pitch: number;
  refFreq: number;
  direction: string;
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
export interface IGetItems {
  tableName?: string;
  fields?: string;
  filters?: string;
  page?: number;
  limit?: number;
  joins?: string[];
}

export interface ICreateItem {
  tableName: string;
  data: Record<string, any>;
}
export interface IUpdateItem {
  tableName: string;
  data: Record<string, any>;
  filters: string;
}
export interface IDeleteItem {
  tableName: string;
  filters: string;
}
export interface ISong {
  id: number;
  title: string;
  content: string;
  youtobe_link_music?: string;
  youtobe_link_chords?: string;
  fk_band?: IBand;
  band_id?: number;
  band_name?: string;
}
export interface IBand {
  id: number;
  name: string;
}
