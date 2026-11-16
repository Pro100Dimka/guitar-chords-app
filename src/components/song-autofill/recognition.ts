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
  await cancellation;
  if (signal?.aborted) throw new Error("Cancelled");
  await waitForAppActive(signal);
  return recognize((recognizer) => {
    onCaptureReady?.();
    if (signal?.aborted) throw new Error("Cancelled");
    return recognizer.recognizeMicrophone();
  }, signal);
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
  return recognize((recognizer) => recognizer.recognizeFile(file.uri), signal);
}
export async function cancelRecognition() {
  if (
    ["android", "ios"].includes(Platform.OS) &&
    NativeModules.SongRecognition
  ) {
    if (!cancelling) {
      cancelling = true;
      cancellation = native()
        .cancel()
        .finally(() => {
          cancelling = false;
          cancellation = Promise.resolve();
        });
    }
    await cancellation;
  }
}
