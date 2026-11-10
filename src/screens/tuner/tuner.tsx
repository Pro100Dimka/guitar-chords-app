// src/tuner/Tuner.tsx
import React, { FC, useEffect, useMemo, useRef, useState } from "react";
import MicrophoneStream, { AudioBufferEvent } from "./MicrophoneStream";
import { Canvas, Group } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import Strings, {
  NOTE_BOX_WIDTH,
  BRIDGE_Y_RATIO,
  NECK_EXTENSION_RATIO
} from "./strings";
import NoteIndicator from "./note-indicator";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-worklets";
import { INote, IString } from "@/@interfaces";
import {
  Dimensions,
  View,
  StyleSheet,
  ImageBackground,
  Text
} from "react-native";
import defConfig from "./config";
import TunerButtons from "./buttons";
import { usePreferences } from "@/components/preferences";
import { useTranslation } from "react-i18next";
import palette from "@/theme/palette";
import { Action, Sheet } from "../song/tools";
import ChromaticWheel from "./chormatic-wheel";

const Tuner: FC = () => {
  const { t } = useTranslation();
  const tuning = usePreferences((state) => state.tuning);
  const [chooseTuning, setChooseTuning] = useState(false);
  const [hint, setHint] = useState("PlayOneString");
  const [detected, setDetected] = useState("");
  const stable = useRef(0);
  const lastNote = useRef("");
  const [selectedString, setSelectedString] = useState(
    () => usePreferences.getState().stringIndex
  );
  const { width, height } = Dimensions.get("window");
  const [layout, setLayout] = useState({ width, height });
  const neckHeight = layout.height * NECK_EXTENSION_RATIO;
  const bodyHeight = layout.height - neckHeight;
  const rms = useSharedValue(0);
  const note = useSharedValue<INote | null>(null);
  const [stringNotes, setStringNotes] = useState<IString[] | null>(null);
  const [config, setConfig] = useState(() => ({
    ...defConfig,
    selectedInstrument: usePreferences.getState().instrument,
    autoDetect: usePreferences.getState().autoDetect
  }));
  useEffect(() => {
    usePreferences.getState().update({
      instrument: config.selectedInstrument,
      autoDetect: config.autoDetect,
      stringIndex: selectedString
    });
  }, [config.selectedInstrument, config.autoDetect, selectedString]);
  useEffect(() => {
    MicrophoneStream.setKeepAwake(true, "tuner");
    return () => MicrophoneStream.setKeepAwake(false, "tuner");
  }, []);
  const strings = useMemo(() => {
    const source = config.instruments[config.selectedInstrument].stringNotes;
    if (config.selectedInstrument !== "guitar" || !source) return source;
    const presets: Record<string, { name: string; octave: number }[]> = {
      dropD: [{ name: "D", octave: 2 }, ...source.slice(1)],
      halfStep: [
        { name: "D#", octave: 2 },
        { name: "G#", octave: 2 },
        { name: "C#", octave: 3 },
        { name: "F#", octave: 3 },
        { name: "A#", octave: 3 },
        { name: "D#", octave: 4 }
      ]
    };
    return source.map((string, index) => ({
      ...string,
      ...(presets[tuning]?.[index] ?? {})
    }));
  }, [config.selectedInstrument, config.instruments, tuning]);
  useEffect(() => {
    setStringNotes(
      config.autoDetect || !strings?.length
        ? strings
        : [strings[selectedString] ?? strings[0]]
    );
    stable.current = 0;
    lastNote.current = "";
    setHint("PlayOneString");
    setDetected("");
  }, [strings, config.autoDetect, selectedString]);
  useEffect(() => {
    if (!stringNotes) return;
    MicrophoneStream.setTargetNotes(stringNotes);
    const id = MicrophoneStream.addListener((buffer: AudioBufferEvent) => {
      rms.value = buffer.rms;
      const cents =
        buffer.pitch > 0 && buffer.refFreq > 0
          ? 1200 * Math.log2(buffer.pitch / buffer.refFreq)
          : NaN;
      const key = `${buffer.note}${buffer.octave}`;
      stable.current =
        Number.isFinite(cents) && Math.abs(cents) <= 5
          ? lastNote.current === key
            ? stable.current + 1
            : 1
          : 0;
      lastNote.current = key;
      setDetected(Number.isFinite(cents) ? key : "");
      const hints: [boolean, string][] = [
        [!Number.isFinite(cents), "PlayOneString"],
        [Math.abs(cents) > 150, "CheckString"],
        [stable.current >= 4, "TunerInTune"],
        [Math.abs(cents) <= 5, "HoldNote"],
        [cents < 0, "TightenString"]
      ];
      setHint(hints.find(([matches]) => matches)?.[1] ?? "LoosenString");
      note.value = {
        name: buffer.note,
        refFreq: buffer.refFreq,
        direction: buffer.direction,
        octave: buffer.octave,
        pitch: buffer.pitch
      };
    });
    MicrophoneStream.startRecording();
    return () => {
      MicrophoneStream.removeListener(id);
      MicrophoneStream.stopRecording();
    };
  }, [stringNotes, note, rms]);
  const selectString = (index: number) => {
    setSelectedString(index);
    setConfig((previous) => ({ ...previous, autoDetect: false }));
  };
  const tapGesture = Gesture.Tap().onStart((e) => {
    if (!strings) return;
    const { x, y } = e;
    const bottom = neckHeight + bodyHeight * BRIDGE_Y_RATIO;
    const spacing = layout.width / (strings.length + 1);
    strings.forEach((_, i) => {
      const stringX = spacing * (i + 1);
      const halfBox = Math.min(NOTE_BOX_WIDTH, spacing - 4) / 2;
      const hit = Math.abs(x - stringX) < halfBox && y >= 0 && y <= bottom;
      if (hit) runOnJS(selectString)(i);
    });
  });

  const currString = stringNotes?.length === 1 ? stringNotes[0] : null;

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
    >
      <ImageBackground
        source={require("../../../assets/images/screen-background/tuner-back-extended.png")}
        style={styles.flex}
        resizeMode="stretch"
      >
        <GestureDetector gesture={tapGesture}>
          <Canvas style={styles.flex}>
            <Group transform={[{ translateY: neckHeight }]}>
              {config.selectedInstrument === "guitar" ? (
                <>
                  <NoteIndicator
                    note={note}
                    currString={currString}
                    width={layout.width}
                    height={bodyHeight}
                  />
                  <Strings
                    width={layout.width}
                    height={bodyHeight}
                    neckHeight={neckHeight}
                    rms={rms}
                    note={note}
                    stringNotes={strings}
                    currString={currString}
                  />
                </>
              ) : (
                <ChromaticWheel
                  note={note}
                  width={layout.width}
                  height={bodyHeight}
                />
              )}
            </Group>
          </Canvas>
        </GestureDetector>
        <TunerButtons
          config={config}
          setConfig={setConfig}
          onOpenTuning={() => setChooseTuning(true)}
        />
        {chooseTuning && (
          <Sheet
            title={t("GuitarTuning")}
            onClose={() => setChooseTuning(false)}
          >
            <Text accessibilityLiveRegion="polite" style={styles.hint}>
              {detected ? `${detected} · ` : ""}
              {t(hint)}
            </Text>
            {["standard", "dropD", "halfStep"].map((key) => (
              <Action
                key={key}
                label={t(key)}
                selected={key === tuning}
                onPress={() => {
                  usePreferences.getState().update({ tuning: key });
                  setChooseTuning(false);
                }}
              />
            ))}
          </Sheet>
        )}
      </ImageBackground>
    </View>
  );
};
const styles = StyleSheet.create({
  hint: {
    textAlign: "center",
    color: palette.chromatic.ink,
    fontSize: 16,
    fontWeight: "600"
  },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: "center" }
});
export default Tuner;
