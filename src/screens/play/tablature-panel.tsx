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
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  TAB_MAX_BARS,
  tabBarTicks,
  tabBeatTicks,
  tabNoteDuration,
  TabNote,
  TabRest,
  Tablature,
  tablatureLength
} from "../../components/tablature";
import palette from "../../theme/palette";
import { Action, Sheet } from "../song/tools";
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
const sameNote = (a: Selection | null, b: Selection) =>
  a?.string === b.string && a.tick === b.tick;

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
  const { columns, notes, rests } = useMemo(() => {
    const times = new Set(
      Array.from(
        { length: Math.ceil(barTicks / (editable ? grid : beatTicks)) },
        (_, position) => start + position * (editable ? grid : beatTicks)
      )
    );
    // Insertion advances by note duration, which need not match the grid.
    if (
      editable &&
      selectedTick !== null &&
      selectedTick >= start &&
      selectedTick < start + barTicks
    )
      times.add(selectedTick);
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
      columns: [...times].sort((a, b) => a - b),
      notes: entries,
      rests: pauses
    };
  }, [tab, start, barTicks, beatTicks, editable, grid, selectedTick]);
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
            <View style={styles.barLine} />
            <View style={styles.barLine} />
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
                          {continued ? "↳" : note.fret}
                        </Text>
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

export function TablatureBar(props: React.ComponentProps<typeof TablatureStaff>) {
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
    "score" | "note" | "bars" | "playback" | "loop"
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
  const [highFrets, setHighFrets] = useState(false);
  const fretInput = useRef<{
    string: number;
    tick: number;
    fret: number;
    time: number;
  } | null>(null);
  const sections = [
    { key: "note", label: "TabScore", icon: "music-note-eighth" },
    { key: "bars", label: "TabBars", icon: "view-column-outline" },
    { key: "playback", label: "TabTempoShort", icon: "metronome" },
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
    setHighFrets(note.fret > 12);
    if (readOnly) return;
    transport.pause();
    setSelection(note);
    setRestSelection(null);
    setInsertFret(note.fret);
    setPage(Math.floor(note.tick / barTicks));
    setEditError(null);
  };
  const selectCell = (cell: Selection) => {
    fretInput.current = null;
    setHighFrets(insertFret > 12);
    if (readOnly) return;
    transport.pause();
    setSelection(cell);
    setRestSelection(null);
    setEditError(null);
  };
  const selectRest = (rest: TabRest) => {
    fretInput.current = null;
    if (readOnly) return;
    transport.pause();
    setSelection(null);
    setRestSelection(rest.tick);
    setPage(Math.floor(rest.tick / barTicks));
    setEditError(null);
  };
  const closeEditor = () => {
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
    fretInput.current = null;
    if (selected)
      apply({
        tab: {
          ...tab,
          notes: tab.notes.filter((note) => note !== selected)
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
      ...cursor,
      fret,
      duration: selected ? tabNoteDuration(selected) : insertDuration
    };
    if (!apply(putTabNote(tab, next, selected))) return;
    setSelection(next);
    setRestSelection(null);
    setInsertFret(fret);
    setHighFrets(fret > 12);
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
      setSelection(next);
      setPage(Math.floor(next.tick / barTicks));
    }
  };
  const changeRest = (patch: Partial<TabRest>) => {
    if (!selectedRest || readOnly) return;
    const next = { ...selectedRest, ...patch };
    if (apply(putTabRest(tab, next, selectedRest.tick))) {
      setRestSelection(next.tick);
      setPage(Math.floor(next.tick / barTicks));
    }
  };
  const changeDuration = (next: number) => {
    if (readOnly) return;
    fretInput.current = null;
    if (selected) changeNote({ duration: next });
    else if (selectedRest) changeRest({ duration: next });
    else setEditError(null);
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
    transport.pause();
    setPage(next);
    setSelection({ ...cursor, tick: next * barTicks });
    setRestSelection(null);
    setEditError(null);
  };
  const firstBar = range ? Math.floor(range.start / barTicks) + 1 : 1;
  const lastBar = range ? Math.ceil(range.end / barTicks) : bars;
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
          if (standalone) {
            onPractice?.();
            return;
          }
          transport.rewind();
          setPage(firstBar - 1);
        }}
      />
      <Action
        glass
        compact={standalone}
        showLabel
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
          if (sounding) transport.pause();
          else void transport.play();
        }}
      />
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
            onPress={onToggle}
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
              <Action
                glass
                compact
                icon="close"
                label={t("Close")}
                onPress={closeEditor}
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
                  <Text style={styles.sectionTabText}>{t(section.label)}</Text>
                  <MaterialCommunityIcons
                    name="chevron-down"
                    size={16}
                    color={palette.glass.muted}
                  />
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
                    fretInput.current = null;
                    transport.redo();
                    setEditError(null);
                  }}
                />
                {pager}
              </View>
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
              <View style={styles.keypad}>
                <Text numberOfLines={1} style={styles.keypadCaption}>
                  {t("TabString")}: {6 - cursor.string} ·{" "}
                  {durationLabel(insertDuration)}
                </Text>
                <View style={styles.keypadGrid}>
                  {(
                    [1, 2, 3, 4, 5, 6, 7, 8, 9, "delete", 0, "next"] as const
                  ).map((key) => (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={
                        typeof key === "number"
                          ? `${t("TabFret")}: ${key}`
                          : t(
                              key === "delete"
                                ? "TabDeleteNote"
                                : "TabNextPosition"
                            )
                      }
                      disabled={
                        readOnly ||
                        (key === "delete" && !selected && !selectedRest) ||
                        (key === "next" &&
                          position + insertDuration >= TAB_MAX_BARS * barTicks)
                      }
                      onPress={() =>
                        typeof key === "number"
                          ? enterFret(key)
                          : key === "delete"
                            ? removeSelection()
                            : nextPosition()
                      }
                      style={({ pressed }) => [
                        styles.keypadKey,
                        pressed && styles.keypadPressed,
                        readOnly && styles.keypadDisabled
                      ]}
                    >
                      {typeof key === "number" ? (
                        <Text style={styles.keypadDigit}>{key}</Text>
                      ) : (
                        <MaterialCommunityIcons
                          name={
                            key === "delete"
                              ? "backspace-outline"
                              : "arrow-right"
                          }
                          size={22}
                          color={palette.glass.accent}
                        />
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            {editorSection !== "score" && (
              <Sheet
                compact
                landscapeOnly
                maxWidth={editorSection === "note" ? 500 : 600}
                title={t(
                  sections.find((section) => section.key === editorSection)!
                    .label
                )}
                onClose={() => setEditorSection("score")}
              >
                {editorSection === "note" && (
                  <View style={[styles.editor, styles.noteEditor]}>
                    <Text style={styles.caption}>
                      {t("TabString")}: {6 - cursor.string} ·{" "}
                      {t("TabNotePosition", {
                        bar: Math.floor(position / barTicks) + 1,
                        beat: Number(
                          (1 + (position % barTicks) / beatTicks).toFixed(2)
                        )
                      })}
                    </Text>
                    {!selectedRest && (
                      <View style={styles.options}>
                        {Array.from(
                          { length: highFrets ? 12 : 13 },
                          (_, index) => (highFrets ? index + 13 : index)
                        ).map((fret) => (
                          <Action
                            key={fret}
                            glass
                            compact
                            label={String(fret)}
                            accessibilityLabel={`${t("TabFret")}: ${fret}`}
                            selected={(selected?.fret ?? insertFret) === fret}
                            disabled={readOnly}
                            onPress={() =>
                              selected
                                ? changeNote({ fret })
                                : setInsertFret(fret)
                            }
                          />
                        ))}
                        <Action
                          glass
                          compact
                          label={highFrets ? "0–12" : "13–24"}
                          onPress={() => setHighFrets(!highFrets)}
                        />
                      </View>
                    )}
                    <View style={styles.options}>
                      {durationChoices.map((denominator) => (
                        <Action
                          key={denominator}
                          glass
                          compact
                          showLabel
                          icon={
                            {
                              1: "music-note-whole",
                              2: "music-note-half",
                              4: "music-note-quarter",
                              8: "music-note-eighth",
                              16: "music-note-sixteenth"
                            }[denominator]
                          }
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
                    {selected || selectedRest ? (
                      <Action
                        glass
                        label={t(selected ? "TabDeleteNote" : "TabDeleteRest")}
                        disabled={readOnly}
                        onPress={removeSelection}
                      />
                    ) : (
                      <>
                        <View style={styles.options}>
                          <Action
                            glass
                            primary
                            compact
                            label={t("TabAddNote")}
                            disabled={readOnly}
                            onPress={() => {
                              insert(
                                putTabNote(tab, {
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
                            label={t("TabAddRest")}
                            disabled={readOnly}
                            onPress={() => {
                              insert(
                                putTabRest(tab, {
                                  tick: cursor.tick,
                                  duration: insertDuration
                                }),
                                cursor.tick,
                                insertDuration,
                                true
                              );
                            }}
                          />
                        </View>
                      </>
                    )}

                    {editError && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.error}
                      >
                        {t(editError)}
                      </Text>
                    )}
                    <Action
                      glass
                      compact
                      label={t("TabMoreOptions")}
                      selected={noteDetails}
                      onPress={() => setNoteDetails(!noteDetails)}
                    />
                    {noteDetails && (
                      <>
                        {" "}
                        {!selectedRest && (
                          <Stepper
                            label={t("TabFret")}
                            value={selected?.fret ?? insertFret}
                            min={0}
                            max={24}
                            disabled={readOnly}
                            onChange={(fret) => {
                              if (selected) changeNote({ fret });
                              else setInsertFret(fret);
                            }}
                          />
                        )}
                        <View style={styles.stepper}>
                          <Text style={styles.stepperLabel}>
                            {t("TabNoteTime")}
                          </Text>
                          <Action
                            glass
                            icon="chevron-left"
                            label={t("TabNoteEarlier")}
                            disabled={readOnly || position === 0}
                            onPress={() =>
                              shiftPosition(Math.max(0, position - grid))
                            }
                          />
                          <Text style={styles.timeValue}>
                            {t("TabNotePosition", {
                              bar: Math.floor(position / barTicks) + 1,
                              beat: Number(
                                (1 + (position % barTicks) / beatTicks).toFixed(
                                  2
                                )
                              )
                            })}
                          </Text>
                          <Action
                            glass
                            icon="chevron-right"
                            label={t("TabNoteLater")}
                            disabled={
                              readOnly ||
                              position + grid >= TAB_MAX_BARS * barTicks ||
                              (!selected &&
                                !selectedRest &&
                                position + grid >= tablatureLength(tab))
                            }
                            onPress={() => shiftPosition(position + grid)}
                          />
                        </View>
                        {!selectedRest && (
                          <Stepper
                            label={t("TabString")}
                            value={6 - cursor.string}
                            min={1}
                            max={6}
                            disabled={readOnly}
                            onChange={(value) => {
                              if (selected) changeNote({ string: 6 - value });
                              else selectCell({ ...cursor, string: 6 - value });
                            }}
                          />
                        )}
                        <View style={styles.options}>
                          <Action
                            glass
                            label={t("TabDotted")}
                            selected={parts?.modifier === "dotted"}
                            disabled={readOnly}
                            onPress={() =>
                              changeDuration(
                                durationTicks(
                                  parts?.denominator ?? 4,
                                  parts?.modifier === "dotted"
                                    ? "plain"
                                    : "dotted"
                                )
                              )
                            }
                          />
                          <Action
                            glass
                            label={t("TabTriplet")}
                            selected={parts?.modifier === "triplet"}
                            disabled={readOnly}
                            onPress={() =>
                              changeDuration(
                                durationTicks(
                                  parts?.denominator ?? 4,
                                  parts?.modifier === "triplet"
                                    ? "plain"
                                    : "triplet"
                                )
                              )
                            }
                          />
                        </View>
                        <Action
                          glass
                          label={t("TabAdvanceCursor")}
                          selected={advanceCursor}
                          disabled={readOnly}
                          onPress={() => setAdvanceCursor((value) => !value)}
                        />
                        <Text style={styles.caption}>
                          {t("TabChordEntryHint")}
                        </Text>
                        <Text style={styles.caption}>{t("TabGrid")}</Text>
                        <View style={styles.options}>
                          {[24, 12, 6, 8, 4].map((step) => (
                            <Action
                              key={step}
                              glass
                              label={durationLabel(step)}
                              accessibilityLabel={t("TabGridValue", {
                                value: durationLabel(step)
                              })}
                              selected={grid === step}
                              disabled={readOnly}
                              onPress={() => setGrid(step)}
                            />
                          ))}
                        </View>
                      </>
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
                {editorSection === "playback" && (
                  <View style={styles.editor}>
                    <Stepper
                      label={t("TabQuarterTempo")}
                      value={tab.tempo}
                      min={40}
                      max={200}
                      step={5}
                      disabled={readOnly}
                      onChange={(tempo) => apply({ tab: { ...tab, tempo } })}
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
  headerActions: { flex: 2, maxWidth: 380 },
  workspaceToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.surfaceEdge
  },
  workspace: { flex: 1 },
  noteEditor: { padding: 0, gap: 8, borderWidth: 0 },
  entryWorkspace: { flex: 1, flexDirection: "row" },
  keypad: {
    width: 174,
    padding: 8,
    gap: 5,
    borderLeftWidth: 1,
    borderLeftColor: palette.glass.edge,
    backgroundColor: palette.glass.control
  },
  keypadCaption: {
    fontSize: 11,
    color: palette.glass.muted,
    textAlign: "center"
  },
  keypadGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  keypadKey: {
    width: "31%",
    minHeight: 38,
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.paper.background,
    alignItems: "center",
    justifyContent: "center"
  },
  keypadPressed: {
    backgroundColor: palette.glass.cell,
    borderColor: palette.glass.accent
  },
  keypadDisabled: { opacity: 0.4 },
  keypadDigit: {
    fontSize: 20,
    color: palette.glass.ink,
    fontVariant: ["tabular-nums"]
  },
  workspaceContent: { padding: 8, gap: 8 },
  sectionSelector: {
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
    flexDirection: "row",
    justifyContent: "space-between"
  },
  barLine: { width: 1, height: "100%", backgroundColor: palette.paper.line },
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
  history: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
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
  timeValue: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
