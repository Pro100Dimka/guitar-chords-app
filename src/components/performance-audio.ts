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
  list: async (songId: number): Promise<Take[]> => {
    const takes: Take[] = await native.listTakes(String(songId));
    return takes.filter((take) => take.bytes > 0 || take.processing);
  },
  play: (path: string): Promise<number> => native.playTake(path),
  stopPlayback: () => native.stopPlayback(),
  remove: (path: string): Promise<boolean> => native.deleteTake(path),
  success: () => native.playSuccess(),
  prepareGuitar: (key: string, wave: string) =>
    native.prepareGuitar?.(key, wave),
  preparedGuitarSupported: !!(native.prepareGuitar && native.playPreparedGuitar),
  playPreparedGuitar: (key: string) => native.playPreparedGuitar?.(key),
  guitar: (wave: string, key?: string) =>
    key && native.prepareGuitar && native.playPreparedGuitar
      ? native.playPreparedGuitar(key)
      : native.playGuitar(wave),
  listen: (listener: (event: PerformanceEvent) => void) =>
    emitter.addListener("onPerformanceAudio", listener)
};
