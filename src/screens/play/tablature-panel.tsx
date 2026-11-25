import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import Svg, { Ellipse, Path, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  TAB_MAX_BARS,
  TAB_TECHNIQUES,
  tabBarTicks,
  tabBeatTicks,
  tabNoteDuration,
  tabNoteSymbols,
  TabTechnique,
  TabNote,
  TabRest,
  Tablature,
  tablatureLength
} from "../../components/tablature";
import palette from "../../theme/palette";
import { Action, Sheet, TempoControl } from "../song/tools";
import { TablatureKeypad } from "./tablature-keypad";
import { useTablaturePreview } from "./use-tablature-preview";
import { useTablaturePosition } from "./use-tablature";
import type { useTablature } from "./use-tablature";
import {
  changeTabMeter,
  copyTabBar,
  deleteTabBar,
  durationChoices,
  durationLabel,
  durationParts,
  durationTicks,
  insertTabBar,
  pasteTabBar,
  putTabNote,
  putTabRest,
  TabBarClipboard,
  TabEditResult
} from "./tablature-editor";

type Transport = ReturnType<typeof useTablature>;
type Selection = Pick<TabNote, "string" | "tick">;
const stringNames = ["E", "A", "D", "G", "B", "e"];
const stringOrder = [5, 4, 3, 2, 1, 0];
const durationIcons = {
  1: "music-note-whole",
  2: "music-note-half",
  4: "music-note-quarter",
  8: "music-note-eighth",
  16: "music-note-sixteenth",
  32: "music-note-thirty-second",
  64: "music-note-thirty-second",
  128: "music-note-thirty-second"
} as const;
const sameNote = (a: Selection | null, b: Selection) =>
  a?.string === b.string && a.tick === b.tick;

const techniqueIcons: Record<TabTechnique, string> = {
  hammerOn: "arrow-collapse-down",
  pullOff: "arrow-collapse-up",
  slide: "arrow-top-right",
  bend: "arrow-top-right-bold-outline",
  vibrato: "sine-wave",
  palmMute: "hand-back-right-outline",
  letRing: "infinity",
  harmonic: "diamond-outline",
  tapping: "gesture-tap",
  tremolo: "format-line-spacing",
  trill: "waveform",
  whammy: "chart-bell-curve",
  grace: "music-note-eighth",
  slap: "hand-front-right-outline",
  pop: "gesture-tap-hold",
  rasgueado: "gesture-swipe",
  mordent: "sine-wave",
  turn: "rotate-3d-variant",
  golpe: "hand-back-right",
  pickScrape: "texture"
};
type NoteSettings = Omit<TabNote, "string" | "fret" | "tick" | "duration">;

function ExpressionSlider({
  label,
  value,
  min,
  max,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const [display, setDisplay] = useState(value);
  const pending = useRef(value);
  useEffect(() => {
    setDisplay(value);
    pending.current = value;
  }, [value]);
  const setPosition = (x: number) => {
    if (disabled) return;
    pending.current = Math.round(
      min + Math.max(0, Math.min(1, x / width)) * (max - min)
    );
    setDisplay(pending.current);
  };
  return (
    <View style={styles.expressionSlider}>
      <Text style={styles.expressionLabel}>{label}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) =>
          !disabled &&
          onChange(
            Math.max(
              min,
              Math.min(
                max,
                value + (event.nativeEvent.actionName === "increment" ? 1 : -1)
              )
            )
          )
        }
        style={styles.sliderTouch}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !disabled}
        onResponderGrant={(event) => setPosition(event.nativeEvent.locationX)}
        onResponderMove={(event) => setPosition(event.nativeEvent.locationX)}
        onResponderRelease={() => !disabled && onChange(pending.current)}
        onResponderTerminate={() => setDisplay(value)}
      >
        <View pointerEvents="none" style={styles.sliderTrack}>
          <View
            style={[
              styles.sliderFill,
              { width: `${((display - min) / (max - min)) * 100}%` }
            ]}
          />
          <View
            style={[
              styles.sliderThumb,
              { left: `${((display - min) / (max - min)) * 100}%` }
            ]}
          />
        </View>
      </View>
      <Text style={styles.sliderValue}>{display}</Text>
    </View>
  );
}

function TripletIcon({ selected = false }: { selected?: boolean }) {
  const color = selected ? palette.gold.ink : palette.glass.ink;
  return (
    <Svg width={26} height={26} viewBox="0 0 28 28" accessible={false}>
      <Path
        d="M3 9V6H9M19 6H25V9M7 22V13H24V22M15.5 22V13"
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <SvgText
        x={14}
        y={9}
        fill={color}
        fontSize={10}
        fontWeight="700"
        textAnchor="middle"
      >
        3
      </SvgText>
      {[4.5, 13, 21.5].map((cx) => (
        <Ellipse key={cx} cx={cx} cy={22} rx={3} ry={2} fill={color} />
      ))}
    </Svg>
  );
}

/** One readable bar; empty cells become insertion targets in the editor. */
const TablatureStaff = React.memo(function TablatureStaff({
  tab,
  bar,
  tick,
  compact = false,
  selected = null,
  selectedRest = null,
  grid = 6,
  disabled = false,
  readOnly = false,
  readingScale = 1,
  followPlayback = true,
  onManualScroll,
  onNote,
  onCell,
  onRest
}: {
  tab: Tablature;
  bar: number;
  tick: number;
  compact?: boolean;
  selected?: Selection | null;
  selectedRest?: number | null;
  grid?: number;
  disabled?: boolean;
  readOnly?: boolean;
  readingScale?: number;
  followPlayback?: boolean;
  onManualScroll?: () => void;
  onNote?: (note: TabNote) => void;
  onCell?: (cell: Selection) => void;
  onRest?: (rest: TabRest) => void;
}) {
  const { t } = useTranslation();
  const { width, height, fontScale } = useWindowDimensions();
  const dense = compact && (height < 700 || width > height);
  const textScale = Math.max(1, fontScale);
  const scroll = useRef<ScrollView>(null);
  const [staffWidth, setStaffWidth] = useState(0);
  const barTicks = tabBarTicks(tab);
  const beatTicks = tabBeatTicks(tab);
  const start = bar * barTicks;
  const editable = !!onCell && !readOnly;
  const NoteTarget = readOnly ? View : Pressable;
  const selectedTick = selected?.tick ?? selectedRest;
  const { eventTimes, notes, rests } = useMemo(() => {
    const times = new Set<number>();
    const entries = new Map<string, { note: TabNote; end: number }>();
    const nextByString = new Map<number, number>();
    for (const note of [...tab.notes].sort((a, b) => b.tick - a.tick)) {
      const end = Math.min(
        note.tick + tabNoteDuration(note),
        nextByString.get(note.string) ?? Number.POSITIVE_INFINITY
      );
      nextByString.set(note.string, note.tick);
      if (note.tick >= start + barTicks || end <= start) continue;
      const position = Math.max(start, note.tick);
      times.add(position);
      entries.set(`${note.string}:${position}`, { note, end });
    }
    const pauses = new Map<number, TabRest>();
    for (const rest of tab.rests ?? []) {
      if (rest.tick >= start + barTicks || rest.tick + rest.duration <= start)
        continue;
      const position = Math.max(start, rest.tick);
      times.add(position);
      pauses.set(position, rest);
    }
    return {
      eventTimes: times,
      notes: entries,
      rests: pauses
    };
  }, [tab.notes, tab.rests, start, barTicks]);
  const columns = useMemo(() => {
    const step = editable ? grid : beatTicks;
    const times = new Set(
      Array.from(
        { length: Math.ceil(barTicks / step) },
        (_, position) => start + position * step
      )
    );
    eventTimes.forEach((tick) => times.add(tick));
    // Insertion advances by note duration, which need not match the grid.
    if (
      editable &&
      selectedTick !== null &&
      selectedTick >= start &&
      selectedTick < start + barTicks
    )
      times.add(selectedTick);
    return [...times].sort((a, b) => a - b);
  }, [eventTimes, start, barTicks, beatTicks, editable, grid, selectedTick]);
  const labelWidth = readOnly
    ? Math.max(24, 20 * readingScale)
    : 24 * textScale;
  const cellWidth = Math.max(
    readOnly ? 44 * readingScale : (compact ? 34 : 44) * textScale,
    (staffWidth - labelWidth) / Math.max(1, columns.length)
  );
  const editingRowHeight = (width > height ? 26 : 44) * textScale;
  const active =
    tick >= start && tick < start + barTicks
      ? columns.findIndex(
          (position, index) =>
            tick >= position && tick < (columns[index + 1] ?? start + barTicks)
        )
      : -1;
  useEffect(() => {
    if (!followPlayback) return;
    const target =
      selectedTick === null ? active : columns.indexOf(selectedTick);
    if (target >= 0)
      scroll.current?.scrollTo({
        x: Math.max(0, target - 2) * cellWidth,
        animated: readOnly
      });
  }, [active, cellWidth, columns, selectedTick, followPlayback, readOnly]);
  const rowHeight = readOnly
    ? 32 * readingScale
    : dense
      ? 12 * textScale
      : compact
        ? 18 * textScale
        : editingRowHeight;
  const rowStyle = { height: rowHeight };
  const barLineTop = readOnly
    ? 20 * readingScale
    : (dense ? 14 : 18) * textScale;
  const barLineHeight = rowHeight * 6;
  const showRests = readOnly || rests.size > 0;
  const beatPosition = (position: number) =>
    Number((1 + (position - start) / beatTicks).toFixed(2));
  return (
    <View
      style={styles.staff}
      onLayout={(event) => setStaffWidth(event.nativeEvent.layout.width)}
    >
      <View style={[styles.stringLabels, { width: labelWidth }]}>
        <View
          style={[
            styles.beatRow,
            dense && styles.denseBeats,
            !readOnly && { height: (dense ? 14 : 18) * textScale },
            readOnly && { height: 20 * readingScale }
          ]}
        />
        {stringOrder.map((string) => (
          <View key={string} style={[styles.stringLabel, rowStyle]}>
            <Text
              allowFontScaling={!readOnly}
              style={[
                styles.stringName,
                readOnly && { fontSize: 13 * readingScale }
              ]}
            >
              {stringNames[string]}
            </Text>
          </View>
        ))}
        {showRests && (
          <View style={[styles.stringLabel, rowStyle]}>
            <Text
              allowFontScaling={!readOnly}
              style={[
                styles.stringName,
                readOnly && { fontSize: 13 * readingScale }
              ]}
            >
              {t("TabRestShort")}
            </Text>
          </View>
        )}
      </View>
      <ScrollView
        horizontal
        ref={scroll}
        showsHorizontalScrollIndicator={!compact}
        onScrollBeginDrag={onManualScroll}
        contentContainerStyle={styles.staffContent}
      >
        <View>
          <View
            style={[
              styles.beatRow,
              dense && styles.denseBeats,
              !readOnly && { height: (dense ? 14 : 18) * textScale },
              readOnly && { height: 20 * readingScale }
            ]}
          >
            {columns.map((position, index) => (
              <View key={position} style={[styles.cell, { width: cellWidth }]}>
                <Text
                  allowFontScaling={!readOnly}
                  numberOfLines={1}
                  style={[
                    styles.beat,
                    readOnly && { fontSize: 11 * readingScale },
                    index === active && styles.activeBeat
                  ]}
                >
                  {beatPosition(position)}
                </Text>
              </View>
            ))}
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.barLines,
              {
                top: barLineTop + rowHeight / 2,
                height: barLineHeight - rowHeight
              }
            ]}
          >
            <View style={[styles.barLine, styles.barStart]} />
            {columns.map((position, index) =>
              index > 0 && (position - start) % beatTicks === 0 ? (
                <View
                  key={position}
                  style={[
                    styles.barLine,
                    styles.beatLine,
                    { left: index * cellWidth }
                  ]}
                />
              ) : null
            )}
            <View style={[styles.barLine, styles.barEnd]} />
          </View>
          {stringOrder.map((string) => (
            <View
              key={string}
              testID={`tablature-string-${string}`}
              style={[styles.row, rowStyle]}
            >
              <View pointerEvents="none" style={styles.stringLine} />
              {columns.map((position, index) => {
                const entry = notes.get(`${string}:${position}`);
                const note = entry?.note;
                const continued = !!note && note.tick < start;
                const cell = { string, tick: position };
                const chosen = sameNote(selected, note ?? cell);
                return (
                  <View
                    key={position}
                    style={[styles.cell, { width: cellWidth }]}
                  >
                    {note ? (
                      <NoteTarget
                        accessible
                        accessibilityRole={readOnly ? "text" : "button"}
                        accessibilityLabel={`${continued ? `${t("TabContinuation")}, ` : ""}${t(
                          "TabNoteDescription",
                          {
                            string: 6 - string,
                            fret: note.fret,
                            bar: Math.floor(note.tick / barTicks) + 1,
                            beat: Number(
                              (1 + (note.tick % barTicks) / beatTicks).toFixed(
                                2
                              )
                            )
                          }
                        )}, ${t("TabDurationValue", { duration: durationLabel(tabNoteDuration(note)) })}`}
                        accessibilityState={
                          readOnly
                            ? undefined
                            : {
                                selected: chosen,
                                disabled: disabled || !onNote
                              }
                        }
                        disabled={disabled || readOnly || !onNote}
                        onPress={readOnly ? undefined : () => onNote?.(note)}
                        style={[
                          styles.note,
                          !compact && styles.editableCell,
                          !compact &&
                            !readOnly && { height: editingRowHeight - 2 },
                          readOnly && { height: 32 * readingScale - 2 },
                          continued && styles.continuation,
                          (index === active || chosen) && styles.activeNote
                        ]}
                      >
                        <Text
                          allowFontScaling={!readOnly}
                          style={[
                            styles.fret,
                            compact && styles.compactFret,
                            dense && styles.denseFret,
                            readOnly && {
                              fontSize: 20 * readingScale,
                              lineHeight: 22 * readingScale
                            },
                            (index === active || chosen) && styles.activeFret
                          ]}
                        >
                          {continued
                            ? "↳"
                            : note.accent === "dead"
                              ? "×"
                              : note.accent === "ghost"
                                ? `(${note.fret})`
                                : note.fret}
                        </Text>
                        {!!tabNoteSymbols(note) && (
                          <Text numberOfLines={1} style={styles.noteSymbol}>
                            {tabNoteSymbols(note)}
                          </Text>
                        )}
                        {!compact && (
                          <Text
                            allowFontScaling={!readOnly}
                            style={[
                              styles.duration,
                              readOnly && {
                                fontSize: 9 * readingScale,
                                lineHeight: 10 * readingScale
                              },
                              (index === active || chosen) && styles.activeFret
                            ]}
                          >
                            {durationLabel(
                              continued
                                ? Math.min(entry!.end, start + barTicks) - start
                                : tabNoteDuration(note)
                            )}
                          </Text>
                        )}
                      </NoteTarget>
                    ) : editable ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("TabEmptyCell", {
                          string: 6 - string,
                          bar: bar + 1,
                          beat: beatPosition(position)
                        })}
                        accessibilityState={{ selected: chosen, disabled }}
                        disabled={disabled}
                        onPress={() => onCell?.(cell)}
                        style={[
                          styles.emptyCell,
                          { width: cellWidth, height: editingRowHeight },
                          chosen && styles.cursorCell
                        ]}
                      >
                        {chosen && <Text style={styles.cursorText}>+</Text>}
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
          {showRests && (
            <View style={[styles.row, rowStyle]}>
              {columns.map((position) => {
                const rest = rests.get(position);
                return (
                  <View
                    key={position}
                    style={[styles.cell, { width: cellWidth }]}
                  >
                    {rest && (
                      <NoteTarget
                        accessible
                        accessibilityRole={readOnly ? "text" : "button"}
                        accessibilityLabel={`${rest.tick < start ? `${t("TabContinuation")}, ` : ""}${t(
                          "TabRestDescription",
                          {
                            bar: Math.floor(rest.tick / barTicks) + 1,
                            beat: Number(
                              (1 + (rest.tick % barTicks) / beatTicks).toFixed(
                                2
                              )
                            ),
                            duration: durationLabel(rest.duration)
                          }
                        )}`}
                        accessibilityState={
                          readOnly
                            ? undefined
                            : {
                                selected: selectedRest === rest.tick,
                                disabled: disabled || !onRest
                              }
                        }
                        disabled={disabled || readOnly || !onRest}
                        onPress={readOnly ? undefined : () => onRest?.(rest)}
                        style={[
                          styles.note,
                          !compact && styles.editableCell,
                          !compact &&
                            !readOnly && { height: editingRowHeight - 2 },
                          readOnly && { height: 32 * readingScale - 2 },
                          rest.tick < start && styles.continuation,
                          selectedRest === rest.tick && styles.activeNote
                        ]}
                      >
                        <Text
                          allowFontScaling={!readOnly}
                          style={[
                            styles.restText,
                            readOnly && { fontSize: 12 * readingScale },
                            selectedRest === rest.tick && styles.activeFret
                          ]}
                        >
                          {rest.tick < start ? "↳ " : ""}
                          {compact
                            ? t("TabRestShort")
                            : durationLabel(
                                Math.min(
                                  rest.tick + rest.duration,
                                  start + barTicks
                                ) - position
                              )}
                        </Text>
                      </NoteTarget>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
});

export function TablatureBar(
  props: React.ComponentProps<typeof TablatureStaff>
) {
  return <TablatureStaff {...props} />;
}

export function TablaturePanel({
  transport,
  title,
  dirty,
  expanded,
  disabled = false,
  onToggle,
  onOpen,
  onSave,
  onRecord,
  onPractice,
  standalone = false,
  visible = true,
  onClose
}: {
  transport: Transport;
  title?: string;
  dirty: boolean;
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onSave: () => void;
  onRecord: () => void;
  onPractice?: () => void;
  standalone?: boolean;
  visible?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const dense = height < 700 || width > height;
  const { tab, status, range } = transport;
  const tick = useTablaturePosition(transport);
  const [full, setFull] = useState(standalone);
  const [editorSection, setEditorSection] = useState<
    "score" | "note" | "bars" | "loop"
  >("score");
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Selection | null>({
    string: 5,
    tick: 0
  });
  const [restSelection, setRestSelection] = useState<number | null>(null);
  const [insertFret, setInsertFret] = useState(0);
  const [insertDuration, setInsertDuration] = useState(24);
  const [grid, setGrid] = useState(24);
  const [advanceCursor, setAdvanceCursor] = useState(true);
  const [clipboard, setClipboard] = useState<TabBarClipboard | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [noteDetails, setNoteDetails] = useState(false);
  const [noteTab, setNoteTab] = useState<"note" | "technique" | "dynamics">(
    "note"
  );
  const [editScope, setEditScope] = useState<"note" | "chord" | "bar">("note");
  const [insertSettings, setInsertSettings] = useState<NoteSettings>({});
  const [noteClipboard, setNoteClipboard] = useState<TabNote[] | null>(null);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [tupletActual, setTupletActual] = useState(3);
  const [tupletNormal, setTupletNormal] = useState(2);
  const [keypadExpanded, setKeypadExpanded] = useState(false);
  const fretInput = useRef<{
    string: number;
    tick: number;
    fret: number;
    time: number;
  } | null>(null);
  const sections = [
    { key: "note", label: "TabScore", icon: "music-note-eighth" },
    { key: "bars", label: "TabBars", icon: "view-column-outline" },
    { key: "loop", label: "TabLoopShort", icon: "repeat" }
  ] as const;
  const barTicks = tabBarTicks(tab);
  const beatTicks = tabBeatTicks(tab);
  const length = useMemo(() => tablatureLength(tab), [tab]);
  const bars = length / barTicks;
  const bar = Math.max(0, Math.min(page, bars - 1));
  const recording = status === "recording";
  const countingIn = status === "countingIn";
  const recordPending = countingIn && transport.countIn?.target === "record";
  const controlsLocked =
    disabled || recording || countingIn || status === "preparing";
  const readOnly = controlsLocked || status === "playing";
  const { preview, cancelPreview } = useTablaturePreview(
    visible && !readOnly && previewEnabled && (full || expanded),
    tab.tempo
  );
  const moving = status === "playing" || recording;
  const wasMoving = useRef(false);
  const sounding = status === "playing" || status === "preparing" || countingIn;
  const selected = useMemo(
    () => tab.notes.find((note) => sameNote(selection, note)),
    [tab.notes, selection]
  );
  const selectedRest = useMemo(
    () => (tab.rests ?? []).find((rest) => rest.tick === restSelection),
    [tab.rests, restSelection]
  );
  const hasEvents = tab.notes.length > 0 || !!tab.rests?.length;
  const cursor = selection ?? {
    string: 5,
    tick: restSelection ?? bar * barTicks
  };
  const duration = selected
    ? tabNoteDuration(selected)
    : (selectedRest?.duration ?? insertDuration);
  const parts = durationParts(duration);
  useEffect(() => {
    setTupletActual(selected?.tuplet?.actual ?? 3);
    setTupletNormal(selected?.tuplet?.normal ?? 2);
  }, [selected?.tuplet]);
  const position = selectedRest?.tick ?? cursor.tick;
  useEffect(() => {
    // Pause captures the live clock, which can cross a bar since the last frame.
    if (moving || wasMoving.current) setPage(Math.floor(tick / barTicks));
    wasMoving.current = moving;
  }, [moving, tick, barTicks]);
  // Playback and rewind may change the page without moving the edit selection.
  // When editing resumes, every action must target the visible bar.
  useEffect(() => {
    if (moving) return;
    const selectedAt = selection?.tick ?? restSelection;
    const start = bar * barTicks;
    if (
      selectedAt !== null &&
      (selectedAt < start || selectedAt >= start + barTicks)
    ) {
      setSelection({ string: selection?.string ?? 5, tick: start });
      setRestSelection(null);
    }
  }, [bar, barTicks, moving, selection, restSelection]);
  // A loaded shorter document must never leave insertion aimed outside its page.
  useEffect(() => {
    if (selection && selection.tick >= tablatureLength(tab))
      setSelection({
        ...selection,
        tick: Math.max(0, tablatureLength(tab) - grid)
      });
    if (restSelection !== null && restSelection >= tablatureLength(tab))
      setRestSelection(null);
  }, [tab, selection, restSelection, grid]);
  const selectNote = (note: TabNote) => {
    fretInput.current = null;
    if (readOnly) return;
    transport.pause();
    setSelection(note);
    setRestSelection(null);
    setInsertFret(note.fret);
    setPage(Math.floor(note.tick / barTicks));
    setEditError(null);
    preview(note);
  };
  const selectCell = (cell: Selection) => {
    fretInput.current = null;
    if (readOnly) return;
    cancelPreview();
    transport.pause();
    setSelection(cell);
    setRestSelection(null);
    setEditError(null);
  };
  const selectRest = (rest: TabRest) => {
    fretInput.current = null;
    if (readOnly) return;
    cancelPreview();
    transport.pause();
    setSelection(null);
    setRestSelection(rest.tick);
    setPage(Math.floor(rest.tick / barTicks));
    setEditError(null);
  };
  const closeEditor = () => {
    cancelPreview();
    setFull(false);
    if (standalone) onClose?.();
  };
  const showEditor = (note?: TabNote) => {
    if (readOnly) return;
    transport.pause();
    if (note) selectNote(note);
    setEditorSection(note ? "note" : "score");
    setEditError(null);
    setFull(true);
  };
  const apply = (result: TabEditResult) => {
    if (readOnly) return false;
    if (result.error) {
      setEditError(result.error);
      return false;
    }
    if (!result.tab || transport.setTab(result.tab) === false) {
      setEditError("TabInvalidData");
      return false;
    }
    setEditError(null);
    return true;
  };
  const removeSelection = () => {
    if (readOnly || (!selected && !selectedRest)) return;
    cancelPreview();
    fretInput.current = null;
    if (selected)
      apply({
        tab: {
          ...tab,
          notes: tab.notes.filter((note) => !scopedNotes.includes(note))
        }
      });
    else
      apply({
        tab: {
          ...tab,
          rests: (tab.rests ?? []).filter((rest) => rest !== selectedRest)
        }
      });
    setSelection(cursor);
    setRestSelection(null);
  };
  const enterFret = (digit: number) => {
    if (readOnly) return;
    const previous = fretInput.current;
    const time = Date.now();
    const combined =
      previous &&
      previous.string === cursor.string &&
      previous.tick === cursor.tick &&
      time - previous.time < 1200
        ? previous.fret * 10 + digit
        : digit;
    const fret = combined <= 24 ? combined : digit;
    const next = {
      ...(selected ?? insertSettings),
      ...cursor,
      fret,
      duration: selected ? tabNoteDuration(selected) : insertDuration
    };
    if (!apply(putTabNote(tab, next, selected))) return;
    preview(next);
    setSelection(next);
    setRestSelection(null);
    setInsertFret(fret);
    fretInput.current = { ...cursor, fret, time };
  };
  const nextPosition = () => {
    if (readOnly) return;
    const next =
      position + (selected ? tabNoteDuration(selected) : insertDuration);
    if (next >= tablatureLength(tab) && !apply(insertTabBar(tab, bars))) return;
    selectCell({ ...cursor, tick: next });
    setPage(Math.floor(next / barTicks));
  };
  const changeNote = (patch: Partial<TabNote>) => {
    if (!selected || readOnly) return;
    const next = { ...selected, ...patch };
    if (apply(putTabNote(tab, next, selected))) {
      if (next.fret !== selected.fret || next.string !== selected.string)
        preview(next);
      setSelection(next);
      setPage(Math.floor(next.tick / barTicks));
    }
  };
  const noteSettings = selected ?? insertSettings;
  const scopedNotes = tab.notes.filter(
    (note) =>
      selected &&
      (editScope === "note"
        ? note === selected
        : editScope === "chord"
          ? note.tick === cursor.tick
          : Math.floor(note.tick / barTicks) === bar)
  );
  const patchSettings = (patch: NoteSettings) => {
    if (readOnly || selectedRest) return;
    if (!selected) {
      setInsertSettings((settings) => ({ ...settings, ...patch }));
      return;
    }
    if (
      apply({
        tab: {
          ...tab,
          version: 3,
          notes: tab.notes.map((note) =>
            scopedNotes.includes(note) ? { ...note, ...patch } : note
          )
        }
      })
    )
      preview({ ...selected, ...patch });
  };
  const toggleTechnique = (technique: TabTechnique) =>
    patchSettings({
      techniques: noteSettings.techniques?.includes(technique)
        ? noteSettings.techniques.filter((entry) => entry !== technique)
        : [...(noteSettings.techniques ?? []), technique]
    });
  const saveNotesToClipboard = (cut = false) => {
    if (readOnly || !scopedNotes.length) return;
    const first = Math.min(...scopedNotes.map((note) => note.tick));
    setNoteClipboard(
      scopedNotes.map((note) => ({ ...note, tick: note.tick - first }))
    );
    if (cut)
      apply({
        tab: {
          ...tab,
          notes: tab.notes.filter((note) => !scopedNotes.includes(note))
        }
      });
  };
  const pasteNotes = (duplicate = false) => {
    if (readOnly) return;
    const first = Math.min(...scopedNotes.map((note) => note.tick));
    const source = duplicate
      ? scopedNotes.map((note) => ({ ...note, tick: note.tick - first }))
      : noteClipboard;
    if (!source?.length) return;
    const at = duplicate
      ? Math.max(
          ...scopedNotes.map((note) => note.tick + tabNoteDuration(note))
        )
      : cursor.tick;
    const notes = source.map((note) => ({
      ...note,
      string: source.length === 1 ? cursor.string : note.string,
      tick: at + note.tick
    }));
    if (
      notes.some((note) => tab.notes.some((entry) => sameNote(note, entry)))
    ) {
      setEditError("TabNoteCollision");
      return;
    }
    if (
      apply({ tab: { ...tab, version: 3, notes: [...tab.notes, ...notes] } })
    ) {
      setSelection(notes[0]);
      setRestSelection(null);
      setPage(Math.floor(at / barTicks));
    }
  };
  const transposeNotes = (delta: number) => {
    if (readOnly || !scopedNotes.length) return;
    if (
      scopedNotes.some(
        (note) => note.fret + delta < 0 || note.fret + delta > 24
      )
    ) {
      setEditError("TabTransposeRange");
      return;
    }
    if (
      apply({
        tab: {
          ...tab,
          notes: tab.notes.map((note) =>
            scopedNotes.includes(note)
              ? { ...note, fret: note.fret + delta }
              : note
          )
        }
      }) &&
      selected
    )
      preview({ ...selected, fret: selected.fret + delta });
  };
  const clearNoteEffects = () =>
    patchSettings({
      techniques: undefined,
      bend: undefined,
      bendRelease: undefined,
      sourceFret: undefined,
      accent: undefined,
      fade: undefined,
      pick: undefined,
      velocity: undefined,
      tie: undefined,
      fermata: undefined
    });
  const changeRest = (patch: Partial<TabRest>) => {
    if (!selectedRest || readOnly) return;
    const next = { ...selectedRest, ...patch };
    if (apply(putTabRest(tab, next, selectedRest.tick))) {
      setRestSelection(next.tick);
      setPage(Math.floor(next.tick / barTicks));
    }
  };
  const changeDuration = (next: number, tuplet?: TabNote["tuplet"]) => {
    if (readOnly) return;
    fretInput.current = null;
    if (selected && editScope !== "note")
      apply({
        tab: {
          ...tab,
          version: 3,
          notes: tab.notes.map((note) =>
            scopedNotes.includes(note)
              ? { ...note, duration: next, tuplet }
              : note
          )
        }
      });
    else if (selected) changeNote({ duration: next, tuplet });
    else if (selectedRest) changeRest({ duration: next });
    else {
      setEditError(null);
      setInsertSettings((settings) => ({ ...settings, tuplet }));
    }
    setInsertDuration(next);
  };
  const shiftPosition = (next: number) => {
    if (selected) changeNote({ tick: next });
    else if (selectedRest) changeRest({ tick: next });
    else {
      selectCell({ ...cursor, tick: next });
      setPage(Math.floor(next / barTicks));
    }
  };
  const insert = (
    result: TabEditResult,
    at: number,
    length: number,
    rest = false
  ) => {
    // Cursor movement must not add a silent bar to the playback loop.
    const next =
      advanceCursor && result.tab && at + length < tablatureLength(result.tab)
        ? at + length
        : at;
    if (!apply(result)) return;
    if (!rest) {
      const added = result.tab?.notes.find(
        (note) => note.tick === at && note.string === cursor.string
      );
      if (added) preview(added);
    } else cancelPreview();
    setRestSelection(rest && next === at ? at : null);
    setSelection(rest && next === at ? null : { ...cursor, tick: next });
    setPage(Math.floor(next / barTicks));
    setEditorSection("score");
  };
  const changeRange = (first: number, last: number) => {
    transport.setRange({ start: (first - 1) * barTicks, end: last * barTicks });
    transport.setLoop(true);
  };
  const choosePage = (next: number) => {
    cancelPreview();
    transport.pause();
    setPage(next);
    setSelection({ ...cursor, tick: next * barTicks });
    setRestSelection(null);
    setEditError(null);
  };
  const firstBar = range ? Math.floor(range.start / barTicks) + 1 : 1;
  const lastBar = range ? Math.ceil(range.end / barTicks) : bars;
  const playback = (
    <Action
      glass
      compact={standalone}
      primary={hasEvents && !sounding}
      icon={sounding ? "pause" : "play"}
      label={t(
        countingIn
          ? "TabCancelCountIn"
          : status === "preparing"
            ? "TabCancelPreparing"
            : sounding
              ? "Pause"
              : "TabPlay"
      )}
      selected={sounding}
      disabled={disabled || recording || (!hasEvents && !sounding)}
      onPress={() => {
        cancelPreview();
        if (sounding) transport.pause();
        else void transport.play();
      }}
    />
  );
  const actions = (
    <View style={styles.actions}>
      <Action
        glass
        compact={standalone}
        showLabel
        icon="folder-open-outline"
        label={t("TabOpen")}
        disabled={controlsLocked}
        onPress={() => {
          cancelPreview();
          if (!standalone) setFull(false);
          onOpen();
        }}
      />
      <Action
        glass
        compact={standalone}
        showLabel
        icon={recording || recordPending ? "stop" : "record-circle-outline"}
        selected={recording || recordPending}
        label={t(
          recording
            ? "TabStopRecording"
            : recordPending
              ? "TabCancelCountIn"
              : "TabRecord"
        )}
        disabled={
          disabled || (!recordPending && (countingIn || status === "preparing"))
        }
        onPress={() => {
          cancelPreview();
          setFull(false);
          if (recording) transport.stopRecording();
          else if (recordPending) transport.pause();
          else onRecord();
        }}
      />
      <Action
        glass
        compact={standalone}
        showLabel
        icon="content-save-outline"
        label={t("TabSave")}
        disabled={!hasEvents || controlsLocked}
        onPress={() => {
          cancelPreview();
          if (!standalone) setFull(false);
          onSave();
        }}
      />
      <Action
        glass
        compact={standalone}
        showLabel
        icon={standalone ? "music-box-outline" : "skip-backward"}
        label={t(standalone ? "TabPractice" : "TabRewind")}
        disabled={!hasEvents || controlsLocked}
        onPress={() => {
          cancelPreview();
          if (standalone) {
            onPractice?.();
            return;
          }
          transport.rewind();
          setPage(firstBar - 1);
        }}
      />
      {!full && playback}
    </View>
  );
  const pager = (
    <View style={styles.pager}>
      <Action
        glass
        compact
        icon="chevron-left"
        label={t("TabPreviousBar")}
        disabled={bar === 0 || readOnly}
        onPress={() => choosePage(bar - 1)}
      />
      <Text
        accessibilityLabel={t("TabBarOf", { current: bar + 1, total: bars })}
        style={[styles.caption, styles.pageCaption]}
      >
        {bar + 1} / {bars}
      </Text>
      <Action
        glass
        compact
        icon="chevron-right"
        label={t("TabNextBar")}
        disabled={bar + 1 >= bars || readOnly}
        onPress={() => choosePage(bar + 1)}
      />
    </View>
  );
  return (
    <View style={standalone ? undefined : styles.panel}>
      {!standalone && (
        <View style={styles.heading}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(expanded ? "TabCollapse" : "TabExpand")}
            accessibilityState={{ expanded }}
            onPress={() => {
              if (expanded) cancelPreview();
              onToggle();
            }}
            style={styles.headingButton}
          >
            <MaterialCommunityIcons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={palette.glass.accent}
            />
            <Text numberOfLines={1} style={styles.title}>
              {title || t("TabTitle")}
            </Text>
            {dirty && (
              <Text accessibilityLabel={t("TabUnsaved")} style={styles.dirty}>
                •
              </Text>
            )}
          </Pressable>
          {onPractice && (
            <Action
              glass
              compact
              icon="music-box-outline"
              label={t("TabPractice")}
              disabled={
                disabled || recording || recordPending || !hasEvents || full
              }
              onPress={() => {
                if (
                  disabled ||
                  recording ||
                  recordPending ||
                  !hasEvents ||
                  full
                )
                  return;
                cancelPreview();
                onPractice();
              }}
            />
          )}
          <Action
            glass
            compact
            icon={recording || recordPending ? "stop" : "pencil-outline"}
            label={t(
              recording
                ? "TabStopRecording"
                : recordPending
                  ? "TabCancelCountIn"
                  : "TabFullView"
            )}
            selected={recording || recordPending}
            disabled={disabled || (!recording && !recordPending && readOnly)}
            onPress={() => {
              if (recording) transport.stopRecording();
              else if (recordPending) transport.pause();
              else showEditor();
            }}
          />
        </View>
      )}
      {expanded && !standalone && (
        <>
          {hasEvents ? (
            <TablatureBar
              tab={tab}
              bar={bar}
              tick={tick}
              compact
              disabled={readOnly}
              onNote={showEditor}
              onRest={(rest) => {
                selectRest(rest);
                setEditorSection("note");
                setFull(true);
              }}
            />
          ) : (
            <Text style={styles.empty}>
              {t(recording ? "TabRecordingHint" : "TabEmptyHint")}
            </Text>
          )}
          {actions}
          {(!dense || recording || status === "preparing" || countingIn) && (
            <View style={styles.metadata}>
              <Text style={styles.caption}>
                {countingIn && transport.countIn
                  ? t("TabCountInStatus", {
                      bar: transport.countIn.bar,
                      bars: transport.countIn.bars,
                      beat: transport.countIn.beat,
                      beats: tab.beatsPerBar
                    })
                  : recording
                    ? t("TabRecording")
                    : status === "preparing"
                      ? t("TabPreparing")
                      : `${Math.round(transport.practiceBpm)} ♩ BPM · ${tab.beatsPerBar}/${tab.beatUnit ?? 4}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("TabFullView")}
                disabled={readOnly}
                onPress={() => showEditor()}
                style={styles.details}
              >
                <Text style={styles.caption}>
                  {t("TabBarOf", { current: bar + 1, total: bars })}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      )}
      {transport.error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {t(transport.error)}
        </Text>
      )}
      {full && (
        <Modal
          visible={visible}
          animationType="fade"
          supportedOrientations={["landscape-right"]}
          onRequestClose={closeEditor}
        >
          <SafeAreaView style={styles.editorScreen}>
            <View style={styles.editorHeader}>
              <Action
                glass
                compact
                icon="arrow-left"
                label={t("Close")}
                onPress={closeEditor}
              />
              <View style={styles.editorIdentity}>
                <Text numberOfLines={1} style={styles.editorTitle}>
                  {title || t("TabTitle")}
                </Text>
                <Text style={styles.caption}>
                  {Math.round(transport.practiceBpm)} BPM · {tab.beatsPerBar}/
                  {tab.beatUnit ?? 4}
                </Text>
              </View>
              <View style={styles.headerActions}>{actions}</View>
            </View>
            <View style={styles.entryWorkspace}>
              <ScrollView
                style={styles.workspace}
                contentContainerStyle={styles.workspaceContent}
              >
                {transport.error && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>
                    {t(transport.error)}
                  </Text>
                )}
                <>
                  <TablatureBar
                    tab={tab}
                    bar={bar}
                    tick={tick}
                    selected={moving ? null : selection}
                    selectedRest={moving ? null : restSelection}
                    grid={grid}
                    disabled={readOnly}
                    onNote={selectNote}
                    onCell={selectCell}
                    onRest={selectRest}
                  />
                  {editError && (
                    <Text accessibilityLiveRegion="polite" style={styles.error}>
                      {t(editError)}
                    </Text>
                  )}
                </>
              </ScrollView>
              <TablatureKeypad
                expanded={keypadExpanded}
                onToggle={() => {
                  fretInput.current = null;
                  setKeypadExpanded((value) => !value);
                }}
                caption={`${t("TabString")}: ${6 - cursor.string} · ${durationLabel(duration)}`}
                disabled={readOnly}
                canDelete={!!selected || !!selectedRest}
                canAdvance={position + insertDuration < TAB_MAX_BARS * barTicks}
                onKey={(key) =>
                  typeof key === "number"
                    ? enterFret(key)
                    : key === "delete"
                      ? removeSelection()
                      : nextPosition()
                }
              />
            </View>
            <View style={styles.workspaceToolbar}>
              {sections.map((section) => (
                <Pressable
                  key={section.key}
                  accessibilityRole="button"
                  accessibilityLabel={t(section.label)}
                  onPress={() => {
                    fretInput.current = null;
                    setEditorSection(section.key);
                  }}
                  style={styles.sectionSelector}
                >
                  <MaterialCommunityIcons
                    name={section.icon}
                    size={18}
                    color={palette.glass.accent}
                  />
                  {width >= 760 && (
                    <>
                      <Text style={styles.sectionTabText}>
                        {t(section.label)}
                      </Text>
                      <MaterialCommunityIcons
                        name="chevron-down"
                        size={16}
                        color={palette.glass.muted}
                      />
                    </>
                  )}
                </Pressable>
              ))}
              <View style={styles.history}>
                <Action
                  glass
                  compact
                  icon="undo"
                  label={t("TabUndo")}
                  disabled={readOnly || !transport.canUndo}
                  onPress={() => {
                    cancelPreview();
                    fretInput.current = null;
                    transport.undo();
                    setEditError(null);
                  }}
                />
                <Action
                  glass
                  compact
                  icon="redo"
                  label={t("TabRedo")}
                  disabled={readOnly || !transport.canRedo}
                  onPress={() => {
                    cancelPreview();
                    fretInput.current = null;
                    transport.redo();
                    setEditError(null);
                  }}
                />
              </View>
              <View style={styles.quickEdits}>
                <Action
                  glass
                  compact
                  icon="trash-can-outline"
                  label={t("TabDeleteNote")}
                  disabled={readOnly || (!selected && !selectedRest)}
                  onPress={removeSelection}
                />
                {[
                  { icon: "chevron-up", label: "TabStringUp", delta: 1 },
                  { icon: "chevron-down", label: "TabStringDown", delta: -1 }
                ].map(({ icon, label, delta }) => (
                  <Action
                    key={label}
                    glass
                    compact
                    icon={icon}
                    label={t("TabString") + (delta > 0 ? " ↑" : " ↓")}
                    disabled={
                      readOnly ||
                      !!selectedRest ||
                      cursor.string + delta < 0 ||
                      cursor.string + delta > 5
                    }
                    onPress={() => {
                      if (selected)
                        changeNote({ string: cursor.string + delta });
                      else
                        selectCell({
                          ...cursor,
                          string: cursor.string + delta
                        });
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={styles.transportBar}>
              <View style={styles.footerGroup}>{pager}</View>
              <View style={styles.playbackGroup}>
                <Action
                  glass
                  compact
                  icon="skip-backward"
                  label={t("TabRewind")}
                  disabled={disabled || recording || recordPending}
                  onPress={() => {
                    cancelPreview();
                    transport.rewind();
                    setPage(firstBar - 1);
                  }}
                />
                {playback}
                <Action
                  glass
                  compact
                  icon="skip-forward"
                  label={t("TabNextPosition")}
                  disabled={
                    readOnly ||
                    position + insertDuration >= TAB_MAX_BARS * barTicks
                  }
                  onPress={nextPosition}
                />
              </View>
              <View style={styles.footerGroup}>
                <TempoControl
                  label={t("TabTempoShort")}
                  accessibilityLabel={t("TabQuarterTempo")}
                  value={tab.tempo}
                  disabled={readOnly}
                  onChange={(tempo) => apply({ tab: { ...tab, tempo } })}
                />
              </View>
            </View>
            {editorSection !== "score" && (
              <Sheet
                compact
                dense={editorSection === "note"}
                scrollKey={editorSection === "note" ? noteTab : undefined}
                landscapeOnly
                subtitle={
                  editorSection === "note"
                    ? `${selectedRest ? t("TabEditRest") : `${t("TabString")}: ${6 - cursor.string} · ${t("TabFret")}: ${selected?.fret ?? insertFret}`} · ${t("TabNotePosition", { bar: Math.floor(position / barTicks) + 1, beat: Number((1 + (position % barTicks) / beatTicks).toFixed(2)) })}`
                    : undefined
                }
                maxWidth={editorSection === "note" ? 1100 : 600}
                title={t(
                  sections.find((section) => section.key === editorSection)!
                    .label
                )}
                toolbar={
                  editorSection === "note" && (
                    <View style={styles.noteSheetNavigation}>
                      <View style={styles.noteTabs}>
                        {(
                          [
                            {
                              key: "note",
                              label: "TabNoteTab",
                              icon: "music-note"
                            },
                            {
                              key: "technique",
                              label: "TabTechniqueTab",
                              icon: "guitar-pick-outline"
                            },
                            {
                              key: "dynamics",
                              label: "TabDynamics",
                              icon: "tune-vertical"
                            }
                          ] as const
                        ).map(({ key, label, icon }) => (
                          <View key={key} style={styles.noteTabChoice}>
                            <Action
                              glass
                              compact
                              showLabel
                              icon={icon}
                              label={t(label)}
                              selected={noteTab === key}
                              onPress={() => setNoteTab(key)}
                            />
                          </View>
                        ))}
                      </View>
                      <View style={styles.expressionRow}>
                        {(
                          [
                            { key: "note", label: "TabScopeNote" },
                            { key: "chord", label: "TabScopeChord" },
                            { key: "bar", label: "TabScopeBar" }
                          ] as const
                        ).map(({ key, label }) => (
                          <Action
                            key={key}
                            glass
                            compact
                            label={t(label)}
                            selected={editScope === key}
                            disabled={readOnly || !!selectedRest}
                            onPress={() => setEditScope(key)}
                          />
                        ))}
                      </View>
                    </View>
                  )
                }
                footer={
                  editorSection === "note" && (
                    <View style={styles.noteSheetFooter}>
                      <View style={styles.expressionRow}>
                        <Action
                          glass
                          compact
                          icon="undo"
                          label={t("TabUndo")}
                          disabled={readOnly || !transport.canUndo}
                          onPress={() => {
                            cancelPreview();
                            transport.undo();
                          }}
                        />
                        <Action
                          glass
                          compact
                          icon="redo"
                          label={t("TabRedo")}
                          disabled={readOnly || !transport.canRedo}
                          onPress={() => {
                            cancelPreview();
                            transport.redo();
                          }}
                        />
                      </View>
                      <View style={styles.previewActions}>
                        <Action
                          glass
                          compact
                          icon={previewEnabled ? "volume-high" : "volume-off"}
                          label={t("TabSoundOn")}
                          selected={previewEnabled}
                          onPress={() => {
                            cancelPreview();
                            setPreviewEnabled(!previewEnabled);
                          }}
                        />
                        <Action
                          glass
                          compact
                          showLabel
                          icon="play"
                          label={t("TabPreviewNote")}
                          disabled={
                            readOnly || !!selectedRest || !previewEnabled
                          }
                          onPress={() =>
                            preview({
                              ...noteSettings,
                              ...cursor,
                              fret: selected?.fret ?? insertFret,
                              duration
                            })
                          }
                        />
                      </View>
                      <View style={styles.doneAction}>
                        <Action
                          glass
                          compact
                          primary
                          showLabel
                          icon="check"
                          label={t("Done")}
                          onPress={() => setEditorSection("score")}
                        />
                      </View>
                    </View>
                  )
                }
                onClose={() => setEditorSection("score")}
              >
                {editorSection === "note" && (
                  <View style={styles.noteEditor}>
                    {editError && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.error}
                      >
                        {t(editError)}
                      </Text>
                    )}
                    {noteTab === "note" && (
                      <>
                        <View style={styles.expressionColumns}>
                          <View style={styles.expressionCard}>
                            <Text style={styles.expressionHeading}>
                              {t("TabDuration")}
                            </Text>
                            <View style={styles.durationGrid}>
                              {durationChoices.map((denominator) => (
                                <View
                                  key={denominator}
                                  style={styles.durationChoice}
                                >
                                  <Action
                                    glass
                                    compact
                                    showLabel
                                    icon={durationIcons[denominator]}
                                    label={`1/${denominator}`}
                                    accessibilityLabel={t("TabDurationChoice", {
                                      denominator
                                    })}
                                    selected={
                                      parts?.denominator === denominator
                                    }
                                    disabled={readOnly}
                                    onPress={() =>
                                      changeDuration(
                                        durationTicks(
                                          denominator,
                                          parts?.modifier ?? "plain"
                                        )
                                      )
                                    }
                                  />
                                </View>
                              ))}
                            </View>
                            <View style={styles.expressionRow}>
                              {(
                                [
                                  {
                                    key: "dotted",
                                    label: "TabDotted",
                                    text: "·"
                                  },
                                  {
                                    key: "doubleDotted",
                                    label: "TabDoubleDotted",
                                    text: "··"
                                  },
                                  {
                                    key: "triplet",
                                    label: "TabTriplet",
                                    text: "3:2"
                                  },
                                  {
                                    key: "quintuplet",
                                    label: "TabQuintuplet",
                                    text: "5:4"
                                  }
                                ] as const
                              ).map(({ key, label, text }) => (
                                <Action
                                  key={key}
                                  glass
                                  compact
                                  label={text}
                                  icon={
                                    key === "triplet" ? (
                                      <TripletIcon
                                        selected={parts?.modifier === key}
                                      />
                                    ) : undefined
                                  }
                                  showLabel
                                  accessibilityLabel={t(label)}
                                  selected={parts?.modifier === key}
                                  disabled={readOnly}
                                  onPress={() =>
                                    changeDuration(
                                      durationTicks(
                                        parts?.denominator ?? 4,
                                        parts?.modifier === key ? "plain" : key
                                      )
                                    )
                                  }
                                />
                              ))}
                              <Action
                                glass
                                compact
                                icon="tune-vertical"
                                label={t("TabMoreOptions")}
                                selected={noteDetails}
                                onPress={() => setNoteDetails(!noteDetails)}
                              />
                              <Action
                                glass
                                compact
                                showLabel
                                icon="call-merge"
                                label={t("TabTie")}
                                selected={!!noteSettings.tie}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({ tie: !noteSettings.tie })
                                }
                              />
                              <Action
                                glass
                                compact
                                showLabel
                                icon="music-note-whole"
                                label={t("TabFermata")}
                                selected={!!noteSettings.fermata}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({
                                    fermata: !noteSettings.fermata
                                  })
                                }
                              />
                            </View>
                            <Text style={styles.expressionHeading}>
                              {t("TabPitchPosition")}
                            </Text>
                            <View style={styles.expressionRow}>
                              {!selectedRest && (
                                <View style={styles.pitchControl}>
                                  <Stepper
                                    label={t("TabString")}
                                    value={6 - cursor.string}
                                    min={1}
                                    max={6}
                                    disabled={readOnly}
                                    onChange={(value) =>
                                      selected
                                        ? changeNote({ string: 6 - value })
                                        : selectCell({
                                            ...cursor,
                                            string: 6 - value
                                          })
                                    }
                                  />
                                </View>
                              )}
                              {!selectedRest && (
                                <View style={styles.pitchControl}>
                                  <Stepper
                                    label={t("TabFret")}
                                    value={selected?.fret ?? insertFret}
                                    min={0}
                                    max={24}
                                    disabled={readOnly}
                                    onChange={(fret) =>
                                      selected
                                        ? changeNote({ fret })
                                        : setInsertFret(fret)
                                    }
                                  />
                                </View>
                              )}
                              <View style={styles.expressionRow}>
                                <Action
                                  glass
                                  compact
                                  icon="chevron-left"
                                  label={t("TabNoteEarlier")}
                                  disabled={readOnly || position === 0}
                                  onPress={() =>
                                    shiftPosition(Math.max(0, position - grid))
                                  }
                                />
                                <Text style={styles.caption}>
                                  {t("TabNotePosition", {
                                    bar: Math.floor(position / barTicks) + 1,
                                    beat: Number(
                                      (
                                        1 +
                                        (position % barTicks) / beatTicks
                                      ).toFixed(2)
                                    )
                                  })}
                                </Text>
                                <Action
                                  glass
                                  compact
                                  icon="chevron-right"
                                  label={t("TabNoteLater")}
                                  disabled={
                                    readOnly ||
                                    position + grid >= tablatureLength(tab)
                                  }
                                  onPress={() => shiftPosition(position + grid)}
                                />
                              </View>
                            </View>
                            <View style={styles.expressionRow}>
                              <Action
                                glass
                                compact
                                showLabel
                                icon="music-note"
                                label={t("TabAddNote")}
                                selected={!!selected}
                                disabled={readOnly || !!selectedRest}
                                onPress={() => {
                                  if (!selected)
                                    insert(
                                      putTabNote(tab, {
                                        ...insertSettings,
                                        ...cursor,
                                        fret: insertFret,
                                        duration: insertDuration
                                      }),
                                      cursor.tick,
                                      insertDuration
                                    );
                                }}
                              />
                              <Action
                                glass
                                compact
                                showLabel
                                icon="music-rest-quarter"
                                label={t("TabAddRest")}
                                selected={!!selectedRest}
                                disabled={readOnly}
                                onPress={() => {
                                  const notes = tab.notes.filter(
                                    (note) => !scopedNotes.includes(note)
                                  );
                                  const at =
                                    selected && editScope === "bar"
                                      ? bar * barTicks
                                      : position;
                                  const restDuration =
                                    selected && editScope === "bar"
                                      ? barTicks
                                      : Math.max(
                                          duration,
                                          ...scopedNotes.map(tabNoteDuration)
                                        );
                                  const result = putTabRest(
                                    { ...tab, notes },
                                    { tick: at, duration: restDuration },
                                    selectedRest?.tick
                                  );
                                  if (apply(result)) {
                                    cancelPreview();
                                    setSelection(null);
                                    setRestSelection(at);
                                  }
                                }}
                              />
                              <Action
                                glass
                                compact
                                showLabel
                                icon="close"
                                label={t("TabDeadNote")}
                                selected={noteSettings.accent === "dead"}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({
                                    accent:
                                      noteSettings.accent === "dead"
                                        ? undefined
                                        : "dead"
                                  })
                                }
                              />
                            </View>
                            {noteDetails && (
                              <View style={styles.noteDetails}>
                                <Text style={styles.expressionHeading}>
                                  {t("TabCustomTuplet")}
                                </Text>
                                <View style={styles.expressionRow}>
                                  <Stepper
                                    label={t("TabTupletActual")}
                                    value={tupletActual}
                                    min={2}
                                    max={16}
                                    disabled={readOnly}
                                    onChange={setTupletActual}
                                  />
                                  <Stepper
                                    label={t("TabTupletNormal")}
                                    value={tupletNormal}
                                    min={1}
                                    max={16}
                                    disabled={readOnly}
                                    onChange={setTupletNormal}
                                  />
                                  <Action
                                    glass
                                    compact
                                    label={t("Apply")}
                                    disabled={readOnly}
                                    onPress={() =>
                                      changeDuration(
                                        Math.round(
                                          ((durationTicks(
                                            parts?.denominator ?? 4
                                          ) *
                                            tupletNormal) /
                                            tupletActual) *
                                            960
                                        ) / 960,
                                        {
                                          actual: tupletActual,
                                          normal: tupletNormal,
                                          denominator:
                                            selected?.tuplet?.denominator ??
                                            parts?.denominator ??
                                            4
                                        }
                                      )
                                    }
                                  />
                                </View>
                                <Text style={styles.expressionHeading}>
                                  {t("TabGrid")}
                                </Text>
                                <View style={styles.expressionRow}>
                                  {[24, 12, 6, 3, 1.5, 0.75, 8, 4].map(
                                    (step) => (
                                      <Action
                                        key={step}
                                        glass
                                        compact
                                        label={durationLabel(step)}
                                        accessibilityLabel={t("TabGridValue", {
                                          value: durationLabel(step)
                                        })}
                                        selected={grid === step}
                                        disabled={readOnly}
                                        onPress={() => setGrid(step)}
                                      />
                                    )
                                  )}
                                </View>
                                <Action
                                  glass
                                  compact
                                  showLabel
                                  icon="arrow-right-circle-outline"
                                  label={t("TabAdvanceCursor")}
                                  selected={advanceCursor}
                                  disabled={readOnly}
                                  onPress={() =>
                                    setAdvanceCursor(!advanceCursor)
                                  }
                                />
                              </View>
                            )}
                          </View>
                          <View style={styles.expressionCard}>
                            <Text style={styles.expressionHeading}>
                              {t("TabPickingFingering")}
                            </Text>
                            <View style={styles.expressionRow}>
                              {(
                                [
                                  { key: "down", icon: "arrow-down" },
                                  { key: "up", icon: "arrow-up" },
                                  {
                                    key: "downBrush",
                                    icon: "arrow-collapse-down"
                                  },
                                  { key: "upBrush", icon: "arrow-collapse-up" },
                                  { key: "arpeggio", icon: "sine-wave" }
                                ] as const
                              ).map(({ key, icon }) => (
                                <Action
                                  key={key}
                                  glass
                                  compact
                                  showLabel
                                  icon={icon}
                                  label={t(`TabPick_${key}`)}
                                  selected={noteSettings.pick === key}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() =>
                                    patchSettings({
                                      pick:
                                        noteSettings.pick === key
                                          ? undefined
                                          : key
                                    })
                                  }
                                />
                              ))}
                            </View>
                            <View style={styles.expressionRow}>
                              <Text style={styles.expressionLabel}>
                                {t("TabLeftHand")}
                              </Text>
                              {[1, 2, 3, 4].map((finger) => (
                                <Action
                                  key={finger}
                                  glass
                                  compact
                                  label={String(finger)}
                                  selected={noteSettings.leftFinger === finger}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() =>
                                    patchSettings({
                                      leftFinger:
                                        noteSettings.leftFinger === finger
                                          ? undefined
                                          : finger
                                    })
                                  }
                                />
                              ))}
                            </View>
                            <View style={styles.expressionRow}>
                              <Text style={styles.expressionLabel}>
                                {t("TabRightHand")}
                              </Text>
                              {(["p", "i", "m", "a", "c"] as const).map(
                                (finger) => (
                                  <Action
                                    key={finger}
                                    glass
                                    compact
                                    label={finger}
                                    selected={
                                      noteSettings.rightFinger === finger
                                    }
                                    disabled={readOnly || !!selectedRest}
                                    onPress={() =>
                                      patchSettings({
                                        rightFinger:
                                          noteSettings.rightFinger === finger
                                            ? undefined
                                            : finger
                                      })
                                    }
                                  />
                                )
                              )}
                            </View>
                            <View style={styles.expressionRow}>
                              <Text style={styles.expressionLabel}>
                                {t("TabVoice")}
                              </Text>
                              {[1, 2, 3, 4].map((voice) => (
                                <Action
                                  key={voice}
                                  glass
                                  compact
                                  label={String(voice)}
                                  selected={(noteSettings.voice ?? 1) === voice}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() => patchSettings({ voice })}
                                />
                              ))}
                            </View>
                            <Text style={styles.expressionHeading}>
                              {t("TabEditSelection")}
                            </Text>
                            <View style={styles.expressionRow}>
                              {[
                                {
                                  icon: "content-copy",
                                  label: "TabCopyNotes",
                                  action: () => saveNotesToClipboard(),
                                  disabled: !scopedNotes.length
                                },
                                {
                                  icon: "content-cut",
                                  label: "TabCutNotes",
                                  action: () => saveNotesToClipboard(true),
                                  disabled: !scopedNotes.length
                                },
                                {
                                  icon: "content-paste",
                                  label: "TabPasteNotes",
                                  action: () => pasteNotes(),
                                  disabled: !noteClipboard?.length
                                },
                                {
                                  icon: "content-duplicate",
                                  label: "TabDuplicateNotes",
                                  action: () => pasteNotes(true),
                                  disabled: !scopedNotes.length
                                }
                              ].map(
                                ({
                                  icon,
                                  label,
                                  action,
                                  disabled: unavailable
                                }) => (
                                  <Action
                                    key={label}
                                    glass
                                    compact
                                    showLabel
                                    icon={icon}
                                    label={t(label)}
                                    disabled={readOnly || unavailable}
                                    onPress={action}
                                  />
                                )
                              )}
                              <Action
                                glass
                                compact
                                showLabel
                                icon="delete-outline"
                                label={t("TabDeleteNote")}
                                disabled={
                                  readOnly || (!selected && !selectedRest)
                                }
                                onPress={removeSelection}
                              />
                            </View>
                            <View style={styles.expressionRow}>
                              <Text style={styles.expressionLabel}>
                                {t("Transpose")}
                              </Text>
                              {[-1, 1].map((step) => (
                                <Action
                                  key={step}
                                  glass
                                  compact
                                  label={step > 0 ? "+1" : "−1"}
                                  disabled={readOnly || !scopedNotes.length}
                                  onPress={() => transposeNotes(step)}
                                />
                              ))}
                              <Action
                                glass
                                compact
                                showLabel
                                icon="eraser"
                                label={t("TabClearEffects")}
                                disabled={readOnly || !!selectedRest}
                                onPress={clearNoteEffects}
                              />
                            </View>
                          </View>
                        </View>
                      </>
                    )}
                    {noteTab === "technique" && (
                      <>
                        <View style={styles.techniqueGrid}>
                          {(Object.keys(TAB_TECHNIQUES) as TabTechnique[]).map(
                            (technique) => (
                              <View
                                key={technique}
                                style={styles.techniqueChoice}
                              >
                                <Action
                                  glass
                                  compact
                                  showLabel
                                  icon={techniqueIcons[technique]}
                                  label={t(`TabTechnique_${technique}`)}
                                  selected={noteSettings.techniques?.includes(
                                    technique
                                  )}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() => toggleTechnique(technique)}
                                />
                              </View>
                            )
                          )}
                        </View>
                        {noteSettings.techniques?.includes("bend") && (
                          <View style={styles.expressionCard}>
                            <Text style={styles.expressionHeading}>
                              {t("TabTechnique_bend")}
                            </Text>
                            <View style={styles.expressionRow}>
                              {[0.5, 1, 1.5, 2, 2.5, 3].map((bend) => (
                                <Action
                                  key={bend}
                                  glass
                                  compact
                                  label={`${bend} ${t("TabTone")}`}
                                  selected={(noteSettings.bend ?? 1) === bend}
                                  disabled={readOnly}
                                  onPress={() => patchSettings({ bend })}
                                />
                              ))}
                              <Action
                                glass
                                compact
                                showLabel
                                icon="undo"
                                label={t("TabBendRelease")}
                                selected={!!noteSettings.bendRelease}
                                disabled={readOnly}
                                onPress={() =>
                                  patchSettings({
                                    bendRelease: !noteSettings.bendRelease
                                  })
                                }
                              />
                            </View>
                            <Svg
                              width="100%"
                              height={58}
                              viewBox="0 0 500 58"
                              preserveAspectRatio="none"
                              accessible
                              accessibilityLabel={t("TabBendCurve")}
                            >
                              <Path
                                d="M8 48H492M8 10V48"
                                stroke={palette.glass.edge}
                                fill="none"
                                strokeWidth={1}
                              />
                              <Path
                                d={
                                  noteSettings.bendRelease
                                    ? "M8 48C100 48 160 10 250 10S400 48 492 48"
                                    : "M8 48C100 48 150 10 250 10H492"
                                }
                                stroke={palette.glass.accent}
                                fill="none"
                                strokeWidth={3}
                              />
                            </Svg>
                          </View>
                        )}
                        {noteSettings.techniques?.some((technique) =>
                          ["slide", "grace", "hammerOn", "pullOff"].includes(
                            technique
                          )
                        ) && (
                          <Stepper
                            label={t("TabSourceFret")}
                            value={
                              noteSettings.sourceFret ??
                              Math.max(0, (selected?.fret ?? insertFret) - 2)
                            }
                            min={0}
                            max={24}
                            disabled={readOnly}
                            onChange={(sourceFret) =>
                              patchSettings({ sourceFret })
                            }
                          />
                        )}
                      </>
                    )}
                    {noteTab === "dynamics" && (
                      <View style={styles.expressionColumns}>
                        <View style={styles.expressionCard}>
                          <Text style={styles.expressionHeading}>
                            {t("TabDynamics")}
                          </Text>
                          <View style={styles.dynamicGrid}>
                            {[
                              { name: "ppp", value: 16 },
                              { name: "pp", value: 28 },
                              { name: "p", value: 40 },
                              { name: "mp", value: 52 },
                              { name: "mf", value: 64 },
                              { name: "f", value: 82 },
                              { name: "ff", value: 104 },
                              { name: "fff", value: 127 }
                            ].map(({ name, value }) => (
                              <View style={styles.dynamicChoice} key={name}>
                                <Action
                                  glass
                                  compact
                                  label={name}
                                  icon={
                                    <Text
                                      numberOfLines={1}
                                      style={[
                                        styles.dynamicMark,
                                        (noteSettings.velocity ?? 64) ===
                                          value && styles.dynamicMarkSelected
                                      ]}
                                    >
                                      {name}
                                    </Text>
                                  }
                                  selected={
                                    (noteSettings.velocity ?? 64) === value
                                  }
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() =>
                                    patchSettings({ velocity: value })
                                  }
                                />
                              </View>
                            ))}
                          </View>
                          <ExpressionSlider
                            label={t("TabAttack")}
                            value={noteSettings.velocity ?? 64}
                            min={1}
                            max={127}
                            disabled={readOnly || !!selectedRest}
                            onChange={(velocity) => patchSettings({ velocity })}
                          />
                          <View style={styles.expressionRow}>
                            {(
                              [
                                {
                                  key: "accent",
                                  icon: "chevron-right",
                                  label: "TabAccent"
                                },
                                {
                                  key: "strong",
                                  icon: "chevron-double-right",
                                  label: "TabStrongAccent"
                                },
                                {
                                  key: "staccato",
                                  icon: "circle-small",
                                  label: "TabStaccato"
                                },
                                {
                                  key: "ghost",
                                  icon: "music-note-outline",
                                  label: "TabGhostNote"
                                }
                              ] as const
                            ).map(({ key, icon, label }) => (
                              <Action
                                key={key}
                                glass
                                compact
                                showLabel
                                icon={icon}
                                label={t(label)}
                                selected={noteSettings.accent === key}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({
                                    accent:
                                      noteSettings.accent === key
                                        ? undefined
                                        : key
                                  })
                                }
                              />
                            ))}
                          </View>
                        </View>
                        <View style={styles.expressionCard}>
                          <Text style={styles.expressionHeading}>
                            {t("TabExpression")}
                          </Text>
                          <View style={styles.expressionRow}>
                            {(
                              [
                                {
                                  key: "crescendo",
                                  icon: "arrow-expand-horizontal"
                                },
                                {
                                  key: "diminuendo",
                                  icon: "arrow-collapse-horizontal"
                                },
                                { key: "in", icon: "volume-plus" },
                                { key: "out", icon: "volume-minus" }
                              ] as const
                            ).map(({ key, icon }) => (
                              <Action
                                key={key}
                                glass
                                compact
                                showLabel
                                icon={icon}
                                label={t(`TabFade_${key}`)}
                                selected={noteSettings.fade === key}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({
                                    fade:
                                      noteSettings.fade === key
                                        ? undefined
                                        : key
                                  })
                                }
                              />
                            ))}
                          </View>
                          <View style={styles.singleExpressionAction}>
                            {" "}
                            <Action
                              glass
                              compact
                              showLabel
                              icon="eraser"
                              label={t("TabClearEffects")}
                              disabled={readOnly || !!selectedRest}
                              onPress={clearNoteEffects}
                            />
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                )}
                {editorSection === "bars" && (
                  <View style={[styles.editor, styles.noteEditor]}>
                    <View style={styles.options}>
                      <Action
                        glass
                        label={t("TabInsertBar")}
                        disabled={readOnly || bars >= TAB_MAX_BARS}
                        onPress={() => {
                          if (apply(insertTabBar(tab, bar))) choosePage(bar);
                        }}
                      />
                      <Action
                        glass
                        label={t("TabAppendBar")}
                        disabled={readOnly || bars >= TAB_MAX_BARS}
                        onPress={() => {
                          if (apply(insertTabBar(tab, bars))) choosePage(bars);
                        }}
                      />
                      <Action
                        glass
                        label={t("TabDuplicateBar")}
                        disabled={readOnly || bars >= TAB_MAX_BARS}
                        onPress={() => {
                          if (
                            apply(
                              insertTabBar(tab, bar + 1, copyTabBar(tab, bar))
                            )
                          )
                            choosePage(bar + 1);
                        }}
                      />
                      <Action
                        glass
                        label={t("TabDeleteBar")}
                        disabled={readOnly}
                        onPress={() => {
                          if (apply(deleteTabBar(tab, bar)))
                            choosePage(Math.min(bar, Math.max(0, bars - 2)));
                        }}
                      />
                      <Action
                        glass
                        label={t("TabCopyBar")}
                        disabled={readOnly}
                        onPress={() => {
                          setClipboard(copyTabBar(tab, bar));
                          setEditError(null);
                        }}
                      />
                      <Action
                        glass
                        label={t("TabPasteBar")}
                        disabled={readOnly || !clipboard}
                        onPress={() => {
                          if (
                            clipboard &&
                            apply(pasteTabBar(tab, bar, clipboard))
                          )
                            choosePage(bar);
                        }}
                      />
                    </View>
                    <Text style={styles.caption}>
                      {t(clipboard ? "TabBarCopied" : "TabBarEditHint")}
                    </Text>
                    <Text style={styles.caption}>{t("TabMeter")}</Text>
                    <View style={styles.options}>
                      {(
                        [
                          [2, 4],
                          [3, 4],
                          [4, 4],
                          [6, 8]
                        ] as const
                      ).map(([beats, unit]) => (
                        <Action
                          key={`${beats}/${unit}`}
                          glass
                          compact
                          label={`${beats}/${unit}`}
                          accessibilityLabel={t("TabMeterValue", {
                            beats,
                            unit
                          })}
                          disabled={readOnly}
                          selected={
                            tab.beatsPerBar === beats &&
                            (tab.beatUnit ?? 4) === unit
                          }
                          onPress={() => {
                            if (apply(changeTabMeter(tab, beats, unit)))
                              choosePage(0);
                          }}
                        />
                      ))}
                    </View>
                  </View>
                )}
                {editorSection === "loop" && (
                  <View style={styles.editor}>
                    <View style={styles.options}>
                      <Action
                        glass
                        label={t("TabLoop")}
                        selected={transport.loop}
                        disabled={!hasEvents || controlsLocked}
                        onPress={() => transport.setLoop(!transport.loop)}
                      />
                      <Action
                        glass
                        label={t("TabWholePiece")}
                        selected={range === null}
                        disabled={controlsLocked}
                        onPress={() => transport.setRange(null)}
                      />
                    </View>
                    <Text style={styles.caption}>{t("TabLoopRange")}</Text>
                    <Stepper
                      label={t("TabRangeFrom")}
                      value={firstBar}
                      min={1}
                      max={lastBar}
                      disabled={controlsLocked}
                      onChange={(value) => changeRange(value, lastBar)}
                    />
                    <Stepper
                      label={t("TabRangeTo")}
                      value={lastBar}
                      min={firstBar}
                      max={bars}
                      disabled={controlsLocked}
                      onChange={(value) => changeRange(firstBar, value)}
                    />
                    <Text style={styles.caption}>{t("TabSpeed")}</Text>
                    <View style={styles.options}>
                      {[0.5, 0.75, 1].map((speed) => (
                        <Action
                          key={speed}
                          glass
                          label={`${Math.round(speed * 100)}%`}
                          accessibilityLabel={t("TabSpeedPercent", {
                            percent: Math.round(speed * 100)
                          })}
                          selected={
                            !transport.practice.trainer.enabled &&
                            transport.speed === speed
                          }
                          disabled={controlsLocked}
                          onPress={() => transport.setSpeed(speed)}
                        />
                      ))}
                    </View>
                  </View>
                )}
              </Sheet>
            )}
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Action
        glass
        label="−"
        accessibilityLabel={`${label}: −`}
        disabled={disabled || value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
      />
      <Text style={styles.value}>{value}</Text>
      <Action
        glass
        label="+"
        accessibilityLabel={`${label}: +`}
        disabled={disabled || value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editorScreen: { flex: 1, backgroundColor: palette.paper.background },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge
  },
  editorIdentity: { flex: 1, gap: 2 },
  editorTitle: { fontSize: 19, fontWeight: "600" },
  headerActions: { flex: 2, maxWidth: 320 },
  transportBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge
  },
  footerGroup: { flex: 1, maxWidth: 220 },
  playbackGroup: {
    flex: 1,
    maxWidth: 240,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  workspaceToolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 16,
    backgroundColor: palette.glass.card,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.surfaceEdge,
    borderTopWidth: 1,
    borderTopColor: palette.glass.surfaceEdge,
    justifyContent: "space-between"
  },
  workspace: { flex: 1 },
  noteEditor: { padding: 0, gap: 10, borderWidth: 0 },
  noteSheetNavigation: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge
  },
  noteTabs: { flexDirection: "row", gap: 6, flexGrow: 1, maxWidth: 460 },
  noteTabChoice: { flex: 1, height: 44 },
  previewActions: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    maxWidth: 220,
    gap: 8,
    height: 44
  },
  doneAction: { width: 110, height: 44 },
  pitchControl: { flex: 1, minWidth: 145 },
  noteSheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 6,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge,
    backgroundColor: palette.glass.card
  },
  expressionColumns: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 12
  },
  expressionCard: {
    flexGrow: 1,
    flexBasis: 330,
    padding: 10,
    gap: 8,
    borderRadius: 16,
    backgroundColor: palette.glass.card,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  expressionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8
  },
  expressionHeading: {
    color: palette.glass.accent,
    fontSize: 14,
    fontWeight: "600"
  },
  expressionLabel: { color: palette.glass.muted, fontSize: 13 },
  durationGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  durationChoice: { flexGrow: 1, flexBasis: "20%" },
  techniqueGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  techniqueChoice: { flexGrow: 1, flexBasis: "17%" },
  dynamicMark: { color: palette.glass.ink, fontSize: 14, fontStyle: "italic" },
  dynamicMarkSelected: { color: palette.gold.ink },
  singleExpressionAction: {
    height: 44,
    minWidth: 140,
    alignSelf: "flex-start"
  },
  dynamicGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dynamicChoice: { flexGrow: 1, flexBasis: "10%" },
  expressionSlider: { flexDirection: "row", alignItems: "center", gap: 12 },
  sliderTouch: {
    flex: 1,
    height: 44,
    justifyContent: "center",
    marginHorizontal: 8
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.glass.edge
  },
  sliderFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.glass.accent
  },
  sliderThumb: {
    position: "absolute",
    top: -7,
    marginLeft: -9,
    height: 18,
    width: 18,
    borderRadius: 9,
    backgroundColor: palette.glass.accent
  },
  sliderValue: {
    minWidth: 32,
    textAlign: "center",
    color: palette.glass.ink,
    fontSize: 15,
    fontWeight: "600"
  },
  noteSymbol: { color: palette.glass.accent, fontSize: 9, lineHeight: 11 },
  noteDetails: {
    gap: 12,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge
  },
  entryWorkspace: { flex: 1, flexDirection: "row" },
  workspaceContent: { padding: 8, gap: 8 },
  sectionSelector: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.control
  },
  sectionTabText: { fontSize: 12, color: palette.glass.accent },
  panel: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.header,
    paddingHorizontal: 10,
    paddingBottom: 8
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  headingButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  title: { flexShrink: 1, fontSize: 15, fontWeight: "600" },
  dirty: { color: palette.glass.accent, fontSize: 20 },
  staff: { flexDirection: "row", marginVertical: 4 },
  staffContent: { flexGrow: 1 },
  stringLabels: { width: 24 },
  stringLabel: { alignItems: "center", justifyContent: "center" },
  stringName: { color: palette.glass.muted, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center" },
  barLines: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1
  },
  barLine: {
    position: "absolute",
    width: 2,
    height: "100%",
    backgroundColor: palette.paper.line
  },
  beatLine: { width: 1 },
  barStart: { left: 0 },
  barEnd: { right: 0 },
  beatRow: { height: 18, flexDirection: "row", alignItems: "center" },
  denseBeats: { height: 14 },
  beat: { color: palette.glass.muted, fontSize: 10, textAlign: "center" },
  activeBeat: { color: palette.glass.accent },
  cell: { height: "100%", justifyContent: "center" },
  stringLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: palette.paper.line
  },
  note: {
    alignSelf: "center",
    minWidth: 32,
    maxWidth: "100%",
    paddingHorizontal: 4,
    marginHorizontal: 4,
    borderRadius: 5,
    backgroundColor: palette.glass.control,
    alignItems: "center",
    justifyContent: "center"
  },
  editableCell: { height: 42, marginHorizontal: 1 },
  continuation: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: palette.glass.muted
  },
  emptyCell: {
    height: 44,
    width: 44,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center"
  },
  cursorCell: {
    borderWidth: 1,
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.control
  },
  cursorText: { color: palette.glass.accent, fontSize: 20 },
  activeNote: { backgroundColor: palette.glass.accent },
  fret: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.glass.ink
  },
  compactFret: { fontSize: 12 },
  denseFret: { fontSize: 10, lineHeight: 12 },
  duration: {
    color: palette.glass.muted,
    fontSize: 8,
    lineHeight: 9,
    textAlign: "center"
  },
  restText: { color: palette.glass.ink, fontSize: 10, textAlign: "center" },
  activeFret: { color: palette.gold.ink },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 6
  },
  metadata: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4
  },
  caption: { color: palette.glass.muted, fontSize: 12 },
  details: { paddingVertical: 5 },
  empty: { color: palette.glass.muted, fontSize: 13, paddingVertical: 12 },
  error: { color: palette.gold.rimLight, fontSize: 13, marginVertical: 6 },
  pager: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4
  },
  pageCaption: { flexShrink: 1, textAlign: "center" },
  quickEdits: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    borderLeftWidth: 1,
    borderLeftColor: palette.glass.edge,
    paddingLeft: 12
  },
  history: {
    marginLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  editor: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    backgroundColor: palette.glass.card,
    gap: 12
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  stepperLabel: { flex: 1, minWidth: 0, fontSize: 13 },
  value: { minWidth: 24, textAlign: "center", fontSize: 16 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
