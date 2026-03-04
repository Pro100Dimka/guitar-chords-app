import { PitchFilterParams } from "@/@types";
import MicrophoneStreamModule from "../../../modules/microphone-stream/src/MicrophoneStreamModule";
import Colors from "./colors";
import { getRelativeDiff } from "@/stores/notes";

const MIN_FREQ = 30;
const MAX_FREQ = 500;
const MAX_PITCH_DEV = 0.2;
const THRESHOLD_DEFAULT = 0.15;
const THRESHOLD_NOISY = 0.6;
const RMS_GAP = 1.1;
const ENABLE_FILTER = true;
export const TEST_MODE = false;
export const BUF_SIZE = 9000;
export const DEF_SAMPLE_RATE = MicrophoneStreamModule.getSampleRate() || 44100;
export const GAUGE_WIDTH = 10;
export const WAVE_FORM_Y = 60;
export const BUF_PER_SEC = MicrophoneStreamModule.BUF_PER_SEC;

export const getPitchFilterParams = (
  pitchQ: number[],
  rmsQ: number[]
): PitchFilterParams => {
  const last = pitchQ.length - 1;
  const pitch1 = pitchQ[last] ?? 0;
  const pitch2 = pitchQ[last - 1] ?? pitch1;
  const rms1 = rmsQ[last] ?? 0;
  const rms2 = rmsQ[last - 1] ?? rms1;
  const restrictRange =
    ENABLE_FILTER &&
    pitch1 > 0 &&
    rms1 < rms2 * RMS_GAP &&
    getRelativeDiff(pitch1, pitch2) <= MAX_PITCH_DEV;
  if (!restrictRange) {
    return {
      minFreq: MIN_FREQ,
      maxFreq: MAX_FREQ,
      threshold: THRESHOLD_DEFAULT
    };
  }
  return {
    minFreq: pitch1 * (1 - MAX_PITCH_DEV),
    maxFreq: pitch1 * (1 + MAX_PITCH_DEV),
    threshold: THRESHOLD_NOISY
  };
};
export const calculateGaugeDeviation = (
  h: number,
  pitch: number,
  stringFreq?: number
): any => {
  const obj: any = {
    waveformH: h / 8,
    movingGridY: h * 0.55
  };
  obj.movingGridH = h - obj.movingGridY;
  if (pitch > 0 && stringFreq)
    obj.gaugeDeviation =
      Math.atan((10 * (pitch - stringFreq)) / stringFreq) / (Math.PI / 2);
  obj.gaugeColor = Colors.getColorFromGaugeDeviation(obj?.gaugeDeviation);
  return obj;
};
