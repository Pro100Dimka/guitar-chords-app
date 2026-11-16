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
import { Action, Diagram, Sheet } from "../song/tools";
import Strings from "../tuner/strings";
import guitar from "../tuner/config/guitar-classic";
import { guitarLayout } from "../tuner/guitar-layout";
import { noteNames } from "../tuner/tunings";
import { chordShapeOptions, guitarMidi } from "../song/chords";
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
  const [metronome, setMetronome] = useState(false);
  const [shapes, setShapes] = useState<Record<string, number>>({});
  const [fingeringChord, setFingeringChord] = useState<string | null>(null);
  const [shapePage, setShapePage] = useState(0);
  const [tempo, setTempo] = useState(80);
  const [tempoInput, setTempoInput] = useState("80");
  const [beats, setBeats] = useState(4);
  const [pattern, setPattern] = useState<Record<number, number> | null>(null);
  const [patternStep, setPatternStep] = useState<number | null>(null);
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
  const chord = progression[selected] ?? "";
  const frets = free
    ? freeFrets
    : (selectedChordShape(chord, shapes[chord])?.frets ?? freeFrets);
  const fingering = fingeringChord
    ? selectedChordShape(fingeringChord, shapes[fingeringChord])
    : undefined;
  const options = fingeringChord
    ? chordShapeOptions(fingeringChord, fingering?.index)
    : [];
  const shapePages = Math.max(1, Math.ceil(options.length / 4));
  const openFingerings = (name: string) => {
    const selectedShape = selectedChordShape(name, shapes[name]);
    const available = chordShapeOptions(name, selectedShape?.index);
    setShapePage(
      Math.max(
        0,
        Math.floor(
          available.findIndex(
            (option) => option.index === selectedShape?.index
          ) / 4
        )
      )
    );
    setFingeringChord(name);
  };
  const selectChord = (index: number) => {
    setSelected(index);
    setFree(false);
  };
  const pitches = frets.map((fret, index) =>
    fret === null ? null : guitarMidi[index] + fret
  );
  const pitchKey = pitches.join(",");
  const currentPitches = useRef(pitches);
  const previousPitches = useRef(pitches);
  const prepared = useRef(new Set<string>());
  const clock = useRef({
    origin: 0,
    step: -1,
    pulseOrigin: 0,
    metronome: false,
    running: false,
    wasPlaying: false,
    tempo: 0,
    linkedMetronome: false
  });
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
      setMetronome(false);
      clock.current.linkedMetronome = false;
      plucks.value = [];
      performanceAudio.stopPlayback();
    }
    return () => {
      performanceAudio.stopPlayback();
    };
  }, [active, plucks]);
  useEffect(() => {
    const transport = clock.current;
    const enabled = active && metronome;
    const starting = playing && !transport.wasPlaying;
    const update =
      enabled !== transport.metronome ||
      tempo !== transport.tempo ||
      (enabled && starting);
    transport.wasPlaying = playing;
    transport.tempo = tempo;
    transport.metronome = enabled;
    if (!update) return;
    let phase = 0;
    if (enabled) {
      if (transport.running && !starting) {
        phase =
          ((Date.now() - transport.origin) % (60000 / tempo)) / (60000 / tempo);
      } else {
        transport.origin = Date.now();
        transport.step = -1;
      }
      transport.pulseOrigin = transport.origin;
    }
    performanceAudio.metronome(tempo, enabled, phase);
  }, [active, metronome, tempo, playing]);
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
    if (!active || !playing || !progression.length || free) return;
    const duration = 60000 / tempo / 2;
    const slots = beats * 2;
    const now = Date.now();
    const transport = clock.current;
    transport.origin = transport.metronome
      ? now - ((now - transport.pulseOrigin) % (duration * 2))
      : now;
    transport.step = -1;
    transport.running = true;
    const advance = () => {
      const { origin, step } = transport;
      const next = Math.max(0, Math.floor((Date.now() - origin) / duration));
      if (next !== step) {
        if (pattern) {
          let target: number | undefined;
          for (
            let slot = Math.max(step + 1, next - slots + 1);
            slot <= next;
            slot++
          ) {
            const marker = pattern[slot % slots];
            if (marker !== undefined) target = marker;
          }
          if (target !== undefined) setSelected(target);
        } else if (step >= 0) {
          const cycles = Math.floor(next / slots) - Math.floor(step / slots);
          if (cycles)
            setSelected((index) => (index + cycles) % progression.length);
        }
        transport.step = next;
      }
    };
    advance();
    const timer = setInterval(advance, 30);
    return () => {
      transport.running = false;
      clearInterval(timer);
    };
  }, [active, playing, progression.length, tempo, beats, free, pattern]);

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
  const chordChoices =
    picker || patternStep !== null ? (
      <View style={styles.grid}>
        {Object.keys(recordedChordFrets).map((name) => (
          <Action
            key={name}
            glass
            label={name}
            onPress={() => {
              if (patternStep === null) {
                setProgression((list) => [...list, name]);
                setSelected(progression.length);
              } else {
                let index = progression.indexOf(name);
                if (index < 0) {
                  index = progression.length;
                  setProgression((list) => [...list, name]);
                }
                const target = index;
                setPattern((previous) => ({
                  0: selected,
                  ...previous,
                  [patternStep]: target
                }));
              }
              setFree(false);
              setPlaying(false);
              setPicker(false);
              setPatternStep(null);
            }}
          />
        ))}
      </View>
    ) : null;
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
              onPressIn={() => selectChord(index)}
              onPress={() => selectChord(index)}
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
            onPress={() => {
              setPatternStep(null);
              setPicker(true);
            }}
            disabled={progression.length >= 24}
          />
        </ScrollView>
        <View style={styles.controls}>
          <Action
            icon={playing ? "pause" : "play"}
            label={t(playing ? "Pause" : "AutoChords")}
            disabled={!progression.length || free}
            onPress={() => {
              if (playing) {
                clock.current.linkedMetronome = metronome;
                setMetronome(false);
              } else {
                setMetronome(clock.current.linkedMetronome);
              }
              setPlaying(!playing);
            }}
          />
          <Action
            glass
            compact
            label={`${tempo} BPM · ${t("PlayPattern")}`}
            onPress={() => {
              setPlaying(false);
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
      <View style={[styles.quickTools, landscape && styles.landscapeTools]}>
        {[
          {
            icon: "metronome",
            label: t("Metronome"),
            selected: metronome,
            onPress: () => {
              clock.current.linkedMetronome = !metronome;
              setMetronome(!metronome);
            }
          },
          {
            icon: "guitar-pick-outline",
            label: t("Fingering"),
            disabled: free || !chord,
            onPress: () => openFingerings(chord)
          }
        ].map((button) => (
          <View key={button.icon} style={styles.quickTool}>
            <Action {...button} />
            <Text style={styles.toolCaption}>{button.label}</Text>
          </View>
        ))}
      </View>
      {picker && (
        <Sheet title={t("AddChord")} onClose={() => setPicker(false)}>
          {chordChoices}
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
              setPattern((previous) => {
                if (!previous || !remaining.length) return null;
                const markers = Object.fromEntries(
                  Object.entries(previous)
                    .filter(([, index]) => index !== edit)
                    .map(([step, index]) => [
                      step,
                      index > edit ? index - 1 : index
                    ])
                );
                return {
                  0: Math.min(selected, remaining.length - 1),
                  ...markers
                };
              });
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
      {fingeringChord && (
        <Sheet
          title={`${fingeringChord} · ${t("Fingering")}`}
          onClose={() => setFingeringChord(null)}
        >
          <View style={styles.grid}>
            {options.slice(shapePage * 4, shapePage * 4 + 4).map((option) => (
              <Pressable
                key={option.index}
                accessibilityRole="button"
                accessibilityLabel={`${t("Fingering")} ${option.index + 1}: ${option.frets.map((fret) => fret ?? "×").join(", ")}`}
                accessibilityState={{
                  selected: fingering?.index === option.index
                }}
                style={[
                  styles.shape,
                  landscape && styles.landscapeShape,
                  fingering?.index === option.index && styles.shapeSelected
                ]}
                onPress={() => {
                  setShapes((previous) => ({
                    ...previous,
                    [fingeringChord]: option.index
                  }));
                  setFingeringChord(null);
                }}
              >
                <Text style={styles.position}>
                  {option.position === 0
                    ? t("OpenPosition")
                    : t("PositionFret", { fret: option.position })}
                </Text>
                <Diagram
                  frets={option.frets}
                  width={104}
                  selected={fingering?.index === option.index}
                />
                <Text style={styles.label}>
                  {option.label}
                  {fingering?.index === option.index ? " ✓" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          {shapePages > 1 && (
            <View style={styles.controls}>
              <Action
                glass
                icon="chevron-left"
                label={t("PreviousShapes")}
                disabled={shapePage === 0}
                onPress={() => setShapePage(shapePage - 1)}
              />
              <Text style={styles.label}>
                {shapePage + 1} / {shapePages}
              </Text>
              <Action
                glass
                icon="chevron-right"
                label={t("NextShapes")}
                disabled={shapePage + 1 >= shapePages}
                onPress={() => setShapePage(shapePage + 1)}
              />
            </View>
          )}
        </Sheet>
      )}
      {settings && (
        <Sheet
          title={t(patternStep === null ? "PlayPattern" : "ChangeChord")}
          onClose={() => {
            setSettings(false);
            setPatternStep(null);
          }}
        >
          {patternStep !== null ? (
            <>
              <Action
                glass
                icon="chevron-left"
                label={t("Back")}
                onPress={() => setPatternStep(null)}
              />
              {patternStep > 0 && (
                <Action
                  glass
                  label={t("ContinueChord")}
                  onPress={() => {
                    setPattern((previous) => {
                      const next: Record<number, number> = {
                        0: selected,
                        ...previous
                      };
                      delete next[patternStep];
                      return next;
                    });
                    setPatternStep(null);
                  }}
                />
              )}
              {chordChoices}
            </>
          ) : (
            <>
              <Text style={styles.label}>{t("Tempo")}</Text>

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
              <Text style={styles.label}>{t("PatternBeats")}</Text>
              <View style={styles.controls}>
                {[1, 2, 3, 4, 8].map((value) => (
                  <Action
                    key={value}
                    glass
                    label={String(value)}
                    selected={beats === value}
                    onPress={() => setBeats(value)}
                  />
                ))}
              </View>
              <Text style={styles.hint}>{t("PatternChangeHint")}</Text>
              <View style={styles.grid}>
                {Array.from({ length: beats * 2 }, (_, slot) => {
                  const marker =
                    pattern?.[slot] ?? (slot === 0 ? selected : undefined);
                  const label =
                    marker === undefined ? "·" : (progression[marker] ?? "+");
                  return (
                    <Pressable
                      key={slot}
                      accessibilityRole="button"
                      accessibilityLabel={`${Math.floor(slot / 2) + 1}${slot % 2 ? ` ${t("BeatAnd")}` : ""}: ${marker === undefined ? t("ContinueChord") : label}`}
                      style={[
                        styles.patternSlot,
                        marker !== undefined && styles.shapeSelected
                      ]}
                      onPress={() => {
                        setPlaying(false);
                        setPatternStep(slot);
                      }}
                    >
                      <Text style={styles.position}>
                        {slot % 2 ? t("BeatAnd") : String(slot / 2 + 1)}
                      </Text>
                      <Text style={styles.slotChord}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {pattern && (
                <Action
                  glass
                  label={t("ClearPatternChanges")}
                  onPress={() => setPattern(null)}
                />
              )}
            </>
          )}
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
    width: 100,
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
  shape: {
    width: "47%",
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.surface
  },
  landscapeShape: { width: "23%" },
  shapeSelected: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.activeCard
  },
  quickTools: { position: "absolute", top: 80, right: 8, gap: 10 },
  quickTool: { width: 64, alignItems: "center", gap: 3 },
  toolCaption: {
    color: palette.glass.ink,
    backgroundColor: palette.glass.header,
    borderRadius: 5,
    paddingHorizontal: 3,
    textAlign: "center",
    fontSize: 10
  },
  landscapeTools: { top: 8, flexDirection: "row" },
  patternSlot: {
    width: "22%",
    flexGrow: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 6
  },
  slotChord: { color: palette.glass.ink, fontSize: 19, fontWeight: "600" },
  hint: { color: palette.glass.muted, fontSize: 13, marginVertical: 10 },
  position: { color: palette.glass.ink, fontSize: 13, marginBottom: 8 },
  label: { color: palette.glass.ink, fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }
});
