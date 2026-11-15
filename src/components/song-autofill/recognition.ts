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
  recognizeFile(uri: string): Promise<RecognizedSong | null>;
  cancel(): Promise<void>;
}
const native = (): NativeRecognizer => {
  if (Platform.OS !== "android" || !NativeModules.SongRecognition)
    throw new Error("RecognitionUnsupported");
  return NativeModules.SongRecognition as NativeRecognizer;
};
let cancellation: Promise<void> = Promise.resolve();
export async function recognizeMicrophone(
  signal?: AbortSignal,
  onCaptureReady?: () => void
): Promise<RecognizedSong | null> {
  if (signal?.aborted) throw new Error("Cancelled");
  const granted = await checkMicPermission(true);
  if (signal?.aborted) throw new Error("Cancelled");
  if (!granted) throw new Error("MicrophonePermissionDenied");
  await cancellation;
  if (signal?.aborted) throw new Error("Cancelled");
  await waitForAppActive(signal);
  const recognizer = native();
  onCaptureReady?.();
  return recognizer.recognizeMicrophone();
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
  return native().recognizeFile(file.uri);
}
export async function cancelRecognition() {
  if (Platform.OS === "android" && NativeModules.SongRecognition) {
    cancellation = native().cancel();
    await cancellation;
  }
}
