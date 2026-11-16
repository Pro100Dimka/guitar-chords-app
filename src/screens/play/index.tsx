import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { Canvas } from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import { Action, Sheet } from "../song/tools";
import Strings from "../tuner/strings";
import guitar from "../tuner/config/guitar-classic";
import { guitarLayout } from "../tuner/guitar-layout";
import { noteNames } from "../tuner/tunings";
import { guitarMidi } from "../song/chords";
import {
  recordedChordFrets,
  selectedChordShape
} from "../../components/acoustic-player";
import { prepareGuitar, warmGuitar } from "../../components/guitar-audio";
import { performanceAudio } from "../../components/performance-audio";
import type { INote } from "../../@interfaces";
import palette from "../../theme/palette";

export default function PlayGuitar() {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active"
  );
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [progression, setProgression] = useState(["Am", "C", "G", "Em"]);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(80);
  const [tempoInput, setTempoInput] = useState("80");
  const [beats, setBeats] = useState(4);
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  const [free, setFree] = useState(false);
  const [fretsSheet, setFretsSheet] = useState(false);
  const [freeFrets, setFreeFrets] = useState([0, 0, 0, 0, 0, 0]);
  const plucks = useSharedValue<number[]>([]);
  const rms = useSharedValue(0);
  const fill = useSharedValue(0);
  const fillKey = useSharedValue("");
  const note = useSharedValue<INote | null>(null);
  const touches = useSharedValue<Record<number, { x: number; first: number }>>(
    {}
  );
  const position = useRef(selected);
  position.current = selected;
  const chord = progression[selected] ?? "";
  const frets = free
    ? freeFrets
    : (selectedChordShape(chord)?.frets ?? freeFrets);
  const pitches = frets.map((fret, index) =>
    fret === null ? null : guitarMidi[index] + fret
  );
  const pitchKey = pitches.join(",");
  const currentPitches = useRef(pitches);
  const previousPitches = useRef(pitches);
  const prepared = useRef(new Set<string>());
  currentPitches.current = pitches;
  const frame = guitarLayout(layout.width, layout.height);
  const landscape = layout.width > layout.height;
  const active = focused && foreground;

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    );
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!active) {
      prepared.current.clear();
      setPlaying(false);
      plucks.value = [];
      performanceAudio.stopPlayback();
    }
    return () => {
      performanceAudio.stopPlayback();
    };
  }, [active, plucks]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    prepared.current.clear();
    const notes = currentPitches.current;
    notes.forEach((midi, index) => {
      if (previousPitches.current[index] !== midi)
        performanceAudio.stopGuitarString(index);
    });
    previousPitches.current = notes;
    void (async () => {
      for (let index = 0; index < notes.length; index++) {
        if (controller.signal.aborted) break;
        const midi = notes[index];
        if (midi !== null) {
          await warmGuitar([midi], 440, controller.signal, index);
          if (!controller.signal.aborted)
            prepared.current.add(`440:${midi}:string${index}`);
        }
      }
    })();
    return () => controller.abort();
  }, [active, pitchKey]);
  useEffect(() => {
    if (!active || !playing || progression.length < 2 || free) return;
    const duration = (60000 / tempo) * beats;
    const start = Date.now();
    const initial = position.current;
    let step = 0;
    const timer = setInterval(() => {
      const next = Math.floor((Date.now() - start) / duration);
      if (next !== step) {
        step = next;
        setSelected((initial + next) % progression.length);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [active, playing, progression, tempo, beats, free]);

  const playStrings = useCallback(
    (indices: number[]) => {
      if (!active) return;
      indices.forEach((index) => {
        const midi = currentPitches.current[index];
        if (midi === null || midi === undefined) return;
        const key = `440:${midi}:string${index}`;
        if (!prepared.current.has(key)) {
          prepareGuitar([midi], 440, index);
          prepared.current.add(key);
        }
        performanceAudio.guitarString(key, index);
      });
    },
    [active]
  );
  const gesture = Gesture.Manual()
    .onTouchesDown((event, manager) => {
      if (!Object.keys(touches.value).length) {
        manager.begin();
        manager.activate();
      }
      const tracked = { ...touches.value };
      const hit: number[] = [];
      const spacing = frame.stringWidth / 5;
      for (const touch of event.changedTouches) {
        const index = Math.round((touch.x - frame.stringLeft) / spacing);
        tracked[touch.id] = { x: touch.x, first: index };
        if (
          active &&
          touch.y >= 65 &&
          touch.y <= frame.stringBottom &&
          index >= 0 &&
          index < 6 &&
          frets[index] !== null
        )
          hit.push(index);
      }
      touches.value = tracked;
      if (hit.length) {
        const counts = [...plucks.value];
        hit.forEach((index) => {
          counts[index] = (counts[index] ?? 0) + 1;
        });
        plucks.value = counts;
        runOnJS(playStrings)(hit);
      }
    })
    .onTouchesMove((event) => {
      const tracked = { ...touches.value };
      const hit: number[] = [];
      const spacing = frame.stringWidth / 5;
      for (const touch of event.changedTouches) {
        const previous = tracked[touch.id];
        if (!previous) continue;
        const crossed: number[] = [];
        if (active && touch.y >= 65 && touch.y <= frame.stringBottom) {
          for (let index = 0; index < 6; index++) {
            const x = frame.stringLeft + spacing * index;
            if (
              index !== previous.first &&
              frets[index] !== null &&
              (touch.x > previous.x
                ? x > previous.x && x <= touch.x
                : x < previous.x && x >= touch.x)
            )
              crossed.push(index);
          }
        }
        if (touch.x < previous.x) crossed.reverse();
        hit.push(...crossed);
        tracked[touch.id] = {
          x: touch.x,
          first:
            Math.abs(touch.x - frame.stringLeft - previous.first * spacing) >
            spacing / 2
              ? -1
              : previous.first
        };
      }
      touches.value = tracked;
      if (hit.length) {
        const counts = [...plucks.value];
        hit.forEach((index) => {
          counts[index] = (counts[index] ?? 0) + 1;
        });
        plucks.value = counts;
        runOnJS(playStrings)(hit);
      }
    })
    .onTouchesUp((event, manager) => {
      const tracked = { ...touches.value };
      event.changedTouches.forEach((touch) => {
        delete tracked[touch.id];
      });
      touches.value = tracked;
      if (!Object.keys(tracked).length) manager.end();
    })
    .onTouchesCancelled((_event, manager) => manager.end())
    .onFinalize(() => {
      touches.value = {};
    });
  const strings = guitar.stringNotes!.map((string, index) => {
    const midi = pitches[index];
    return {
      ...string,
      name: midi === null ? "×" : noteNames[midi % 12],
      octave: midi === null ? 0 : Math.floor(midi / 12) - 1
    };
  });

  return (
    <View
      style={styles.root}
      onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
    >
      {layout.width > 0 && (
        <>
          <Image
            source={
              landscape
                ? require("../../../assets/images/screen-background/tuner-grand-auditorium-landscape.webp")
                : require("../../../assets/images/screen-background/tuner-grand-auditorium.webp")
            }
            style={[styles.artwork, frame.artwork]}
            resizeMode="stretch"
          />
          <View pointerEvents="none" style={[styles.chord, frame.hole]}>
            <Text style={[styles.chordName, free && styles.freeName]}>
              {free ? t("FreePlay") : chord}
            </Text>
          </View>
          <GestureDetector gesture={gesture}>
            <Canvas style={StyleSheet.absoluteFill} accessible={false}>
              <Strings
                rms={rms}
                plucks={plucks}
                note={note}
                fill={fill}
                fillKey={fillKey}
                stringNotes={strings}
                currString={null}
                width={layout.width}
                height={layout.height}
              />
            </Canvas>
          </GestureDetector>
        </>
      )}
      <View style={[styles.panel, landscape && styles.landscapePanel]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chords}
        >
          {progression.map((name, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected: !free && selected === index }}
              onPress={() => {
                setSelected(index);
                setFree(false);
                setPlaying(false);
              }}
              onLongPress={() => setEdit(index)}
              style={[
                styles.chip,
                !free && selected === index && styles.selected
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  !free && selected === index && { color: palette.gold.ink }
                ]}
              >
                {name}
              </Text>
            </Pressable>
          ))}
          <Action
            icon="plus"
            label={t("AddChord")}
            onPress={() => setPicker(true)}
            disabled={progression.length >= 16}
          />
        </ScrollView>
        <View style={styles.controls}>
          <Action
            icon={playing ? "pause" : "play"}
            label={t(playing ? "Pause" : "AutoChords")}
            disabled={progression.length < 2 || free}
            onPress={() => setPlaying(!playing)}
          />
          <Action
            glass
            label={`${tempo} BPM · ${beats}`}
            onPress={() => {
              setTempoInput(String(tempo));
              setSettings(true);
            }}
          />
          <Action
            icon="music-note"
            label={t("FreePlay")}
            onPress={() => {
              setPlaying(false);
              setFree(true);
              setFretsSheet(true);
            }}
          />
        </View>
      </View>
      {picker && (
        <Sheet title={t("AddChord")} onClose={() => setPicker(false)}>
          <View style={styles.grid}>
            {Object.keys(recordedChordFrets).map((name) => (
              <Action
                key={name}
                glass
                label={name}
                onPress={() => {
                  setProgression((list) => [...list, name]);
                  setSelected(progression.length);
                  setFree(false);
                  setPlaying(false);
                  setPicker(false);
                }}
              />
            ))}
          </View>
        </Sheet>
      )}
      {edit !== null && (
        <Sheet title={progression[edit]} onClose={() => setEdit(null)}>
          <Action
            label={t("Delete")}
            onPress={() => {
              const remaining = progression.filter(
                (_, index) => index !== edit
              );
              setProgression(remaining);
              setSelected(
                Math.min(selected, Math.max(0, remaining.length - 1))
              );
              setPlaying(false);
              setFree(remaining.length === 0);
              setEdit(null);
            }}
          />
        </Sheet>
      )}
      {settings && (
        <Sheet title={t("AutoChords")} onClose={() => setSettings(false)}>
          <Text style={styles.label}>{t("Tempo")}</Text>
          <TextInput
            accessibilityLabel={t("Tempo")}
            style={styles.tempoInput}
            keyboardType="number-pad"
            selectTextOnFocus
            maxLength={3}
            value={tempoInput}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "");
              setTempoInput(digits);
              const bpm = Number(digits);
              if (bpm >= 40 && bpm <= 200) setTempo(bpm);
            }}
            onEndEditing={() => setTempoInput(String(tempo))}
          />
          <View style={styles.controls}>
            <Action
              glass
              label="−"
              disabled={tempo <= 40}
              onPress={() => {
                const value = Math.max(40, tempo - 5);
                setTempo(value);
                setTempoInput(String(value));
              }}
            />
            <Text style={styles.label}>{tempo} BPM</Text>
            <Action
              glass
              label="+"
              disabled={tempo >= 200}
              onPress={() => {
                const value = Math.min(200, tempo + 5);
                setTempo(value);
                setTempoInput(String(value));
              }}
            />
          </View>
          <Text style={styles.label}>{t("BeatsPerChord")}</Text>
          <View style={styles.controls}>
            {[1, 2, 4, 8].map((value) => (
              <Action
                key={value}
                glass
                label={String(value)}
                selected={beats === value}
                onPress={() => setBeats(value)}
              />
            ))}
          </View>
        </Sheet>
      )}
      {fretsSheet && (
        <Sheet title={t("FreePlay")} onClose={() => setFretsSheet(false)}>
          {freeFrets.map((fret, index) => (
            <View key={index} style={styles.controls}>
              <Text style={styles.label}>
                {6 - index} · {noteNames[(guitarMidi[index] + fret) % 12]}
              </Text>
              <Action
                glass
                label="−"
                disabled={fret === 0}
                onPress={() =>
                  setFreeFrets((values) =>
                    values.map((value, string) =>
                      string === index ? value - 1 : value
                    )
                  )
                }
              />
              <Text style={styles.label}>{t("PositionFret", { fret })}</Text>
              <Action
                glass
                label="+"
                disabled={fret === 12}
                onPress={() =>
                  setFreeFrets((values) =>
                    values.map((value, string) =>
                      string === index ? value + 1 : value
                    )
                  )
                }
              />
            </View>
          ))}
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.colors.black },
  artwork: { position: "absolute" },
  chord: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center"
  },
  chordName: { fontSize: 46, color: palette.glass.accent, fontWeight: "600" },
  freeName: { fontSize: 24, textAlign: "center" },
  tempoInput: {
    color: palette.glass.ink,
    fontSize: 22,
    textAlign: "center",
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 12,
    padding: 10
  },
  panel: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    gap: 8,
    padding: 10,
    borderRadius: 18,
    backgroundColor: palette.glass.header,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  landscapePanel: { left: undefined, width: 270 },
  chords: { gap: 8, alignItems: "center" },
  chip: {
    minWidth: 48,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.glass.surface
  },
  selected: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.play
  },
  chipText: { color: palette.glass.ink, fontSize: 18, fontWeight: "600" },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginVertical: 4
  },
  label: { color: palette.glass.ink, fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }
});
