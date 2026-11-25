import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
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
function DurationGlyph({
  denominator,
  selected
}: {
  denominator: number;
  selected: boolean;
}) {
  const color = selected ? palette.gold.ink : palette.notation.text;
  const whole = denominator === 1;
  const flags = Math.max(0, Math.log2(denominator) - 2);
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}>
      <Ellipse
        cx={whole ? 12 : 8}
        cy={whole ? 15 : 19}
        rx={whole ? 5 : 4.5}
        ry={3}
        transform={`rotate(-18 ${whole ? 12 : 8} ${whole ? 15 : 19})`}
        fill={[1, 2].includes(denominator) ? "none" : color}
        stroke={color}
        strokeWidth={1.5}
      />
      {!whole && <Path d="M12 18V2" stroke={color} strokeWidth={1.5} />}
      {Array.from({ length: flags }, (_, index) => (
        <Path
          key={index}
          d={`M12 ${2 + index * 3}C14 ${7 + index * 3} 23 ${5 + index * 3} 18 ${10 + index * 3}`}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
        />
      ))}
    </Svg>
  );
}
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
  const [showStringChoices, setShowStringChoices] = useState(false);
  const [moreTechniques, setMoreTechniques] = useState(false);
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
  const convertToRest = () => {
    if (readOnly || selectedRest) return;
    const notes = tab.notes.filter((note) => !scopedNotes.includes(note));
    const at = selected && editScope === "bar" ? bar * barTicks : position;
    const restDuration =
      selected && editScope === "bar"
        ? barTicks
        : Math.max(duration, ...scopedNotes.map(tabNoteDuration));
    if (
      apply(putTabRest({ ...tab, notes }, { tick: at, duration: restDuration }))
    ) {
      cancelPreview();
      setSelection(null);
      setRestSelection(at);
    }
  };
  const addOrSelectNote = () => {
    if (readOnly || selected) return;
    const next = { ...insertSettings, ...cursor, fret: insertFret, duration };
    if (selectedRest) {
      if (
        apply(
          putTabNote(
            {
              ...tab,
              rests: (tab.rests ?? []).filter((rest) => rest !== selectedRest)
            },
            next
          )
        )
      ) {
        setSelection(next);
        setRestSelection(null);
        preview(next);
      }
    } else insert(putTabNote(tab, next), cursor.tick, insertDuration);
  };
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
                landscapeOnly
                subtitle={
                  editorSection === "note"
                    ? `${t("TabNotePosition", { bar: Math.floor(position / barTicks) + 1, beat: Number((1 + (position % barTicks) / beatTicks).toFixed(2)) })} · ${selectedRest ? t("TabEditRest") : `${t("TabString")}: ${6 - cursor.string} · ${t("TabFret")}: ${selected?.fret ?? insertFret}`}`
                    : undefined
                }
                maxWidth={editorSection === "note" ? 720 : 600}
                scrollKey={editorSection === "note" ? noteTab : undefined}
                toolbar={
                  editorSection === "note" && (
                    <View style={styles.notationTabs}>
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
                            icon: "gesture-tap"
                          },
                          {
                            key: "dynamics",
                            label: "TabDynamics",
                            icon: "tune-vertical"
                          }
                        ] as const
                      ).map(({ key, label, icon }) => (
                        <Action
                          key={key}
                          notation
                          style={styles.notationTab}
                          accessibilityRole="tab"
                          label={t(label)}
                          icon={icon}
                          showLabel
                          selected={noteTab === key}
                          onPress={() => setNoteTab(key)}
                        />
                      ))}
                    </View>
                  )
                }
                title={t(
                  sections.find((section) => section.key === editorSection)!
                    .label
                )}
                headerAccessory={
                  editorSection === "note" && (
                    <View style={styles.notationScope}>
                      {(
                        [
                          {
                            key: "note",
                            label: "TabNoteTab",
                            accessible: "TabScopeNote"
                          },
                          {
                            key: "chord",
                            label: "TabScopeChord",
                            accessible: "TabScopeChord"
                          },
                          {
                            key: "bar",
                            label: "TabScopeSelection",
                            accessible: "TabScopeSelection"
                          }
                        ] as const
                      ).map(({ key, label, accessible }) => (
                        <Action
                          key={key}
                          notation
                          style={styles.notationFlex}
                          label={t(label)}
                          accessibilityLabel={t(accessible)}
                          selected={editScope === key}
                          disabled={readOnly || !!selectedRest}
                          onPress={() => setEditScope(key)}
                        />
                      ))}
                    </View>
                  )
                }
                footer={
                  editorSection === "note" && (
                    <View style={styles.notationFooter}>
                      <View style={styles.notationFooterGroup}>
                        <Action
                          notation
                          style={styles.notationFooterButton}
                          label={`↶ ${t("TabUndo")}`}
                          accessibilityLabel={t("TabUndo")}
                          disabled={readOnly || !transport.canUndo}
                          onPress={() => {
                            cancelPreview();
                            transport.undo();
                          }}
                        />
                        <Action
                          notation
                          style={styles.notationFooterButton}
                          label={`↷ ${t("TabRedo")}`}
                          accessibilityLabel={t("TabRedo")}
                          disabled={readOnly || !transport.canRedo}
                          onPress={() => {
                            cancelPreview();
                            transport.redo();
                          }}
                        />
                      </View>
                      <View style={styles.notationFooterGroup}>
                        <Action
                          notation
                          label={`${previewEnabled ? "◖" : "◌"} ${t(previewEnabled ? "TabSoundOnShort" : "TabSoundOffShort")}`}
                          accessibilityLabel={t("TabSoundOn")}
                          onPress={() => {
                            cancelPreview();
                            setPreviewEnabled(!previewEnabled);
                          }}
                        />
                        <Action
                          notation
                          label={`▶ ${t("TabPreviewNote")}`}
                          accessibilityLabel={t("TabPreviewNote")}
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
                      <Action
                        notation
                        primary
                        style={styles.notationDone}
                        label={`✓ ${t("Done")}`}
                        accessibilityLabel={t("Done")}
                        onPress={() => setEditorSection("score")}
                      />
                    </View>
                  )
                }
                onClose={() => setEditorSection("score")}
              >
                {editorSection === "note" && (
                  <>
                    <StatusBar hidden />
                    {editError && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.error}
                      >
                        {t(editError)}
                      </Text>
                    )}
                    <View style={styles.notationColumns}>
                      {noteTab === "note" && (
                        <View style={styles.notationGroups}>
                          <View
                            style={[
                              styles.notationColumn,
                              styles.notationPrimary
                            ]}
                          >
                            <Text style={styles.notationHeading}>
                              {t("TabNoteRhythm")}
                            </Text>
                            <View style={styles.notationRow}>
                              <Action
                                notation
                                label="‹"
                                accessibilityLabel={t("TabNoteEarlier")}
                                style={styles.notationArrow}
                                disabled={readOnly || position === 0}
                                onPress={() =>
                                  shiftPosition(Math.max(0, position - grid))
                                }
                              />
                              <Action
                                notation
                                label={`${t("TabString")} ${6 - cursor.string} ⌄`}
                                accessibilityLabel={t("TabChooseStringMenu")}
                                style={styles.notationFlex}
                                selected={showStringChoices}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  setShowStringChoices(!showStringChoices)
                                }
                              />
                              <View style={styles.notationFret}>
                                <Action
                                  notation
                                  label="−"
                                  accessibilityLabel={`${t("TabFret")}: −`}
                                  style={styles.notationSmall}
                                  disabled={
                                    readOnly ||
                                    !!selectedRest ||
                                    (selected?.fret ?? insertFret) === 0
                                  }
                                  onPress={() =>
                                    selected
                                      ? changeNote({ fret: selected.fret - 1 })
                                      : setInsertFret((fret) =>
                                          Math.max(0, fret - 1)
                                        )
                                  }
                                />
                                <Text
                                  numberOfLines={1}
                                  style={styles.notationText}
                                >
                                  {t("TabFret")} {selected?.fret ?? insertFret}
                                </Text>
                                <Action
                                  notation
                                  label="+"
                                  accessibilityLabel={`${t("TabFret")}: +`}
                                  style={styles.notationSmall}
                                  disabled={
                                    readOnly ||
                                    !!selectedRest ||
                                    (selected?.fret ?? insertFret) === 24
                                  }
                                  onPress={() =>
                                    selected
                                      ? changeNote({ fret: selected.fret + 1 })
                                      : setInsertFret((fret) =>
                                          Math.min(24, fret + 1)
                                        )
                                  }
                                />
                              </View>
                              <Action
                                notation
                                label="›"
                                accessibilityLabel={t("TabNoteLater")}
                                style={styles.notationArrow}
                                disabled={
                                  readOnly ||
                                  position + grid >= tablatureLength(tab)
                                }
                                onPress={() => shiftPosition(position + grid)}
                              />
                            </View>
                            {showStringChoices && (
                              <View style={styles.notationRow}>
                                {[1, 2, 3, 4, 5, 6].map((value) => (
                                  <Action
                                    key={value}
                                    notation
                                    style={styles.notationFlex}
                                    label={String(value)}
                                    accessibilityLabel={t("TabChooseString", {
                                      string: value
                                    })}
                                    selected={6 - cursor.string === value}
                                    disabled={readOnly}
                                    onPress={() => {
                                      if (selected)
                                        changeNote({ string: 6 - value });
                                      else
                                        selectCell({
                                          ...cursor,
                                          string: 6 - value
                                        });
                                      setShowStringChoices(false);
                                    }}
                                  />
                                ))}
                              </View>
                            )}
                            <View style={styles.notationRow}>
                              <Action
                                notation
                                style={styles.notationShortFlex}
                                label={t("TabNoteTab")}
                                accessibilityLabel={t("TabAddNote")}
                                selected={
                                  !selectedRest &&
                                  noteSettings.accent !== "dead"
                                }
                                disabled={readOnly}
                                onPress={addOrSelectNote}
                              />
                              <Action
                                notation
                                style={styles.notationShortFlex}
                                label={`𝄽 ${t("TabRestShort")}`}
                                accessibilityLabel={t("TabAddRest")}
                                selected={!!selectedRest}
                                disabled={readOnly}
                                onPress={convertToRest}
                              />
                              <Action
                                notation
                                style={styles.notationShortFlex}
                                label="×"
                                accessibilityLabel={t("TabDeadNote")}
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
                            <View style={styles.notationDurationGrid}>
                              {durationChoices.map((denominator) => (
                                <Action
                                  key={denominator}
                                  notation
                                  showLabel
                                  icon={
                                    <DurationGlyph
                                      denominator={denominator}
                                      selected={
                                        parts?.denominator === denominator
                                      }
                                    />
                                  }
                                  style={styles.notationDurationChoice}
                                  label={`1/${denominator}`}
                                  accessibilityLabel={t("TabDurationChoice", {
                                    denominator
                                  })}
                                  selected={parts?.denominator === denominator}
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
                              ))}
                            </View>
                            <View style={styles.notationRow}>
                              <Text style={styles.notationLabel}>
                                {t("TabRhythmShort")}
                              </Text>
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
                                  notation
                                  style={styles.notationMiniFlex}
                                  label={text}
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
                                notation
                                label="⋯"
                                accessibilityLabel={t("TabMoreOptions")}
                                style={styles.notationSmall}
                                selected={noteDetails}
                                onPress={() => setNoteDetails(!noteDetails)}
                              />
                            </View>
                            {noteDetails && (
                              <View style={styles.notationAdvanced}>
                                <Text style={styles.notationLabel}>
                                  {t("TabCustomTuplet")}
                                </Text>
                                <View style={styles.notationRow}>
                                  <Action
                                    notation
                                    label={`${tupletActual}:${tupletNormal}`}
                                    style={styles.notationFlex}
                                    onPress={() =>
                                      setTupletActual(
                                        tupletActual === 16
                                          ? 2
                                          : tupletActual + 1
                                      )
                                    }
                                  />
                                  <Action
                                    notation
                                    label={`${t("TabTupletNormal")}: ${tupletNormal}`}
                                    style={styles.notationFlex}
                                    onPress={() =>
                                      setTupletNormal(
                                        tupletNormal === 16
                                          ? 1
                                          : tupletNormal + 1
                                      )
                                    }
                                  />
                                  <Action
                                    notation
                                    label={t("Apply")}
                                    style={styles.notationFlex}
                                    disabled={readOnly}
                                    onPress={() =>
                                      changeDuration(
                                        Math.round(
                                          ((durationTicks(
                                            selected?.tuplet?.denominator ??
                                              parts?.denominator ??
                                              4
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
                                <Text style={styles.notationLabel}>
                                  {t("TabGrid")}
                                </Text>
                                <View style={styles.notationWrap}>
                                  {[24, 12, 6, 3, 1.5, 0.75, 8, 4].map(
                                    (step) => (
                                      <Action
                                        key={step}
                                        notation
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
                                  notation
                                  label={t("TabAdvanceCursor")}
                                  selected={advanceCursor}
                                  disabled={readOnly}
                                  onPress={() =>
                                    setAdvanceCursor(!advanceCursor)
                                  }
                                />
                              </View>
                            )}
                            <View style={styles.notationRow}>
                              <Action
                                notation
                                style={styles.notationShortFlex}
                                label={`${t("TabTie")} ⌒`}
                                accessibilityLabel={t("TabTie")}
                                selected={!!noteSettings.tie}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({ tie: !noteSettings.tie })
                                }
                              />
                              <Action
                                notation
                                style={styles.notationShortFlex}
                                label={`${t("TabFermata")} 𝄐`}
                                accessibilityLabel={t("TabFermata")}
                                selected={!!noteSettings.fermata}
                                disabled={readOnly || !!selectedRest}
                                onPress={() =>
                                  patchSettings({
                                    fermata: !noteSettings.fermata
                                  })
                                }
                              />
                            </View>
                          </View>
                          <View style={styles.notationColumn}>
                            <View style={styles.notationRow}>
                              <Text style={styles.notationLabel}>
                                {t("TabVoice")}
                              </Text>
                              {[1, 2, 3, 4].map((voice) => (
                                <Action
                                  key={voice}
                                  notation
                                  style={styles.notationMiniFlex}
                                  label={String(voice)}
                                  accessibilityLabel={t("TabVoiceChoice", {
                                    voice
                                  })}
                                  selected={(noteSettings.voice ?? 1) === voice}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() => patchSettings({ voice })}
                                />
                              ))}
                            </View>
                            <Text style={styles.notationHeading}>
                              {t("TabPickingFingering")}
                            </Text>
                            <View style={styles.notationRow}>
                              {(
                                [
                                  { key: "down", symbol: "Π" },
                                  { key: "up", symbol: "V" },
                                  { key: "downBrush", symbol: "↓" },
                                  { key: "upBrush", symbol: "↑" },
                                  { key: "arpeggio", symbol: "⌒" }
                                ] as const
                              ).map(({ key, symbol }) => (
                                <Action
                                  key={key}
                                  notation
                                  showLabel
                                  style={styles.notationFlex}
                                  icon={
                                    <Text
                                      style={[
                                        styles.notationGlyph,
                                        noteSettings.pick === key &&
                                          styles.notationGlyphSelected
                                      ]}
                                    >
                                      {symbol}
                                    </Text>
                                  }
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
                            <View style={styles.notationRow}>
                              <Text style={styles.notationLabel}>
                                {t("TabLeftShort")}
                              </Text>
                              {[1, 2, 3, 4].map((finger) => (
                                <Action
                                  key={finger}
                                  notation
                                  style={styles.notationMiniFlex}
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
                            <View style={styles.notationRow}>
                              <Text style={styles.notationLabel}>
                                {t("TabRightShort")}
                              </Text>
                              {(["p", "i", "m", "a", "c"] as const).map(
                                (finger) => (
                                  <Action
                                    key={finger}
                                    notation
                                    style={styles.notationMiniFlex}
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
                          </View>
                        </View>
                      )}
                      {noteTab === "technique" && (
                        <View style={styles.notationColumn}>
                          <View style={styles.notationRow}>
                            <Text
                              style={[
                                styles.notationHeading,
                                styles.notationFlex
                              ]}
                            >
                              {t("TabPlayingTechniques")}
                            </Text>
                            <Action
                              notation
                              style={styles.notationSmall}
                              label="⋯"
                              accessibilityLabel={t("TabExtraTechniques")}
                              selected={moreTechniques}
                              onPress={() => setMoreTechniques(!moreTechniques)}
                            />
                          </View>
                          <View style={styles.notationTechniqueGrid}>
                            {(
                              [
                                "hammerOn",
                                "pullOff",
                                "slide",
                                "bend",
                                "vibrato",
                                "palmMute",
                                "letRing",
                                "harmonic",
                                "tapping",
                                "tremolo",
                                "trill",
                                "whammy",
                                "grace",
                                "slap",
                                "rasgueado"
                              ] as const
                            ).map((technique) => {
                              const chosen =
                                technique === "slap"
                                  ? noteSettings.techniques?.some((entry) =>
                                      ["slap", "pop"].includes(entry)
                                    )
                                  : noteSettings.techniques?.includes(
                                      technique
                                    );
                              const symbol = {
                                hammerOn: "H",
                                pullOff: "P",
                                slide: "↗",
                                bend: "⤴",
                                vibrato: "∿",
                                palmMute: "♧",
                                letRing: "∞",
                                harmonic: "◇",
                                tapping: "T",
                                tremolo: "///",
                                trill: "tr",
                                whammy: "↝",
                                grace: "♪",
                                slap: "♧",
                                rasgueado: "⇈"
                              }[technique];
                              return (
                                <Action
                                  key={technique}
                                  notation
                                  showLabel
                                  style={[
                                    styles.notationTechniqueChoice,
                                    styles.notationTechniqueCompact
                                  ]}
                                  icon={
                                    ["palmMute", "slap"].includes(technique) ? (
                                      techniqueIcons[technique]
                                    ) : (
                                      <Text
                                        style={[
                                          styles.notationGlyph,
                                          chosen && styles.notationGlyphSelected
                                        ]}
                                      >
                                        {symbol}
                                      </Text>
                                    )
                                  }
                                  label={
                                    technique === "slap"
                                      ? t(
                                          noteSettings.techniques?.includes(
                                            "pop"
                                          )
                                            ? "TabTechnique_pop"
                                            : noteSettings.techniques?.includes(
                                                  "slap"
                                                )
                                              ? "TabTechnique_slap"
                                              : "TabSlapPop"
                                        )
                                      : t(`TabTechnique_${technique}`)
                                  }
                                  accessibilityLabel={t(
                                    `TabTechnique_${technique}`
                                  )}
                                  selected={chosen}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() => {
                                    if (technique !== "slap") {
                                      toggleTechnique(technique);
                                      return;
                                    }
                                    const base = (
                                      noteSettings.techniques ?? []
                                    ).filter(
                                      (entry) =>
                                        !["slap", "pop"].includes(entry)
                                    );
                                    patchSettings({
                                      techniques:
                                        noteSettings.techniques?.includes(
                                          "slap"
                                        )
                                          ? [...base, "pop"]
                                          : noteSettings.techniques?.includes(
                                                "pop"
                                              )
                                            ? base
                                            : [...base, "slap"]
                                    });
                                  }}
                                />
                              );
                            })}
                          </View>
                          {noteSettings.techniques?.includes("bend") && (
                            <View style={styles.notationBend}>
                              <View style={styles.notationRow}>
                                <Text style={styles.notationHeading}>
                                  {t("TabTechnique_bend")}
                                </Text>
                                {([0.5, 1, 1.5] as const).map((bend) => (
                                  <Action
                                    key={bend}
                                    notation
                                    style={styles.notationFlex}
                                    label={`${{ 0.5: "½", 1: "1", 1.5: "1½" }[bend]} ${t("TabTone")}`}
                                    accessibilityLabel={`${bend} ${t("TabTone")}`}
                                    selected={(noteSettings.bend ?? 1) === bend}
                                    disabled={readOnly}
                                    onPress={() => patchSettings({ bend })}
                                  />
                                ))}
                              </View>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("TabBendRelease")}
                                accessibilityState={{
                                  selected: !!noteSettings.bendRelease,
                                  disabled: readOnly
                                }}
                                disabled={readOnly}
                                onPress={() =>
                                  patchSettings({
                                    bendRelease: !noteSettings.bendRelease
                                  })
                                }
                              >
                                <Text style={styles.notationLabel}>
                                  {t("TabBendRelease")}
                                </Text>
                                <Svg
                                  width="100%"
                                  height={42}
                                  viewBox="0 0 300 50"
                                  accessible
                                  accessibilityLabel={t("TabBendCurve")}
                                >
                                  <Path
                                    d="M22 28H292M22 8V46"
                                    stroke={palette.notation.plotLine}
                                    fill="none"
                                    strokeWidth={1}
                                  />
                                  <SvgText
                                    x={2}
                                    y={14}
                                    fill={palette.notation.muted}
                                    fontSize={9}
                                  >
                                    +1
                                  </SvgText>
                                  <SvgText
                                    x={4}
                                    y={31}
                                    fill={palette.notation.muted}
                                    fontSize={9}
                                  >
                                    0
                                  </SvgText>
                                  <SvgText
                                    x={2}
                                    y={46}
                                    fill={palette.notation.muted}
                                    fontSize={9}
                                  >
                                    −1
                                  </SvgText>
                                  <Path
                                    d={
                                      noteSettings.bendRelease
                                        ? "M22 28C90 28 112 10 158 10S226 28 292 28"
                                        : "M22 28C90 28 112 10 158 10H292"
                                    }
                                    stroke={palette.notation.plotGold}
                                    fill="none"
                                    strokeWidth={2}
                                  />
                                  {[
                                    { x: 22, y: 28 },
                                    { x: 158, y: 10 },
                                    {
                                      x: 292,
                                      y: noteSettings.bendRelease ? 28 : 10
                                    }
                                  ].map(({ x, y }) => (
                                    <Ellipse
                                      key={x}
                                      cx={x}
                                      cy={y}
                                      rx={3.5}
                                      ry={3.5}
                                      fill={palette.notation.plotGold}
                                    />
                                  ))}
                                </Svg>
                              </Pressable>
                            </View>
                          )}

                          {moreTechniques && (
                            <View style={styles.notationWrap}>
                              {(
                                [
                                  "mordent",
                                  "turn",
                                  "golpe",
                                  "pickScrape"
                                ] as const
                              ).map((technique) => (
                                <Action
                                  key={technique}
                                  notation
                                  icon={techniqueIcons[technique]}
                                  showLabel
                                  label={t(`TabTechnique_${technique}`)}
                                  selected={noteSettings.techniques?.includes(
                                    technique
                                  )}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() => toggleTechnique(technique)}
                                />
                              ))}
                              {noteSettings.techniques?.includes("bend") &&
                                [2, 2.5, 3].map((bend) => (
                                  <Action
                                    key={bend}
                                    notation
                                    label={`${bend} ${t("TabTone")}`}
                                    selected={noteSettings.bend === bend}
                                    disabled={readOnly}
                                    onPress={() => patchSettings({ bend })}
                                  />
                                ))}
                            </View>
                          )}
                          {noteSettings.techniques?.some((technique) =>
                            ["slide", "grace", "hammerOn", "pullOff"].includes(
                              technique
                            )
                          ) && (
                            <View style={styles.notationRow}>
                              <Text style={styles.notationLabel}>
                                {t("TabSourceFret")}:{" "}
                                {noteSettings.sourceFret ??
                                  Math.max(
                                    0,
                                    (selected?.fret ?? insertFret) - 2
                                  )}
                              </Text>
                              {[-1, 1].map((delta) => (
                                <Action
                                  key={delta}
                                  notation
                                  label={delta > 0 ? "+" : "−"}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() =>
                                    patchSettings({
                                      sourceFret: Math.max(
                                        0,
                                        Math.min(
                                          24,
                                          (noteSettings.sourceFret ??
                                            Math.max(
                                              0,
                                              (selected?.fret ?? insertFret) - 2
                                            )) + delta
                                        )
                                      )
                                    })
                                  }
                                />
                              ))}
                            </View>
                          )}
                        </View>
                      )}
                      {noteTab === "dynamics" && (
                        <View style={styles.notationGroups}>
                          <View
                            style={[
                              styles.notationColumn,
                              styles.notationPrimary
                            ]}
                          >
                            <Text style={styles.notationHeading}>
                              {t("TabDynamics")}
                            </Text>
                            <View style={styles.notationRow}>
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
                                <Action
                                  key={name}
                                  notation
                                  style={styles.notationDynamic}
                                  label={name}
                                  icon={
                                    <Text
                                      numberOfLines={1}
                                      style={[
                                        styles.notationDynamicMark,
                                        (noteSettings.velocity ?? 64) ===
                                          value && styles.notationGlyphSelected
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
                              ))}
                            </View>
                            <ExpressionSlider
                              label={t("TabAttack")}
                              value={noteSettings.velocity ?? 64}
                              min={1}
                              max={127}
                              disabled={readOnly || !!selectedRest}
                              onChange={(velocity) =>
                                patchSettings({ velocity })
                              }
                            />
                            <View style={styles.notationTechniqueGrid}>
                              {(
                                [
                                  {
                                    key: "accent",
                                    label: "TabAccent",
                                    symbol: ">"
                                  },
                                  {
                                    key: "strong",
                                    label: "TabStrongAccent",
                                    symbol: ">>"
                                  },
                                  {
                                    key: "staccato",
                                    label: "TabStaccato",
                                    symbol: "•"
                                  },
                                  {
                                    key: "ghost",
                                    label: "TabGhostNote",
                                    symbol: "(♪)"
                                  }
                                ] as const
                              ).map(({ key, label, symbol }) => (
                                <Action
                                  key={key}
                                  notation
                                  showLabel
                                  style={styles.notationTechniqueChoice}
                                  icon={
                                    <Text
                                      style={[
                                        styles.notationGlyph,
                                        noteSettings.accent === key &&
                                          styles.notationGlyphSelected
                                      ]}
                                    >
                                      {symbol}
                                    </Text>
                                  }
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
                              {(
                                [
                                  { key: "crescendo", symbol: "<" },
                                  { key: "diminuendo", symbol: ">" }
                                ] as const
                              ).map(({ key, symbol }) => (
                                <Action
                                  key={key}
                                  notation
                                  showLabel
                                  style={styles.notationTechniqueChoice}
                                  icon={
                                    <Text
                                      style={[
                                        styles.notationGlyph,
                                        noteSettings.fade === key &&
                                          styles.notationGlyphSelected
                                      ]}
                                    >
                                      {symbol}
                                    </Text>
                                  }
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
                            <View style={styles.notationRow}>
                              {(["in", "out"] as const).map((fade) => (
                                <Action
                                  key={fade}
                                  notation
                                  style={styles.notationFlex}
                                  label={`${fade === "in" ? "▁▂▃" : "▃▂▁"} ${t(`TabFade_${fade}`)}`}
                                  selected={noteSettings.fade === fade}
                                  disabled={readOnly || !!selectedRest}
                                  onPress={() =>
                                    patchSettings({
                                      fade:
                                        noteSettings.fade === fade
                                          ? undefined
                                          : fade
                                    })
                                  }
                                />
                              ))}
                            </View>
                          </View>
                          <View style={styles.notationColumn}>
                            <Text
                              style={[
                                styles.notationHeading,
                                styles.notationEditHeading
                              ]}
                            >
                              {t("TabEditSelection")}
                            </Text>
                            <View style={styles.notationTechniqueGrid}>
                              {[
                                {
                                  label: "TabCopyNotes",
                                  action: () => saveNotesToClipboard(),
                                  disabled: !scopedNotes.length
                                },
                                {
                                  label: "TabCutNotes",
                                  action: () => saveNotesToClipboard(true),
                                  disabled: !scopedNotes.length
                                },
                                {
                                  label: "TabPasteNotes",
                                  action: () => pasteNotes(),
                                  disabled: !noteClipboard?.length
                                },
                                {
                                  label: "TabDuplicateNotes",
                                  action: () => pasteNotes(true),
                                  disabled: !scopedNotes.length
                                },
                                {
                                  label: "TabToRest",
                                  action: convertToRest,
                                  disabled: !selected
                                },
                                {
                                  label: "TabDeleteNote",
                                  action: removeSelection,
                                  disabled: !selected && !selectedRest
                                }
                              ].map(
                                ({ label, action, disabled: unavailable }) => (
                                  <Action
                                    key={label}
                                    notation
                                    style={styles.notationTechniqueChoice}
                                    label={t(label)}
                                    disabled={readOnly || unavailable}
                                    onPress={action}
                                  />
                                )
                              )}
                            </View>
                            <View style={styles.notationRow}>
                              <View style={styles.notationTranspose}>
                                <Text style={styles.notationLabel}>
                                  {t("Transpose")}
                                </Text>
                                {[-1, 1].map((delta) => (
                                  <Action
                                    key={delta}
                                    notation
                                    label={delta > 0 ? "+1" : "−1"}
                                    disabled={readOnly || !scopedNotes.length}
                                    onPress={() => transposeNotes(delta)}
                                  />
                                ))}
                              </View>
                              <Action
                                notation
                                style={styles.notationFlex}
                                label={`◇ ${t("TabClearEffects")}`}
                                accessibilityLabel={t("TabClearEffects")}
                                disabled={readOnly || !!selectedRest}
                                onPress={clearNoteEffects}
                              />
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  </>
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
  notationTabs: {
    flexDirection: "row",
    paddingHorizontal: 9,
    paddingVertical: 5,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.notation.divider
  },
  notationTab: { width: 112, flexDirection: "row", gap: 6 },
  notationGroups: { flex: 1, flexDirection: "row", gap: 8 },
  notationPrimary: { flex: 1.35 },
  notationColumns: { flexDirection: "row", alignItems: "stretch" },
  notationColumn: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingTop: 5,
    paddingBottom: 7,
    gap: 3,
    backgroundColor: palette.notation.background
  },
  notationHeading: {
    color: palette.notation.gold,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "600"
  },
  notationLabel: { color: palette.notation.label, fontSize: 9, lineHeight: 12 },
  notationText: {
    color: palette.notation.text,
    fontSize: 9,
    lineHeight: 12,
    flexShrink: 1
  },
  notationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  notationWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  notationFlex: { flex: 1, minWidth: 0, width: undefined },
  notationShortFlex: {
    flex: 1,
    minWidth: 0,
    width: undefined,
    height: 20,
    minHeight: 20
  },
  notationMiniFlex: {
    flex: 1,
    minWidth: 0,
    width: undefined,
    height: 18,
    minHeight: 18,
    paddingHorizontal: 2
  },
  notationSmall: {
    width: 20,
    minWidth: 0,
    paddingHorizontal: 0,
    height: 22,
    minHeight: 22
  },
  notationArrow: { width: 20, minWidth: 0, paddingHorizontal: 0 },
  notationFret: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: 80,
    gap: 1,
    borderWidth: 1,
    borderColor: palette.notation.edge,
    borderRadius: 7,
    backgroundColor: palette.notation.control
  },
  notationDurationGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  notationDurationChoice: { flexBasis: "10%", flexGrow: 1, minWidth: 32 },
  notationTechniqueGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  notationTechniqueChoice: { flexBasis: "30%", flexGrow: 1, minWidth: 0 },
  notationTechniqueCompact: { flexBasis: "18%", flexGrow: 0, minWidth: 80 },
  notationGlyph: {
    color: palette.notation.text,
    fontSize: 17,
    lineHeight: 18,
    textAlign: "center"
  },
  notationGlyphSelected: { color: palette.gold.ink },
  notationDynamicMark: {
    color: palette.notation.text,
    fontSize: 9,
    lineHeight: 12,
    textAlign: "center"
  },
  notationDynamic: {
    flex: 1,
    minWidth: 0,
    width: undefined,
    height: 22,
    minHeight: 22,
    paddingHorizontal: 0
  },
  notationScope: { flexDirection: "row", width: 182, gap: 0 },
  notationBend: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "flex-start",
    padding: 5,
    gap: 4,
    marginTop: 1,
    borderWidth: 1,
    borderColor: palette.notation.edge,
    borderRadius: 8,
    backgroundColor: palette.notation.raised
  },
  notationAdvanced: {
    gap: 4,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: palette.notation.edge
  },
  notationEditHeading: { marginBottom: 1 },
  notationTranspose: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    gap: 2,
    borderWidth: 1,
    borderColor: palette.notation.edge,
    borderRadius: 7,
    paddingHorizontal: 2
  },
  notationFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: palette.notation.header,
    borderTopWidth: 1,
    borderTopColor: palette.notation.border
  },
  notationFooterGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  notationFooterButton: { minWidth: 68 },
  notationDone: { minWidth: 86, height: 26, minHeight: 26 },
  expressionSlider: { flexDirection: "row", alignItems: "center", gap: 6 },
  expressionLabel: {
    color: palette.notation.label,
    fontSize: 9,
    lineHeight: 12
  },
  sliderTouch: {
    flex: 1,
    height: 24,
    justifyContent: "center",
    marginHorizontal: 4
  },
  sliderTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.notation.track
  },
  sliderFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.notation.trackGold
  },
  sliderThumb: {
    position: "absolute",
    top: -4,
    marginLeft: -6,
    height: 12,
    width: 12,
    borderRadius: 6,
    backgroundColor: palette.notation.thumb
  },
  sliderValue: {
    minWidth: 34,
    height: 20,
    textAlign: "center",
    color: palette.notation.text,
    fontSize: 10,
    lineHeight: 17,
    borderWidth: 1,
    borderColor: palette.notation.edge,
    borderRadius: 6
  },
  noteSymbol: { color: palette.glass.accent, fontSize: 9, lineHeight: 11 },
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
