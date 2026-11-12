import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export interface ImportedAudio {
  path: string;
  uri: string;
  /** Content-addressed basename relative to DocumentDir/FreeTuneAudio. */
  fileName: string;
  originalName: string;
  mimeType: string;
  sha256: string;
  bytes: number;
  durationMs: number;
}

export interface SongAudioState {
  path: string | null;
  state: "idle" | "loading" | "paused" | "playing" | "ended" | "error";
  positionMs: number;
  durationMs: number;
  seeking: boolean;
  loopStartMs: number | null;
  loopEndMs: number | null;
  error?: string;
}

interface SongAudioNative {
  importAudio(
    uri: string,
    name: string,
    requestId: string
  ): Promise<ImportedAudio>;
  cancelImport(requestId: string): void;
  probe(fileName: string): Promise<ImportedAudio>;
  load(fileNameOrPath: string): Promise<SongAudioState>;
  play(): Promise<SongAudioState>;
  pause(): Promise<SongAudioState>;
  seek(positionMs: number): Promise<SongAudioState>;
  setLoop(startMs: number, endMs: number): Promise<SongAudioState>;
  getState(): Promise<SongAudioState>;
  unload(): Promise<SongAudioState>;
  addListener(eventType: string): void;
  removeListeners(count: number): void;
}

const native: SongAudioNative | undefined = NativeModules.SongAudio;
const supported = Platform.OS === "android" && !!native;
const emitter = supported ? new NativeEventEmitter(native) : undefined;
const requireNative = (): SongAudioNative => {
  if (!supported || !native) {
    throw Object.assign(new Error("AudioAnalysisAndroidOnly"), {
      code: "AUDIO_UNSUPPORTED"
    });
  }
  return native;
};

/** No timer extrapolation: highlighting follows positions reported by Android. */
export const songAudio = {
  isSupported: supported,
  importAudio: (uri: string, name: string, requestId: string) =>
    requireNative().importAudio(uri, name, requestId),
  cancelImport: (requestId: string) => {
    if (supported) native?.cancelImport(requestId);
  },
  probe: (fileName: string) => requireNative().probe(fileName),
  load: (fileNameOrPath: string) => requireNative().load(fileNameOrPath),
  play: () => requireNative().play(),
  pause: () => requireNative().pause(),
  seek: (positionMs: number) => requireNative().seek(positionMs),
  setLoop: (startMs: number | null, endMs: number | null) =>
    requireNative().setLoop(startMs ?? -1, endMs ?? -1),
  getState: () => requireNative().getState(),
  unload: () => requireNative().unload(),
  listen: (listener: (state: SongAudioState) => void) =>
    emitter?.addListener("onSongAudio", listener) ?? { remove() {} }
};
