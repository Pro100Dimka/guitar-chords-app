import { FC, memo, Profiler, useEffect, useRef } from "react";
import { Waveform } from "../Waveform";
import { getTestSignal } from "../../test";
import MicrophoneStreamModule, {
  AudioBuffer
} from "../../../../../modules/microphone-stream/src/MicrophoneStreamModule";
import { BUF_SIZE, MicrophoneAccess } from "../..";
// import NativeDSPModule from "../../../../../specs/NativeDSPModule";

interface IWaveProfillerProps {
  TEST_MODE: boolean;
  sampleRate: number;
  BUF_PER_SEC: number;
  micAccess: MicrophoneAccess;
  setBufferId: (_: number) => void;
  setAudioBuffer: (_: number[]) => void;
  isFocused: boolean;
  WAVE_FORM_Y: number;
  waveformH: number;
  addRMS: (_: number) => void;
  audioBuffer: number[];
  bufferId: number;
}

const WaveformMemo = memo(Waveform);

const WaveProfiller: FC<IWaveProfillerProps> = ({
  TEST_MODE,
  sampleRate,
  BUF_PER_SEC,
  micAccess,
  setBufferId,
  WAVE_FORM_Y,
  waveformH,
  bufferId,
  audioBuffer,
  setAudioBuffer,
  isFocused,
  addRMS
}) => {
  const audioBufferRef = useRef<number[]>(new Array(BUF_SIZE).fill(0));
  const micStartedRef = useRef(false);
  const bufferIdRef = useRef(0);
  const onRenderCallback = () => {
    // можно включить для профилирования рендеров
    // console.info(`Waveform rendered`);
  };
  useEffect(() => {
    if (!isFocused) return;
    let intervalRender = null;
    let intervalTest = null;
    let subscriber: any = null;
    if (TEST_MODE && sampleRate > 0) {
      // тестовый сигнал
      const bufSize = sampleRate / BUF_PER_SEC;
      intervalTest = setInterval(() => {
        const buffer = getTestSignal(bufferIdRef.current, sampleRate, bufSize);
        audioBufferRef.current = buffer;
        bufferIdRef.current += 1;
      }, 1000 / BUF_PER_SEC);
    } else if (micAccess === "granted" && !micStartedRef.current) {
      // микрофон
      micStartedRef.current = true;
      MicrophoneStreamModule.startRecording();
      subscriber = MicrophoneStreamModule.addListener(
        "onAudioBuffer",
        (buffer: AudioBuffer) => {
          const len = buffer.samples.length;
          audioBufferRef.current = [
            ...audioBufferRef.current.slice(len),
            ...buffer.samples
          ];
          // addRMS(NativeDSPModule.rms(buffer.samples));
          bufferIdRef.current += 1;
        }
      );
    }
    // общий интервал рендера 30 FPS
    intervalRender = setInterval(() => {
      setAudioBuffer([...audioBufferRef.current]);
      setBufferId(bufferIdRef.current);
    }, 1000 / 30);
    return () => {
      if (intervalTest) clearInterval(intervalTest);
      if (intervalRender) clearInterval(intervalRender);
      if (subscriber) {
        subscriber.remove();
        MicrophoneStreamModule.stopRecording();
        micStartedRef.current = false;
      }
    };
  }, [
    TEST_MODE,
    sampleRate,
    micAccess,
    isFocused,
    BUF_PER_SEC,
    setBufferId,
    setAudioBuffer,
    addRMS
  ]);

  return (
    <Profiler id="Waveform" onRender={onRenderCallback}>
      <WaveformMemo
        audioBuffer={audioBuffer}
        positionY={WAVE_FORM_Y}
        height={waveformH}
        bufferId={bufferId}
        bufPerSec={BUF_PER_SEC}
      />
    </Profiler>
  );
};

export default WaveProfiller;
