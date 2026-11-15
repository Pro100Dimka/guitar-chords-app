// src/tuner/Tuner.tsx
import React, {
  FC,
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import MicrophoneStream, { AudioBufferEvent } from "./MicrophoneStream";
import { Canvas, CanvasRef } from "@shopify/react-native-skia";
import { useSharedValue, withTiming } from "react-native-reanimated";
import Strings from "./strings";
import { guitarLayout } from "./guitar-layout";
import NoteIndicator from "./note-indicator";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-worklets";
import { INote, IString, ITunerConfig } from "@/@interfaces";
import {
  Dimensions,
  View,
  StyleSheet,
  ImageBackground,
  Pressable,
  TextInput
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { calibratedNote, signalLevels } from "./chromatic-signal";
import Text from "../../components/styled-text";
import defConfig from "./config";
import TunerButtons from "./buttons";
import { usePreferences } from "@/components/preferences";
import { performanceAudio } from "../../components/performance-audio";
import TuningSheet from "./tuning-sheet";
import { guitarTunings, noteNames, standardTuning } from "./tunings";
import { playGuitar, prepareGuitar } from "../../components/guitar-audio";
import ChromaticWheel, { chromaticLayout } from "./chormatic-wheel";
import { Action, Sheet } from "../song/tools";
import { useTranslation } from "react-i18next";
import palette from "../../theme/palette";
import { TunerReadyContext } from "../../components/startup";

const Tuner: FC<{ active: boolean }> = ({ active }) => {
  const { t } = useTranslation();
  const reportReady = useContext(TunerReadyContext);
  const canvas = useRef<CanvasRef>(null);
  const [loadedBackground, setLoadedBackground] = useState("");
  const [layoutReady, setLayoutReady] = useState(false);
  const [stringsReady, setStringsReady] = useState(false);
  const [dialReady, setDialReady] = useState(false);
  const [chromaticReady, setChromaticReady] = useState(false);
  const [controlsReady, setControlsReady] = useState(false);
  const [painted, setPainted] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const markStringsReady = useCallback(() => setStringsReady(true), []);
  const markDialReady = useCallback(() => setDialReady(true), []);
  const markChromaticReady = useCallback(() => setChromaticReady(true), []);
  const markControlsReady = useCallback(() => setControlsReady(true), []);
  const chromaticOctave = usePreferences((state) => state.chromaticOctave);
  const tunerReference = usePreferences((state) => state.tunerReference);
  const tunerSpectrum = usePreferences((state) => state.tunerSpectrum);
  const referenceRef = useRef(tunerReference);
  referenceRef.current = tunerReference;
  const spectrumRef = useRef(tunerSpectrum);
  spectrumRef.current = tunerSpectrum;
  const signal = useSharedValue<number[]>([]);
  const [chooseCalibration, setChooseCalibration] = useState(false);
  const [referenceInput, setReferenceInput] = useState(String(tunerReference));
  const [referenceNote, setReferenceNote] = useState("A");
  const [referencePlaying, setReferencePlaying] = useState(false);
  const referenceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
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
  const cueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedString = usePreferences((state) => state.stringIndex);
  const instrument = usePreferences((state) => state.instrument);
  const autoDetect = usePreferences((state) => state.autoDetect);
  const { width, height } = Dimensions.get("window");
  const [layout, setLayout] = useState({ width, height });
  const rms = useSharedValue(0);
  const note = useSharedValue<INote | null>(null);
  const [stringNotes, setStringNotes] = useState<IString[] | null>(null);
  const config = {
    ...defConfig,
    selectedInstrument: instrument,
    autoDetect
  };
  const setConfig: Dispatch<SetStateAction<ITunerConfig>> = (update) => {
    const next = typeof update === "function" ? update(config) : update;
    usePreferences.getState().update({
      instrument: next.selectedInstrument,
      autoDetect: next.autoDetect
    });
  };
  const isChromatic = config.selectedInstrument === "chromatic";
  const landscape = layout.width > layout.height;
  const backgroundKey = landscape ? "guitar-landscape" : "guitar";
  const backgroundReady = isChromatic || loadedBackground === backgroundKey;
  const graphicsReady =
    controlsReady && (isChromatic ? chromaticReady : stringsReady && dialReady);
  useEffect(() => {
    if (
      !active ||
      painted ||
      renderError ||
      !backgroundReady ||
      !layoutReady ||
      !graphicsReady
    )
      return;
    let mounted = true;
    let frame = 0;
    let attempts = 0;
    const capture = async () => {
      try {
        if (!canvas.current) throw new Error("Tuner canvas unavailable");
        const image = await canvas.current.makeImageSnapshotAsync();
        let visible = false;
        try {
          const pixels = image.readPixels();
          if (pixels)
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] > 0) {
                visible = true;
                break;
              }
            }
        } finally {
          image.dispose();
        }
        if (!visible) throw new Error("Tuner frame is empty");
        if (mounted) setPainted(true);
      } catch {
        if (!mounted) return;
        if (++attempts < 3) frame = requestAnimationFrame(() => void capture());
        else setRenderError(true);
      }
    };
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void capture());
    });
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
    };
  }, [
    active,
    painted,
    renderError,
    backgroundReady,
    layoutReady,
    graphicsReady,
    renderAttempt
  ]);
  useEffect(() => {
    if (!painted) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => reportReady?.());
    });
    return () => cancelAnimationFrame(frame);
  }, [painted, reportReady]);
  const stageWidth = layout.width;
  const guitar = guitarLayout(stageWidth, layout.height);
  useEffect(() => {
    if (!active) return;
    MicrophoneStream.setKeepAwake(true, "tuner");
    return () => {
      MicrophoneStream.setKeepAwake(false, "tuner");
      performanceAudio.stopPlayback();
    };
  }, [active]);
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
    if (!active || !painted) return;
    if (isChromatic) {
      const timer = setTimeout(
        () =>
          prepareGuitar(
            [
              ((chromaticOctave ?? 4) + 1) * 12 +
                noteNames.indexOf(referenceNote)
            ],
            tunerReference
          ),
        80
      );
      return () => clearTimeout(timer);
    }
    let index = 0;
    const warm = () => {
      const string = strings?.[index++];
      if (!string) return;
      prepareGuitar([
        (string.octave + 1) * 12 + noteNames.indexOf(string.name)
      ]);
      timer = setTimeout(warm, 16);
    };
    let timer = setTimeout(warm, 80);
    return () => clearTimeout(timer);
  }, [
    strings,
    active,
    painted,
    isChromatic,
    referenceNote,
    chromaticOctave,
    tunerReference
  ]);
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
    if (!active) return;
    MicrophoneStream.setTargetNotes(stringNotes ?? []);
  }, [active, stringNotes]);
  useEffect(() => {
    if (!active) {
      note.value = null;
      rms.value = 0;
      return;
    }
    if (isChromatic) note.value = null;
    let lastBufferAt = Date.now();
    const id = MicrophoneStream.addListener((input: AudioBufferEvent) => {
      const calibrated = isChromatic
        ? calibratedNote(input.pitch, referenceRef.current)
        : null;
      const buffer = isChromatic
        ? {
            ...input,
            note: calibrated?.name ?? "Silence",
            octave: calibrated?.octave ?? 0,
            refFreq: calibrated?.refFreq ?? 0,
            direction: calibrated?.direction ?? ("=" as const)
          }
        : input;
      if (isChromatic)
        signal.value = signalLevels(
          input.samples ?? [],
          input.sampleRate ?? 44100,
          spectrumRef.current
        );
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
  }, [active, note, rms, fill, fillKey, signal, isChromatic, chromaticOctave]);
  const previewUntil = useRef(0);
  const selectString = (index: number) => {
    const string = strings?.[index];
    if (!string) return;
    previewUntil.current = Date.now() + 3100;
    if (cueTimer.current !== undefined) clearTimeout(cueTimer.current);
    playGuitar([(string.octave + 1) * 12 + noteNames.indexOf(string.name)]);
    usePreferences.getState().update({ stringIndex: index, autoDetect: false });
  };
  const tapGesture = Gesture.Tap().onBegin((e) => {
    if (!strings?.length || isChromatic) return;
    const { x, y } = e;
    const spacing = guitar.stringWidth / Math.max(1, strings.length - 1);
    const index = Math.round((x - guitar.stringLeft) / spacing);
    if (
      index >= 0 &&
      index < strings.length &&
      Math.abs(x - guitar.stringLeft - index * spacing) <= spacing / 2 &&
      y >= 0 &&
      y <= Math.min(layout.height, guitar.stringBottom + 10)
    )
      runOnJS(selectString)(index);
  });

  const currString = stringNotes?.length === 1 ? stringNotes[0] : null;
  const octaveLayout = chromaticLayout(stageWidth, layout.height);
  const selectOctave = (value: number | null) => {
    stopReference();
    note.value = null;
    usePreferences.getState().update({ chromaticOctave: value });
    setChooseOctave(false);
  };
  useEffect(() => {
    if (!active || !isChromatic) setReferencePlaying(false);
    return () => {
      if (referenceTimer.current !== undefined)
        clearTimeout(referenceTimer.current);
      performanceAudio.stopPlayback();
    };
  }, [active, isChromatic]);
  const stopReference = useCallback(() => {
    previewUntil.current = Math.min(previewUntil.current, Date.now() + 180);
    if (referenceTimer.current !== undefined)
      clearTimeout(referenceTimer.current);
    performanceAudio.stopPlayback();
    setReferencePlaying(false);
  }, []);
  useEffect(() => {
    stopReference();
  }, [chromaticOctave, stopReference]);
  const playReference = () => {
    if (referencePlaying) {
      stopReference();
      return;
    }
    const name = referenceNote;
    const octave = chromaticOctave ?? 4;
    previewUntil.current = Date.now() + 3300;
    note.value = null;
    playGuitar([(octave + 1) * 12 + noteNames.indexOf(name)], tunerReference);
    setReferencePlaying(true);
    referenceTimer.current = setTimeout(stopReference, 3100);
  };
  const applyReference = (value: number) => {
    if (!Number.isInteger(value) || value < 400 || value > 480) return;
    stopReference();
    note.value = null;
    fill.value = 0;
    tuningState.current.confirmed = "";
    usePreferences.getState().update({ tunerReference: value });
    setChooseCalibration(false);
  };

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent }) => {
        setLayout(nativeEvent.layout);
        setLayoutReady(
          nativeEvent.layout.width > 0 && nativeEvent.layout.height > 0
        );
      }}
    >
      <View
        pointerEvents={painted && backgroundReady ? "auto" : "none"}
        style={[
          styles.flex,
          { width: stageWidth },
          (!painted || !backgroundReady) && styles.hidden
        ]}
      >
        {isChromatic ? (
          <LinearGradient
            colors={palette.chromatic.wash}
            style={StyleSheet.absoluteFillObject}
          />
        ) : (
          <ImageBackground
            key={`${backgroundKey}:${renderAttempt}`}
            onLoad={() => setLoadedBackground(backgroundKey)}
            onError={() => setRenderError(true)}
            source={
              landscape
                ? require("../../../assets/images/screen-background/tuner-grand-auditorium-landscape.webp")
                : require("../../../assets/images/screen-background/tuner-grand-auditorium.webp")
            }
            style={[styles.artwork, guitar.artwork]}
            resizeMode="stretch"
          />
        )}
        <GestureDetector gesture={tapGesture}>
          <Canvas ref={canvas} style={styles.flex}>
            {config.selectedInstrument === "guitar" ? (
              <>
                <NoteIndicator
                  onReady={markDialReady}
                  note={note}
                  fill={fill}
                  rms={rms}
                  currString={currString}
                  width={stageWidth}
                  height={layout.height}
                  availableHeight={
                    landscape ? Math.max(40, layout.height - 130) : undefined
                  }
                />
                <Strings
                  onReady={markStringsReady}
                  width={stageWidth}
                  height={layout.height}
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
                onReady={markChromaticReady}
                note={note}
                fill={fill}
                rms={rms}
                signal={signal}
                width={stageWidth}
                height={layout.height}
              />
            )}
          </Canvas>
        </GestureDetector>
        {isChromatic && (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
            <View
              style={[
                styles.referenceOptions,
                {
                  top: octaveLayout.panelTop,
                  left: octaveLayout.panelLeft,
                  width: octaveLayout.panelWidth,
                  height: octaveLayout.panelHeight
                }
              ]}
            >
              {noteNames.map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityLabel={t("ReferenceNote", { note: name })}
                  accessibilityState={{ selected: referenceNote === name }}
                  onPress={() => {
                    stopReference();
                    setReferenceNote(name);
                  }}
                  style={[
                    styles.referenceNote,
                    {
                      width: `${100 / octaveLayout.columns}%`
                    },
                    referenceNote === name && styles.selectedReference
                  ]}
                />
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ChooseOctave")}
              onPress={() => setChooseOctave(true)}
              style={[
                styles.octaveButton,
                {
                  top: octaveLayout.octaveTop,
                  width: octaveLayout.octaveWidth,
                  left: octaveLayout.octaveLeft
                }
              ]}
            >
              <LinearGradient
                colors={[
                  palette.gold.rimLight,
                  palette.gold.rimShade,
                  palette.glass.control,
                  palette.gold.center
                ]}
                locations={[0, 0.12, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
              />
              <View pointerEvents="none" style={styles.octaveInset} />
              <Text style={styles.octaveLabel}>
                {t("OctaveButton", { value: chromaticOctave ?? t("Auto") })}
              </Text>
              <MaterialCommunityIcons
                name="chevron-down"
                size={18}
                color={palette.gold.top}
              />
            </Pressable>
          </View>
        )}
      </View>
      <View
        pointerEvents={painted && backgroundReady ? "box-none" : "none"}
        style={[
          styles.controls,
          (!painted || !backgroundReady) && styles.hidden,
          !isChromatic && layout.height < 420 && styles.sideControls
        ]}
      >
        <TunerButtons
          key={renderAttempt}
          config={config}
          setConfig={setConfig}
          tuning={tuning}
          onReady={markControlsReady}
          onError={() => setRenderError(true)}
          onOpenTuning={() => setChooseTuning(true)}
          compact={layout.height < 420}
          spectrum={tunerSpectrum}
          referencePlaying={referencePlaying}
          onVisualization={() =>
            usePreferences.getState().update({ tunerSpectrum: !tunerSpectrum })
          }
          onCalibration={() => {
            setReferenceInput(String(tunerReference));
            setChooseCalibration(true);
          }}
          onReference={playReference}
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
      {chooseCalibration && (
        <Sheet
          musical
          title={t("TunerCalibration")}
          onClose={() => setChooseCalibration(false)}
        >
          <Text style={styles.octaveHint}>{t("CalibrationHint")}</Text>
          <View style={styles.calibrationRow}>
            {[432, 440, 442].map((value) => (
              <Action
                key={value}
                label={`A4 · ${value} Hz`}
                selected={tunerReference === value}
                onPress={() => applyReference(value)}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel={t("ReferenceFrequency")}
            value={referenceInput}
            onChangeText={setReferenceInput}
            keyboardType="number-pad"
            maxLength={3}
            selectTextOnFocus
            style={styles.frequencyInput}
          />
          <Action
            primary
            label={t("ApplyCalibration")}
            disabled={
              !/^\d{3}$/.test(referenceInput) ||
              Number(referenceInput) < 400 ||
              Number(referenceInput) > 480
            }
            onPress={() => applyReference(Number(referenceInput))}
          />
        </Sheet>
      )}
      {chooseTuning && <TuningSheet onClose={() => setChooseTuning(false)} />}
      {renderError && (
        <View style={styles.renderError} onLayout={reportReady}>
          <Text style={styles.octaveHint}>{t("ErrorStartingApp")}</Text>
          <Action
            label={t("Retry")}
            onPress={() => {
              setLoadedBackground("");
              setRenderError(false);
              setRenderAttempt((value) => value + 1);
            }}
          />
        </View>
      )}
    </View>
  );
};
const styles = StyleSheet.create({
  referenceOptions: {
    position: "absolute",
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  referenceNote: {
    height: 32,
    borderRadius: 8,
    borderWidth: 0,
    borderColor: palette.gold.top
  },
  selectedReference: { borderWidth: 1 },
  calibrationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  frequencyInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 16,
    color: palette.gold.top,
    textAlign: "center",
    fontSize: 24,
    padding: 10
  },
  hidden: { opacity: 0 },
  renderError: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
    backgroundColor: palette.glass.control
  },
  octaveButton: {
    position: "absolute",
    minHeight: 44,
    borderRadius: 28,
    overflow: "hidden",
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.glass.control,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  octaveInset: {
    position: "absolute",
    top: 1,
    bottom: 1,
    left: 1,
    right: 1,
    borderRadius: 27,
    backgroundColor: palette.glass.control
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
