// src/tuner/Tuner.tsx
import React, { FC, useEffect, useMemo, useRef, useState } from "react";
import MicrophoneStream, { AudioBufferEvent } from "./MicrophoneStream";
import { Canvas, Group } from "@shopify/react-native-skia";
import { useSharedValue, withTiming } from "react-native-reanimated";
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
  Pressable
} from "react-native";
import Text from "../../components/styled-text";
import defConfig from "./config";
import TunerButtons from "./buttons";
import { usePreferences } from "@/components/preferences";
import { performanceAudio } from "../../components/performance-audio";
import TuningSheet from "./tuning-sheet";
import { guitarTunings, noteNames, standardTuning } from "./tunings";
import { playGuitar } from "../../components/guitar-audio";
import ChromaticWheel, { chromaticLayout } from "./chormatic-wheel";
import { Action, Sheet } from "../song/tools";
import { useTranslation } from "react-i18next";
import palette from "../../theme/palette";

const Tuner: FC = () => {
  const { t } = useTranslation();
  const chromaticOctave = usePreferences((state) => state.chromaticOctave);
  const [chooseOctave, setChooseOctave] = useState(false);
  const customTuning = usePreferences((state) => state.customTuning);
  const tuning = usePreferences((state) => state.tuning);
  const [chooseTuning, setChooseTuning] = useState(false);
  const fill = useSharedValue(0);
  const fillKey = useSharedValue("");
  const tuningState = useRef({
    key: "",
    since: 0,
    lastFrame: 0,
    confirmed: "",
    outsideSince: 0,
    ignoreUntil: 0
  });
  const previewTimer = useRef<{ timer?: ReturnType<typeof setTimeout> }>({});
  const cueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectedString, setSelectedString] = useState(
    () => usePreferences.getState().stringIndex
  );
  const { width, height } = Dimensions.get("window");
  const [layout, setLayout] = useState({ width, height });
  const rms = useSharedValue(0);
  const note = useSharedValue<INote | null>(null);
  const [stringNotes, setStringNotes] = useState<IString[] | null>(null);
  const [config, setConfig] = useState(() => ({
    ...defConfig,
    selectedInstrument: usePreferences.getState().instrument,
    autoDetect: usePreferences.getState().autoDetect
  }));
  const isChromatic = config.selectedInstrument === "chromatic";
  const stageWidth = isChromatic
    ? Math.min(layout.width, 520)
    : Math.min(layout.width, (layout.height * 1024) / 1536);
  const stageHeight = isChromatic ? layout.height : (stageWidth * 2216) / 1024;
  const imageTop = Math.min(0, layout.height - stageHeight);
  const neckHeight = isChromatic
    ? 0
    : stageHeight * NECK_EXTENSION_RATIO + imageTop;
  const bodyHeight = isChromatic
    ? layout.height
    : stageHeight * (1 - NECK_EXTENSION_RATIO);
  useEffect(() => {
    usePreferences.getState().update({
      instrument: config.selectedInstrument,
      autoDetect: config.autoDetect,
      stringIndex: selectedString
    });
  }, [config.selectedInstrument, config.autoDetect, selectedString]);
  useEffect(() => {
    const preview = previewTimer.current;
    MicrophoneStream.setKeepAwake(true, "tuner");
    return () => {
      MicrophoneStream.setKeepAwake(false, "tuner");
      if (preview.timer !== undefined) clearTimeout(preview.timer);
      performanceAudio.stopPlayback();
    };
  }, []);
  const strings = useMemo(() => {
    const source = config.instruments[config.selectedInstrument].stringNotes;
    if (config.selectedInstrument !== "guitar" || !source) return source;
    const selected =
      tuning === "custom"
        ? customTuning
        : (guitarTunings[tuning]?.notes ?? standardTuning);
    return source.map((string, index) => ({
      ...string,
      name: noteNames[selected[index] % 12],
      octave: Math.floor(selected[index] / 12) - 1
    }));
  }, [config.selectedInstrument, config.instruments, tuning, customTuning]);
  useEffect(() => {
    setStringNotes(
      config.autoDetect || !strings?.length
        ? strings
        : [strings[selectedString] ?? strings[0]]
    );
    tuningState.current = {
      key: "",
      since: 0,
      lastFrame: 0,
      confirmed: "",
      outsideSince: 0,
      ignoreUntil: 0
    };
    fill.value = 0;
    fillKey.value = "";
    if (cueTimer.current !== undefined) clearTimeout(cueTimer.current);
  }, [strings, config.autoDetect, selectedString, fill, fillKey]);
  useEffect(() => {
    if (!stringNotes) return;
    MicrophoneStream.setTargetNotes(stringNotes);
    if (isChromatic) note.value = null;
    let lastBufferAt = Date.now();
    const id = MicrophoneStream.addListener((buffer: AudioBufferEvent) => {
      lastBufferAt = Date.now();
      rms.value = buffer.rms;
      if (
        isChromatic &&
        chromaticOctave !== null &&
        buffer.octave !== chromaticOctave
      ) {
        note.value = null;
        return;
      }
      const cents =
        buffer.pitch > 0 && buffer.refFreq > 0
          ? 1200 * Math.log2(buffer.pitch / buffer.refFreq)
          : NaN;
      const key = `${buffer.note}${buffer.octave}`;
      const now = Date.now();
      const state = tuningState.current;
      if (now < Math.max(state.ignoreUntil, previewUntil.current)) return;
      const valid = Number.isFinite(cents) && buffer.rms > 0.003;
      if (valid && state.key !== key) {
        state.key = key;
        state.since = 0;
        state.confirmed = "";
        state.outsideSince = 0;
        fillKey.value = key;
        fill.value = 0;
      }
      if (valid && Math.abs(cents) <= 5) {
        if (!state.since || now - state.lastFrame > 220) state.since = now;
        state.outsideSince = 0;
        const progress =
          state.confirmed === key ? 1 : Math.min(1, (now - state.since) / 1100);
        fill.value = withTiming(progress, { duration: 90 });
        if (progress === 1 && state.confirmed !== key) {
          state.confirmed = key;
          if (
            usePreferences.getState().instrument === "guitar" &&
            usePreferences.getState().tunerSound
          ) {
            state.ignoreUntil = now + 950;
            cueTimer.current = setTimeout(
              () => performanceAudio.success(),
              110
            );
          }
        }
      } else {
        state.since = 0;
        if (valid && Math.abs(cents) > 12) {
          if (!state.outsideSince) state.outsideSince = now;
          if (now - state.outsideSince >= 450) state.confirmed = "";
        }
        if (!state.confirmed) fill.value = withTiming(0, { duration: 180 });
      }
      state.lastFrame = now;
      note.value = {
        name: buffer.note,
        refFreq: buffer.refFreq,
        direction: buffer.direction,
        octave: buffer.octave,
        pitch: buffer.pitch
      };
    });
    MicrophoneStream.startRecording();
    const recoveryTimer = setInterval(() => {
      if (Date.now() - lastBufferAt < 3000) return;
      lastBufferAt = Date.now();
      note.value = null;
      rms.value = 0;
      MicrophoneStream.stopRecording();
      MicrophoneStream.startRecording();
    }, 1500);
    return () => {
      clearInterval(recoveryTimer);
      if (cueTimer.current !== undefined) clearTimeout(cueTimer.current);
      performanceAudio.stopPlayback();
      MicrophoneStream.removeListener(id);
      MicrophoneStream.stopRecording();
    };
  }, [stringNotes, note, rms, fill, fillKey, isChromatic, chromaticOctave]);
  const previewUntil = useRef(0);
  const selectString = (index: number) => {
    const string = strings?.[index];
    if (!string) return;
    previewUntil.current = Date.now() + 3100;
    if (cueTimer.current !== undefined) clearTimeout(cueTimer.current);
    if (previewTimer.current.timer !== undefined)
      clearTimeout(previewTimer.current.timer);
    previewTimer.current.timer = setTimeout(
      () =>
        playGuitar([(string.octave + 1) * 12 + noteNames.indexOf(string.name)]),
      160
    );
    setSelectedString(index);
    setConfig((previous) => ({ ...previous, autoDetect: false }));
  };
  const tapGesture = Gesture.Tap().onStart((e) => {
    if (!strings) return;
    const { x, y } = e;
    const bottom = neckHeight + bodyHeight * BRIDGE_Y_RATIO;
    const spacing = stageWidth / (strings.length + 1);
    strings.forEach((_, i) => {
      const stringX = spacing * (i + 1);
      const halfBox = Math.min(NOTE_BOX_WIDTH, spacing - 4) / 2;
      const hit = Math.abs(x - stringX) < halfBox && y >= 0 && y <= bottom;
      if (hit) runOnJS(selectString)(i);
    });
  });

  const currString = stringNotes?.length === 1 ? stringNotes[0] : null;
  const octaveLayout = chromaticLayout(stageWidth, bodyHeight);
  const selectOctave = (value: number | null) => {
    note.value = null;
    usePreferences.getState().update({ chromaticOctave: value });
    setChooseOctave(false);
  };

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
    >
      <View style={[styles.flex, { width: stageWidth }]}>
        <ImageBackground
          source={require("../../../assets/images/screen-background/tuner-back-extended.png")}
          style={[
            styles.artwork,
            isChromatic
              ? octaveLayout.artwork
              : { width: stageWidth, height: stageHeight, top: imageTop }
          ]}
          resizeMode="stretch"
        />
        <GestureDetector gesture={tapGesture}>
          <Canvas style={styles.flex}>
            <Group transform={[{ translateY: neckHeight }]}>
              {config.selectedInstrument === "guitar" ? (
                <>
                  <NoteIndicator
                    note={note}
                    fill={fill}
                    currString={currString}
                    width={stageWidth}
                    height={bodyHeight}
                  />
                  <Strings
                    width={stageWidth}
                    height={bodyHeight}
                    neckHeight={neckHeight}
                    rms={rms}
                    fill={fill}
                    fillKey={fillKey}
                    note={note}
                    stringNotes={strings}
                    currString={currString}
                  />
                </>
              ) : (
                <ChromaticWheel
                  note={note}
                  width={stageWidth}
                  height={bodyHeight}
                />
              )}
            </Group>
          </Canvas>
        </GestureDetector>
        {isChromatic && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ChooseOctave")}
            onPress={() => setChooseOctave(true)}
            style={[
              styles.octaveButton,
              {
                top: octaveLayout.octaveTop,
                width: octaveLayout.octaveWidth,
                left: (stageWidth - octaveLayout.octaveWidth) / 2
              }
            ]}
          >
            <Text style={styles.octaveLabel}>
              {t("OctaveButton", { value: chromaticOctave ?? t("Auto") })} ▾
            </Text>
          </Pressable>
        )}
      </View>
      <View
        pointerEvents="box-none"
        style={[
          styles.controls,
          !isChromatic && layout.height < 420 && styles.sideControls
        ]}
      >
        <TunerButtons
          config={config}
          setConfig={setConfig}
          onOpenTuning={() => setChooseTuning(true)}
          compact={layout.height < 420}
        />
      </View>
      {chooseOctave && (
        <Sheet
          musical
          title={t("ChooseOctave")}
          onClose={() => setChooseOctave(false)}
        >
          <Text style={styles.octaveHint}>{t("OctaveHint")}</Text>
          <Action
            label={t("OctaveAutoReset")}
            selected={chromaticOctave === null}
            onPress={() => selectOctave(null)}
          />
          <View style={styles.octaveChoices}>
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <View key={value} style={styles.octaveChoice}>
                <Action
                  label={`${t("OctaveButton", { value })}\n${value === 1 ? "E" : "C"}${value} - B${value}`}
                  selected={chromaticOctave === value}
                  onPress={() => selectOctave(value)}
                />
              </View>
            ))}
          </View>
        </Sheet>
      )}
      {chooseTuning && <TuningSheet onClose={() => setChooseTuning(false)} />}
    </View>
  );
};
const styles = StyleSheet.create({
  octaveButton: {
    position: "absolute",
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.glass.control,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  octaveLabel: { color: palette.gold.top, fontSize: 15, fontWeight: "600" },
  octaveHint: { color: palette.glass.muted, fontSize: 16, lineHeight: 24 },
  octaveChoices: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  octaveChoice: { width: "47%" },
  flex: { flex: 1 },
  artwork: { position: "absolute" },
  controls: { ...StyleSheet.absoluteFillObject },
  sideControls: { left: undefined, right: 12, top: 12, width: 180 },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden"
  }
});
export default Tuner;
