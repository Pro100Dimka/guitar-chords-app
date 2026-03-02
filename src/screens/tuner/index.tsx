import MicrophoneStreamModule from "@/../modules/microphone-stream";
import DSPModule from "@/../specs/NativeDSPModule";
import "@expo/metro-runtime";
import { AudioModule } from "expo-audio";
import { InstrumentType, useConfigStore } from "../../stores/configStore";
import React, { useEffect, useMemo, useState } from "react";
import { Canvas } from "@shopify/react-native-skia";
import { useShallow } from "zustand/react/shallow";
import { Alert, StyleSheet, View, useWindowDimensions } from "react-native";
import { useUiStore } from "../../stores/uiStore";
import { Instrument, instruments } from "./instruments";
import Colors from "./colors";
import { useTranslation } from "react-i18next";
import { MainNote } from "./components/MainNote";
import MovingGrid from "./components/MovingGrid";
import { TuningGauge } from "./components/TuningGauge";
import { Strings } from "./components/Strings";
import { RightButtons } from "./components/RightButtons";
import ConfigButton from "./components/ConfigButton";
import RequireMicAccess from "./components/RequireMicAccess";
import { getRelativeDiff, sameNote } from "@/stores/notes";
import WaveProfiller from "./components/WaveProfiller";
import { useNavigationState } from "@react-navigation/native";

export type MicrophoneAccess = "pending" | "granted" | "denied";
type FilterParams = {
  minFreq: number;
  maxFreq: number;
  threshold: number;
};

export const BUF_SIZE = 9000;
const MIN_FREQ = 30;
const MAX_FREQ = 500;
const MAX_PITCH_DEV = 0.2;
const THRESHOLD_DEFAULT = 0.15;
const THRESHOLD_NOISY = 0.6;
const RMS_GAP = 1.1;
const ENABLE_FILTER = true;
const TEST_MODE = false;
const DEF_SAMPLE_RATE = MicrophoneStreamModule.getSampleRate() || 44100;
const GAUGE_WIDTH = 10;
const WAVE_FORM_Y = 60;
const BUF_PER_SEC = MicrophoneStreamModule.BUF_PER_SEC;

const calculateGaugeDeviation = (
  h: number,
  pitch: number,
  stringFreq?: number
): any => {
  const obj: any = {
    waveformH: h / 8,
    movingGridY: h * 0.55
  };
  obj.movingGridH = h - obj.movingGridY;
  obj.stringsH =
    h - WAVE_FORM_Y - obj.waveformH - obj.movingGridH - GAUGE_WIDTH / 2;
  if (pitch > 0 && stringFreq)
    obj.gaugeDeviation =
      Math.atan((10 * (pitch - stringFreq)) / stringFreq) / (Math.PI / 2);
  obj.gaugeColor = Colors.getColorFromGaugeDeviation(obj?.gaugeDeviation);
  return obj;
};

const getPitchFilterParams = (
  pitchQ: number[],
  rmsQ: number[]
): FilterParams => {
  const last = pitchQ.length - 1;
  const pitch1 = pitchQ[last] ?? 0;
  const pitch2 = pitchQ[last - 1] ?? pitch1;
  const rms1 = rmsQ[last] ?? 0;
  const rms2 = rmsQ[last - 1] ?? rms1;
  const restrictRange =
    ENABLE_FILTER &&
    pitch1 > 0 &&
    rms1 < rms2 * RMS_GAP &&
    getRelativeDiff(pitch1, pitch2) <= MAX_PITCH_DEV;
  if (!restrictRange) {
    return {
      minFreq: MIN_FREQ,
      maxFreq: MAX_FREQ,
      threshold: THRESHOLD_DEFAULT
    };
  }
  return {
    minFreq: pitch1 * (1 - MAX_PITCH_DEV),
    maxFreq: pitch1 * (1 + MAX_PITCH_DEV),
    threshold: THRESHOLD_NOISY
  };
};
const Tuner: React.FC = () => {
  const { t } = useTranslation();
  const config = useConfigStore();
  const { width, height } = useWindowDimensions();
  const { setManual } = config;
  const [pitch, setPitch] = useState(-1);
  const [audioBuffer, setAudioBuffer] = useState<number[]>(() =>
    new Array(BUF_SIZE).fill(0)
  );
  const [bufferId, setBufferId] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending");
  const activeRoute = useNavigationState((state) => state.routes[state.index]);
  const {
    pitchHistory,
    rmsHistory,
    idHistory,
    addRMS,
    addPitch,
    addId,
    stringHistory,
    addString,
    currentString,
    setCurrentString
  } = useUiStore(useShallow((state) => state));
  const { gaugeDeviation, gaugeColor, waveformH, movingGridY, stringsH } =
    calculateGaugeDeviation(height, pitch, currentString?.freq);
  const instrument: Instrument = useMemo(
    () => new instruments[config.instrument as InstrumentType](config.tuning),
    [config.instrument, config.tuning]
  );

  useEffect(() => {
    (async () => {
      let { granted } = await AudioModule.getRecordingPermissionsAsync();
      if (granted) {
        if (micAccess === "pending") {
          console.info(`Setting sample rate to ${DEF_SAMPLE_RATE}Hz`);
          setSampleRate(DEF_SAMPLE_RATE);
        }
        setMicAccess("granted");
      } else {
        const result = await AudioModule.requestRecordingPermissionsAsync();
        granted = result.granted;
      }
      setMicAccess(granted ? "granted" : "denied");
      if (!granted) Alert.alert(t`ErrorMicAccess`);
    })();
  }, [t, micAccess]);

  useEffect(() => {
    if (
      !audioBuffer.length ||
      micAccess !== "granted" ||
      bufferId === idHistory.at(-1)
    )
      return;
    addId(bufferId);
    const { minFreq, maxFreq, threshold } = getPitchFilterParams(
      pitchHistory,
      rmsHistory
    );
    const pitch = DSPModule.pitch(
      audioBuffer,
      sampleRate,
      minFreq,
      maxFreq,
      threshold
    );
    if (pitch !== pitchHistory[pitchHistory.length - 1]) {
      // console.info(
      //   `Pitch: ${pitch.toFixed(1)}Hz [${minFreq.toFixed(1)}Hz-${maxFreq.toFixed(1)}Hz] `
      // );
      setPitch(pitch);
      addPitch(pitch);
    }
  }, [
    audioBuffer,
    sampleRate,
    micAccess,
    addId,
    addPitch,
    rmsHistory,
    pitchHistory,
    idHistory,
    bufferId
  ]);

  useEffect(() => {
    if (!instrument.hasStrings && config.manual) setManual(false);
  }, [instrument, config.manual, setManual]);
  useEffect(() => {
    if (config.manual || pitch <= 0) return;
    const nearest = instrument.getNearestString(pitch);
    if (!nearest) return;
    const current = currentString;
    if (current?.note === nearest.note) return;
    addString(nearest);
  }, [pitch, instrument, config.manual, addString, currentString]);
  useEffect(() => {
    if (config.manual) return;
    if (stringHistory.length < 3) return;
    const [s1, s2, s3] = stringHistory.slice(-3);
    const stable = sameNote(s1?.note, s2?.note) && sameNote(s1?.note, s3?.note);
    if (stable) setCurrentString(s1);
  }, [stringHistory, config.manual, setCurrentString]);

  return micAccess === "granted" ? (
    <View style={styles.container}>
      <Canvas style={styles.flex}>
        <WaveProfiller
          TEST_MODE={TEST_MODE}
          sampleRate={sampleRate}
          BUF_PER_SEC={BUF_PER_SEC}
          micAccess={micAccess}
          setBufferId={setBufferId}
          isFocused={activeRoute.name === "tuner"}
          WAVE_FORM_Y={WAVE_FORM_Y}
          waveformH={waveformH}
          audioBuffer={audioBuffer}
          setAudioBuffer={setAudioBuffer}
          bufferId={bufferId}
          addRMS={addRMS}
        />
        <MainNote
          positionY={movingGridY - GAUGE_WIDTH - 10}
          currentString={currentString}
          pitch={pitch}
          gaugeDeviation={gaugeDeviation}
          gaugeColor={gaugeColor}
        />
        <MovingGrid
          positionY={movingGridY}
          pitchId={bufferId}
          deviation={gaugeDeviation}
          pointsPerSec={BUF_PER_SEC}
        />
        <TuningGauge
          positionY={movingGridY}
          gaugeColor={gaugeColor}
          gaugeDeviation={gaugeDeviation}
          gaugeWidth={GAUGE_WIDTH}
          framesPerSec={BUF_PER_SEC}
        />
      </Canvas>
      <Strings
        positionY={WAVE_FORM_Y + waveformH}
        height={stringsH}
        instrument={instrument}
      />
      <RightButtons
        positionY={WAVE_FORM_Y + waveformH}
        instrument={instrument}
      />
      <ConfigButton x={width - 50 * 1.5} y={height - 50 * 1.5} size={1.5} />
    </View>
  ) : micAccess === "denied" ? (
    <RequireMicAccess />
  ) : (
    <View style={styles.container} />
  );
};
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.bgInactive }
});

export default Tuner;
