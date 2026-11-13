import { NativeModules, Platform } from "react-native";
import { pick, types } from "@react-native-documents/picker";
import checkMicPermission from "../permissions";

export interface RecognizedSong {
  title: string;
  artist: string;
  source: "Shazam";
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
export async function recognizeMicrophone(): Promise<RecognizedSong | null> {
  if (!(await checkMicPermission(true))) throw new Error("MicrophonePermissionDenied");
  return native().recognizeMicrophone();
}
export async function recognizeAudioFile(): Promise<RecognizedSong | null> {
  const [file] = await pick({ type: [types.audio], allowMultiSelection: false });
  if (!file?.uri) throw new Error("FileUnavailable");
  // Read the original content:// through Android's ContentResolver; never delete it.
  return native().recognizeFile(file.uri);
}
export async function cancelRecognition() {
  if (Platform.OS === "android" && NativeModules.SongRecognition)
    await native().cancel();
}
