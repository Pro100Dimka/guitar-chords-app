export type MicrophoneAccess = "pending" | "granted" | "denied";
export type PitchFilterParams = {
  minFreq: number;
  maxFreq: number;
  threshold: number;
};
