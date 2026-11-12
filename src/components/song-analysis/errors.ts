const nativeErrors: Record<string, string> = {
  AUDIO_UNSUPPORTED: "AudioAnalysisAndroidOnly",
  AUDIO_CANCELED: "AnalysisCancelled",
  AUDIO_BUSY: "AudioBusy",
  AUDIO_SPACE: "AudioNoSpace",
  AUDIO_SIZE: "AudioTooLarge",
  AUDIO_DURATION: "AudioTooLong",
  AUDIO_SOURCE: "AudioReadError",
  AUDIO_SAVE: "AudioSaveError",
  AUDIO_MISSING: "AudioMissing",
  AUDIO_CHANGED: "AudioDifferentFile",
  AUDIO_FOCUS: "AudioFocusError",
  AUDIO_NOT_READY: "AudioNotReady",
  AUDIO_LOOP: "AudioLoopInvalid",
  AUDIO_PLAYBACK: "AudioPlaybackError",
  AUDIO_FAILED: "AudioPlaybackError",
  AUDIO_FORMAT: "AudioFormatError",
  AUDIO_TOO_LARGE: "AudioTooLarge",
  AUDIO_TOO_LONG: "AudioTooLong",
  AUDIO_NO_SPACE: "AudioNoSpace",
  AUDIO_READ: "AudioReadError",
  AUDIO_DECODE: "AudioReadError",
  AUDIO_INVALID: "AudioReadError",
  AUDIO_NOT_FOUND: "AudioMissing",
  AUDIO_CANCELLED: "AnalysisCancelled",
  AUDIO_MEMORY: "AudioMemoryError"
};
export function analysisErrorKey(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const mapped = nativeErrors[String(error.code)];
    if (mapped) return mapped;
  }
  const message = error instanceof Error ? error.message : "";
  return /^(Audio|Analysis)[A-Za-z]+$/.test(message)
    ? message
    : "AnalysisFailed";
}
