import MicrophoneStreamModule, {
  AudioBuffer
} from "@/../modules/microphone-stream";
import DSPModule from "@/../specs/NativeDSPModule";
import { getTestSignal } from "./test";
import "@expo/metro-runtime";
import { AudioModule } from "expo-audio";
import { useConfigStore } from "../../stores/configStore";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from "react-native";
import { useUiStore } from "../../stores/uiStore";
import { Chromatic, Guitar, Instrument } from "./instruments";

const BUF_SIZE = 9000;

// See python notebook to tweak these params
const MIN_FREQ = 30;
const MAX_FREQ = 500;
const MAX_PITCH_DEV = 0.2;
const THRESHOLD_DEFAULT = 0.15;
const THRESHOLD_NOISY = 0.6;
const RMS_GAP = 1.1;
const ENABLE_FILTER = true;
const TEST_MODE = false;
type MicrophoneAccess = "pending" | "granted" | "denied";
const BUF_PER_SEC = MicrophoneStreamModule.BUF_PER_SEC;
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OCTAVE_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export function getRelativeDiff(freq1: number, freq2: number): number {
  return Math.abs(freq1 - freq2) / (Math.abs(freq1) + 0.001);
}
export type NoteName = (typeof NOTE_NAMES)[number];
export type OctaveNumber = (typeof OCTAVE_NUMBERS)[number];
export type Note = { name: NoteName; octave: OctaveNumber };
export const sameNote = (note1?: Note, note2?: Note) =>
  note1 && note1.name === note2?.name && note1.octave === note2.octave;

console.info(`Preferred buffers per second: ${BUF_PER_SEC}`);
const Tuner: React.FC = () => {
  const { width, height } = useWindowDimensions();
  const config = useConfigStore();
  const setManual = useConfigStore((state) => state.setManual);
  // Audio buffer
  const [sampleRate, setSampleRate] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<number[]>(() =>
    new Array(BUF_SIZE).fill(0)
  );
  const [bufferId, setBufferId] = useState(0);

  // Flag for microphone access granted
  const [micAccess, setMicAccess] = useState<MicrophoneAccess>("pending");

  // Detected pitch
  const [pitch, setPitch] = useState(-1);

  // Pitch and RMS history
  const pitchQ = useUiStore((state) => state.pitchHistory);
  const rmsQ = useUiStore((state) => state.rmsHistory);
  const idQ = useUiStore((state) => state.idHistory);
  const addPitch = useUiStore((state) => state.addPitch);
  const addRMS = useUiStore((state) => state.addRMS);
  const addId = useUiStore((state) => state.addId);

  // Current string detection filtering
  const stringHistory = useUiStore((state) => state.stringHistory);
  const addString = useUiStore((state) => state.addString);
  const currentString = useUiStore((state) => state.currentString);
  const setCurrentString = useUiStore((state) => state.setCurrentString);

  // Request recording permission
  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (status.granted) {
        console.info("Granted microphone permission");
        setMicAccess("granted");
      } else {
        setMicAccess("denied");
        Alert.alert("error_mic_access");
      }
    })();
  }, []);

  const onRenderCallback = (
    id: string,
    phase: string,
    actualDuration: number
  ) => {
    // console.info(`Component ${id} took ${actualDuration} ms to render (${phase} phase)`)
  };

  // Start microphone recording
  useEffect(() => {
    if (TEST_MODE || micAccess !== "granted") return;

    // Start microphone
    MicrophoneStreamModule.startRecording();
    console.info("Start recording");

    // Suscribe to microphone buffer
    const subscriber = MicrophoneStreamModule.addListener(
      "onAudioBuffer",
      (buffer: AudioBuffer) => {
        // Append new audio samples to the end of the buffer
        const len = buffer.samples.length;
        setAudioBuffer((prevBuffer) => [
          ...prevBuffer.slice(len),
          ...buffer.samples
        ]);

        // Calculate signal RMS
        addRMS(DSPModule.rms(buffer.samples));
        setBufferId((prevId) => prevId + 1);
      }
    );
    return () => {
      subscriber.remove();
      MicrophoneStreamModule.stopRecording();
    };
  }, [micAccess, addRMS]);

  // Test audio buffers
  useEffect(() => {
    if (!TEST_MODE) return;

    const sampleRate = 44100;
    const bufSize = sampleRate / BUF_PER_SEC;
    const buffer = getTestSignal(bufferId, sampleRate, bufSize);
    setSampleRate(sampleRate);
    setAudioBuffer(buffer);

    // Trigger for next buffer
    const timeout = setTimeout(() => {
      setBufferId((id) => id + 1);
    }, 1000 / BUF_PER_SEC);
    return () => clearTimeout(timeout);
  }, [bufferId, addRMS]);

  // Get pitch of the audio
  useEffect(() => {
    if (!audioBuffer.length || micAccess !== "granted") return;

    // Process each bufferId only once
    if (bufferId === idQ[idQ.length - 1]) return;
    addId(bufferId);

    // Set sampleRate after first audio buffer
    let sr = sampleRate;
    if (!sr) {
      // Assume microphone already configured ()
      sr = MicrophoneStreamModule.getSampleRate();
      console.info(`Setting sample rate to ${sr}Hz`);
      setSampleRate(sr);
    }

    // Set parameters for pitch estimation
    let minFreq = MIN_FREQ;
    let maxFreq = MAX_FREQ;
    let threshold = THRESHOLD_DEFAULT;

    // Previous RMS and pitch values
    const rms_1 = rmsQ[rmsQ.length - 1];
    const rms_2 = rmsQ[rmsQ.length - 2];
    const pitch_1 = pitchQ[pitchQ.length - 1];
    const pitch_2 = pitchQ[pitchQ.length - 2];

    // Check conditions to restrict pitch search range
    let restrictRange = ENABLE_FILTER;
    restrictRange &&= pitch_1 > 0; // Previous pitch detected
    restrictRange &&= rms_1 < rms_2 * RMS_GAP; // Decreasing RMS
    restrictRange &&= getRelativeDiff(pitch_1, pitch_2) <= MAX_PITCH_DEV; // Stable pitch
    if (restrictRange) {
      minFreq = pitch_1 * (1 - MAX_PITCH_DEV);
      maxFreq = pitch_1 * (1 + MAX_PITCH_DEV);
      threshold = THRESHOLD_NOISY;
    }

    // Estimate pitch
    const pitch = DSPModule.pitch(audioBuffer, sr, minFreq, maxFreq, threshold);
    // console.info(`Pitch: ${pitch.toFixed(1)}Hz  [${minFreq.toFixed(1)}Hz-${maxFreq.toFixed(1)}Hz]`)
    setPitch(pitch);

    // Add values to history
    addPitch(pitch);
  }, [
    audioBuffer,
    sampleRate,
    micAccess,
    addId,
    addPitch,
    rmsQ,
    pitchQ,
    idQ,
    bufferId
  ]);

  // Selected instrument
  const instrument: Instrument = useMemo(() => {
    switch (config.instrument) {
      case "guitar":
        return new Guitar(config.tuning);
      case "chromatic":
        return new Chromatic(config.tuning);
    }
  }, [config.instrument, config.tuning]);

  // Disable manual mode if instrument doesn't support strings
  useEffect(() => {
    if (!instrument.hasStrings) {
      setManual(false);
    }
  }, [instrument, setManual]);

  // Add latest string to history
  useEffect(() => {
    if (config.manual) return;
    const string = instrument.getNearestString(pitch);
    addString(string);
  }, [pitch, instrument, addString, config.manual]);

  // Change currentString (requires 3 votes)
  useEffect(() => {
    if (config.manual) return;

    const len = stringHistory.length;
    const string1 = stringHistory[len - 1];
    const string2 = stringHistory[len - 2];
    const string3 = stringHistory[len - 3];
    // Never sets currentString to undefined
    if (
      sameNote(string1?.note, string2?.note) &&
      sameNote(string1?.note, string3?.note)
    ) {
      setCurrentString(string1);
    }
  }, [stringHistory, setCurrentString, config.manual]);

  // Tuning gauge indicator
  const gaugeDeviation = useMemo(
    () =>
      pitch > 0 && currentString
        ? Math.atan((10 * (pitch - currentString.freq)) / currentString.freq) /
          (Math.PI / 2)
        : undefined,
    [pitch, currentString]
  );
  const gaugeWidth = 10;

  // Component sizes and positions
  const waveformY = 60;
  const waveformH = height / 8;
  const movingGridY = height * 0.55;
  const movingGridH = height - movingGridY;
  const stringsH =
    height - waveformY - waveformH - movingGridH - gaugeWidth / 2;

  // Config button
  const cfgBtnSize = 1.5;
  const cfgBtnMargin = 50;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Мой быстрый компонент</Text>
      <Button title="Нажми меня" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f2f2f2"
  },
  title: {
    fontSize: 24,
    marginBottom: 20
  }
});

export default Tuner;
