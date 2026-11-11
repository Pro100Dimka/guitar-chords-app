import { NativeEventEmitter, NativeModules } from "react-native";

export interface Take {
  path: string;
  date: number;
  bytes: number;
  processing?: boolean;
}
export interface PerformanceEvent {
  state: "saved" | "error" | "stopped" | "processing" | "processingFailed";
  uri?: string;
}
const native = NativeModules.PerformanceAudio;
const emitter = new NativeEventEmitter(native);
export const performanceAudio = {
  start: (songId: number): Promise<string> => native.startTake(String(songId)),
  stop: (): Promise<string | null> => native.stopTake(),
  list: (songId: number): Promise<Take[]> => native.listTakes(String(songId)),
  play: (path: string): Promise<number> => native.playTake(path),
  stopPlayback: () => native.stopPlayback(),
  remove: (path: string): Promise<boolean> => native.deleteTake(path),
  success: () => native.playSuccess(),
  guitar: (wave: string) => native.playGuitar(wave),
  listen: (listener: (event: PerformanceEvent) => void) =>
    emitter.addListener("onPerformanceAudio", listener)
};
