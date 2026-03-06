/* eslint-disable react-hooks/exhaustive-deps */
// src/screens/tuner/index.tsx
import DSPModule from "@/../specs/NativeDSPModule";
import "@expo/metro-runtime";
import { AudioModule } from "expo-audio";
import { useConfigStore } from "../../stores/configStore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@shopify/react-native-skia";
import { useShallow } from "zustand/react/shallow";
import { Alert, StyleSheet, View, useWindowDimensions } from "react-native";
import { useUiStore } from "../../stores/uiStore";
import { Instrument, instruments } from "./instruments";
import { useTranslation } from "react-i18next";
import { RightButtons } from "./components/RightButtons";
import RequireMicAccess from "./components/RequireMicAccess";
import { getFreqFromNote, Note, sameNote } from "@/stores/notes";
import { useNavigationState } from "@react-navigation/native";
import { InstrumentType, MicrophoneAccess } from "@/@types";
import {
  BUF_PER_SEC,
  BUF_SIZE,
  calculateGaugeDeviation,
  DEF_SAMPLE_RATE,
  getPitchFilterParams,
  TEST_MODE,
  WAVE_FORM_Y
} from "./const";
import GaugeWithNote from "./components/gauge-with-note";
import StringsView, {
  NOTE_BOX_WIDTH,
  TRANSLATE_Y_STRINGS
} from "./components/strings";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { getTestSignal } from "./test";
import MicrophoneStreamModule, {
  AudioBuffer
} from "../../../modules/microphone-stream/src/MicrophoneStreamModule";

const Tuner: React.FC = () => {
  const { t } = useTranslation();
  const config = useConfigStore();
  const { width, height } = useWindowDimensions();
  const { setManual } = config;
  const [pitch, setPitch] = useState(-1);
  const [bufferId, setBufferId] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending");
  const activeRoute = useNavigationState((state) => state.routes[state.index]);
  const audioBufferRef = useRef<number[]>(new Array(BUF_SIZE).fill(0));
  const micStartedRef = useRef(false);
  const bufferIdRef = useRef(0);
  const {
    pitchHistory,
    rmsHistory,
    idHistory,
    addPitch,
    addId,
    stringHistory,
    addString,
    currentString,
    setCurrentString,
    addRMS
  } = useUiStore(useShallow((state) => state));
  const { gaugeDeviation, gaugeColor, waveformH } = useMemo(
    () => calculateGaugeDeviation(height, pitch, currentString?.freq),
    [height, pitch, currentString?.freq]
  );
  const instrument: Instrument = useMemo(
    () => new instruments[config.instrument as InstrumentType](config.tuning),
    [config.instrument]
  );
  const stringNotes = useMemo(() => instrument.getStrings(), [instrument]);

  useEffect(() => {
    (async () => {
      let { granted } = await AudioModule.getRecordingPermissionsAsync();
      if (granted) {
        if (micAccess === "pending") {
          console.info(`Setting sample rate to ${DEF_SAMPLE_RATE}Hz`);
          setSampleRate(DEF_SAMPLE_RATE);
        }
      } else {
        const result = await AudioModule.requestRecordingPermissionsAsync();
        granted = result.granted;
      }
      setMicAccess(granted ? "granted" : "denied");
      if (!granted) Alert.alert(t`ErrorMicAccess`);
    })();
  }, [t, micAccess]);
  useEffect(() => {
    if (activeRoute.name !== "tuner") return;
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
          const rms = +DSPModule.rms(buffer.samples).toFixed(2);
          if (rms <= 0.01) {
            audioBufferRef.current = new Array(BUF_SIZE).fill(0);
            bufferIdRef.current = 0;
            return;
          }
          audioBufferRef.current = [
            ...audioBufferRef.current.slice(-BUF_SIZE + len),
            ...buffer.samples
          ];
          addRMS(rms);
          bufferIdRef.current += 1;
        }
      );
    }
    // общий интервал рендера 30 FPS
    intervalRender = setInterval(() => {
      if (bufferIdRef.current !== bufferId) {
        setBufferId(bufferIdRef.current);
      }
    }, 150);
    return () => {
      if (intervalTest) clearInterval(intervalTest);
      if (intervalRender) clearInterval(intervalRender);
      if (subscriber) {
        subscriber.remove();
        MicrophoneStreamModule.stopRecording();
        micStartedRef.current = false;
      }
    };
  }, [sampleRate, micAccess, activeRoute.name]);
  useEffect(() => {
    if (
      !audioBufferRef.current.length ||
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
      audioBufferRef.current,
      sampleRate,
      minFreq,
      maxFreq,
      threshold
    );

    if (pitch !== pitchHistory[pitchHistory.length - 1]) {
      console.info(
        `Pitch: ${pitch.toFixed(1)}Hz [${minFreq.toFixed(1)}Hz-${maxFreq.toFixed(1)}Hz] `
      );
      setPitch(pitch);
      addPitch(pitch);
    }
  }, [sampleRate, micAccess, rmsHistory, pitchHistory, idHistory, bufferId]);
  useEffect(() => {
    const nearest =
      !(config.manual || pitch <= 0) && instrument.getNearestString(pitch);
    if (!nearest || currentString?.note === nearest?.note) return;
    addString(nearest);
  }, [pitch, instrument, config.manual, addString, currentString?.note]);
  useEffect(() => {
    if (config.manual || stringHistory.length < 3) return;
    const [s1, s2, s3] = stringHistory.slice(-3);
    const stable = sameNote(s1?.note, s2?.note) && sameNote(s1?.note, s3?.note);
    if (stable) setCurrentString(s1);
  }, [stringHistory, config.manual, setCurrentString]);
  if (activeRoute.name !== "tuner") return;
  const selectString = (note: Note) => {
    setManual(true);
    setCurrentString({
      note,
      freq: getFreqFromNote(note, config.tuning)
    });
  };
  const tapGesture = Gesture.Tap().onStart((e) => {
    const { x, y } = e;
    const bottom = height / 3;
    const spacing = width / (stringNotes.length + 1);
    stringNotes.forEach((note, i) => {
      const stringX = spacing * (i + 1);
      const halfBox = NOTE_BOX_WIDTH / 2;
      const hit =
        Math.abs(x - stringX) < halfBox &&
        y >= TRANSLATE_Y_STRINGS &&
        y <= bottom;
      if (hit) {
        runOnJS(selectString)(note);
      }
    });
  });

  return micAccess === "granted" ? (
    <View style={styles.container}>
      <RightButtons
        positionY={WAVE_FORM_Y + waveformH}
        instrument={instrument}
      />
      <GestureDetector gesture={tapGesture}>
        <Canvas style={styles.flex}>
          <GaugeWithNote
            gaugeDeviation={gaugeDeviation}
            gaugeColor={gaugeColor}
            currentString={currentString}
            pitch={pitch}
          />
          <StringsView
            currentString={currentString}
            volume={rmsHistory.at(-1) ?? 0}
            stringNotes={stringNotes}
            gaugeColor={gaugeColor}
          />
        </Canvas>
      </GestureDetector>
    </View>
  ) : micAccess === "denied" ? (
    <RequireMicAccess />
  ) : (
    <View style={styles.container} />
  );
};
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "center"
  }
});

export default Tuner;
