// /MicrophoneStream.ts
import { IString } from "@/@interfaces";
import { NativeModules, NativeEventEmitter } from "react-native";

const { MicrophoneStream } = NativeModules;

type NoteData = {
  note: string;
  pitch: number;
  refFreq: number;
  octave: number;
  direction: "<" | "=" | ">";
  diff: number;
};

export type AudioBufferEvent = {
  samples?: number[];
  rms: number;
  pitch: number;
  note: string;
  refFreq: number;
  octave: number;
  direction: "<" | "=" | ">";
} & NoteData;

class MicrophoneStreamWrapper {
  private emitter: NativeEventEmitter;
  // храним подписки вместо колбеков
  private subscriptions: Map<string, { subscription: any }> = new Map();

  constructor() {
    this.emitter = new NativeEventEmitter(MicrophoneStream);
  }

  startRecording() {
    MicrophoneStream.startRecording();
  }

  stopRecording() {
    MicrophoneStream.stopRecording();
  }

  releaseRecorder() {
    MicrophoneStream.releaseRecorder();
  }

  setSmoothing(rmsAlpha: number, pitchAlpha: number) {
    MicrophoneStream.setSmoothing(rmsAlpha, pitchAlpha);
  }

  getSampleRate(): Promise<number> {
    return MicrophoneStream.getSampleRate();
  }

  getBufPerSec(): Promise<number> {
    return MicrophoneStream.getBufPerSec();
  }
  setTargetNotes(notes: IString[] | null) {
    MicrophoneStream.setTargetNotes(notes);
  }
  addListener(callback: (data: AudioBufferEvent) => void) {
    const subscription = this.emitter.addListener("onAudioBuffer", callback);
    const id = Date.now().toString();
    this.subscriptions.set(id, { subscription });
    return id;
  }

  removeListener(id: string) {
    const sub = this.subscriptions.get(id);
    if (sub) {
      sub.subscription.remove(); // вот так удаляем конкретного слушателя
      this.subscriptions.delete(id);
    }
  }

  removeAllListeners() {
    this.subscriptions.forEach(({ subscription }) => subscription.remove());
    this.subscriptions.clear();
  }
}

export default new MicrophoneStreamWrapper();
