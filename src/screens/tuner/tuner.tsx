/* eslint-disable react-hooks/exhaustive-deps */
// src/tuner/Tuner.tsx
import React, { FC, useEffect, useMemo, useState } from "react";
import MicrophoneStream, { AudioBufferEvent } from "./MicrophoneStream";
import { Canvas } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import Strings, { NOTE_BOX_WIDTH, TRANSLATE_Y_STRINGS } from "./strings";
import NoteIndicator from "./note-indicator";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-worklets";
import { INote, IString } from "@/@interfaces";
import { Dimensions, View, StyleSheet } from "react-native";
import defConfig from "./config";
import TunerButtons from "./buttons";

const Tuner: FC = () => {
  const { width, height } = Dimensions.get("window");
  const rms = useSharedValue(0);
  const note = useSharedValue<INote | null>(null);
  const [stringNotes, setStringNotes] = useState<IString[] | null>(null);
  const [config, setConfig] = useState(defConfig);
  const strings = useMemo(
    () => config.instruments[config.selectedInstrument].stringNotes,
    [config.selectedInstrument, config.instruments]
  );
  useEffect(() => {
    if (config.autoDetect) setStringNotes(strings);
  }, [strings, config.autoDetect]);
  useEffect(() => {
    if (!stringNotes) return;
    let silenceCount = 0;
    MicrophoneStream.setTargetNotes(stringNotes);
    const id = MicrophoneStream.addListener((buffer: AudioBufferEvent) => {
      rms.value = buffer.rms;
      note.value = {
        name: buffer.note,
        refFreq: buffer.refFreq,
        direction: buffer.direction,
        octave: buffer.octave,
        pitch: buffer.pitch
      };
      console.log(buffer.note, buffer.pitch);

      if (buffer.note === "Silence" || buffer.rms < 0.002) {
        silenceCount++;
      } else {
        silenceCount = 0;
      }
      if (silenceCount > 40) {
        console.warn("Тишина, перезапуск...");
        MicrophoneStream.stopRecording();
        MicrophoneStream.startRecording();
        silenceCount = 0;
      }
    });
    MicrophoneStream.startRecording();
    return () => {
      MicrophoneStream.removeListener(id);
      MicrophoneStream.stopRecording();
    };
  }, [stringNotes]);
  const selectString = (n: IString) => setStringNotes([n]);
  const tapGesture = Gesture.Tap().onStart((e) => {
    if (!strings) return;
    const { x, y } = e;
    const bottom = height / 3;
    const spacing = width / (strings.length + 1);
    strings.forEach((n, i) => {
      const stringX = spacing * (i + 1);
      const halfBox = NOTE_BOX_WIDTH / 2;
      const hit =
        Math.abs(x - stringX) < halfBox &&
        y >= TRANSLATE_Y_STRINGS &&
        y <= bottom;
      if (hit) runOnJS(selectString)(n);
    });
  });

  const currString = stringNotes?.length === 1 ? stringNotes[0] : null;

  return (
    <View style={styles.container}>
      <TunerButtons config={config} setConfig={setConfig} />
      <GestureDetector gesture={tapGesture}>
        <Canvas style={styles.flex}>
          <NoteIndicator note={note} currString={currString} />
          <Strings
            rms={rms}
            note={note}
            stringNotes={strings}
            currString={currString}
          />
        </Canvas>
      </GestureDetector>
    </View>
  );
};
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: "center" }
});
export default Tuner;
