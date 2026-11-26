import { AppState, NativeModules, Platform } from "react-native";
import { pick, types } from "@react-native-documents/picker";
import checkMicPermission from "../permissions";

export interface RecognizedSong {
  title: string;
  artist: string;
  source: "Shazam";
  cover?: string;
  album?: string;
  tempo?: number;
  duration?: number;
  genre?: string;
  lyrics?: string;
  lyricsCredit?: string;
  url?: string;
}
interface NativeRecognizer {
  recognizeMicrophone(): Promise<RecognizedSong | null>;
  recognizePlayback?(): Promise<RecognizedSong | null>;
  requestQuickSettingsTile?(): Promise<boolean>;
  recognizeFile(uri: string): Promise<RecognizedSong | null>;
  consumeResult?(requestId: string): Promise<RecognizedSong | null>;
  cancel(): Promise<void>;
}
const native = (): NativeRecognizer => {
  if (
    !["android", "ios"].includes(Platform.OS) ||
    !NativeModules.SongRecognition
  )
    throw new Error("RecognitionUnsupported");
  return NativeModules.SongRecognition as NativeRecognizer;
};
let cancellation: Promise<void> = Promise.resolve();
let cancelling = false;
let active: symbol | undefined;
async function recognize(
  start: (recognizer: NativeRecognizer) => Promise<RecognizedSong | null>,
  signal?: AbortSignal
) {
  await cancellation;
  while (cancelling) await cancellation;
  if (signal?.aborted) throw new Error("Cancelled");
  if (active) throw new Error("RecognitionBusy");
  const recognizer = native();
  const owner = Symbol();
  active = owner;
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => {
      if (active !== owner) return;
      void cancelRecognition().then(
        () => reject(new Error("Cancelled")),
        () => reject(new Error("Cancelled"))
      );
    };
  });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) {
      abort();
      return await aborted;
    }
    const result = await Promise.race([
      Promise.resolve().then(() => {
        if (signal?.aborted) throw new Error("Cancelled");
        return start(recognizer);
      }),
      aborted
    ]);
    if (signal?.aborted) {
      await cancellation;
      throw new Error("Cancelled");
    }
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (active === owner) active = undefined;
  }
}
export async function recognizeMicrophone(
  signal?: AbortSignal,
  onCaptureReady?: () => void
): Promise<RecognizedSong | null> {
  if (signal?.aborted) throw new Error("Cancelled");
  const granted = await checkMicPermission(true);
  if (signal?.aborted) throw new Error("Cancelled");
  if (!granted) throw new Error("MicrophonePermissionDenied");
  return recognize(async (recognizer) => {
    // Cancellation can outlive an Activity pause; check foreground after it.
    do {
      await waitForAppActive(signal);
      if (signal?.aborted) throw new Error("Cancelled");
    } while (AppState.currentState !== "active");
    onCaptureReady?.();
    if (signal?.aborted) throw new Error("Cancelled");
    return recognizer.recognizeMicrophone();
  }, signal);
}
export const playbackRecognitionSupported = () =>
  Platform.OS === "ios" ||
  (Platform.OS === "android" && Number(Platform.Version) >= 29);

export async function recognizePlayback(
  signal?: AbortSignal
): Promise<RecognizedSong | null> {
  if (signal?.aborted) throw new Error("Cancelled");
  if (!playbackRecognitionSupported() || !native().recognizePlayback)
    throw new Error("PlaybackCaptureUnavailable");
  // Android requires RECORD_AUDIO for playback capture too; ReplayKit does not
  // use the microphone and presents its own explicit system consent on iOS.
  if (Platform.OS === "android") {
    const granted = await checkMicPermission(true);
    if (signal?.aborted) throw new Error("Cancelled");
    if (!granted) throw new Error("MicrophonePermissionDenied");
  }
  return recognize(async (recognizer) => {
    do {
      await waitForAppActive(signal);
      if (signal?.aborted) throw new Error("Cancelled");
    } while (AppState.currentState !== "active");
    return recognizer.recognizePlayback!();
  }, signal);
}

export async function requestQuickSettingsTile() {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return false;
  return native().requestQuickSettingsTile?.() ?? false;
}

export async function waitForAppActive(signal?: AbortSignal) {
  while (AppState.currentState !== "active") {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        subscription.remove();
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new Error("Cancelled"));
      };
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          cleanup();
          resolve();
        }
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else if (AppState.currentState === "active") {
        cleanup();
        resolve();
      }
    });
  }
  if (signal?.aborted) throw new Error("Cancelled");
}
export const recognizeSong = recognizeMicrophone;
export async function consumeRecognitionResult(requestId: string) {
  const result = await native().consumeResult?.(requestId);
  if (!result) throw new Error("RecognitionResultExpired");
  return result;
}
export async function recognizeAudioFile(
  signal?: AbortSignal
): Promise<RecognizedSong | null> {
  if (signal?.aborted) throw new Error("Cancelled");
  const [file] = await pick({
    type: [types.audio],
    allowMultiSelection: false
  });
  if (signal?.aborted) throw new Error("Cancelled");
  if (!file?.uri) throw new Error("FileUnavailable");
  // Read the original content:// through Android's ContentResolver; never delete it.
  await cancellation;
  if (signal?.aborted) throw new Error("Cancelled");
  return recognize((recognizer) => recognizer.recognizeFile(file.uri), signal);
}
export async function cancelRecognition() {
  if (
    ["android", "ios"].includes(Platform.OS) &&
    NativeModules.SongRecognition
  ) {
    if (!cancelling) {
      cancelling = true;
      cancellation = Promise.resolve()
        .then(() => native().cancel())
        .finally(() => {
          cancelling = false;
          cancellation = Promise.resolve();
        });
    }
    await cancellation;
  }
}
