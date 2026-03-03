import { MicrophoneAccess } from "./@types";

export interface IWaveProfillerProps {
  sampleRate: number;
  micAccess: MicrophoneAccess;
  setBufferId: (_: number) => void;
  setAudioBuffer: (_: number[]) => void;
  isFocused: boolean;
  WAVE_FORM_Y: number;
  waveformH: number;
  addRMS: (_: number) => void;
  audioBuffer: number[];
  bufferId: number;
}
