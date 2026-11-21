import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
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
export function TablatureBar({
  tab,
  bar,
  tick,
  compact = false,
  selected = null,
  selectedRest = null,
  grid = 6,
  disabled = false,
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
  onNote: (note: TabNote) => void;
  onCell?: (cell: Selection) => void;
  onRest?: (rest: TabRest) => void;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const dense = compact && (height < 700 || width > height);
  const scroll = useRef<ScrollView>(null);
  const barTicks = tabBarTicks(tab);
  const beatTicks = tabBeatTicks(tab);
  const start = bar * barTicks;
  const cellWidth = compact ? 34 : 44;
  const editable = !!onCell;
  const { columns, notes, rests } = useMemo(() => {
    const times = new Set(
      Array.from(
        { length: Math.ceil(barTicks / (editable ? grid : beatTicks)) },
        (_, position) => start + position * (editable ? grid : beatTicks)
      )
    );
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
  }, [tab, start, barTicks, beatTicks, editable, grid]);
  const active =
    tick >= start && tick < start + barTicks
      ? columns.findIndex(
          (position, index) =>
            tick >= position && tick < (columns[index + 1] ?? start + barTicks)
        )
      : -1;
  const selectedTick = selected?.tick ?? selectedRest;
  useEffect(() => {
    const target =
      selectedTick === null ? active : columns.indexOf(selectedTick);
    if (target >= 0)
      scroll.current?.scrollTo({
        x: Math.max(0, target - 2) * cellWidth,
        animated: false
      });
  }, [active, cellWidth, columns, selectedTick]);
  const rowStyle = dense
    ? styles.denseRow
    : compact
      ? styles.compactRow
      : styles.stringRow;
  const showRests = !compact || rests.size > 0;
  const beatPosition = (position: number) =>
    Number((1 + (position - start) / beatTicks).toFixed(2));
  return (
    <View style={styles.staff}>
      <View style={styles.stringLabels}>
        <View style={[styles.beatRow, dense && styles.denseBeats]} />
        {stringOrder.map((string) => (
          <View key={string} style={[styles.stringLabel, rowStyle]}>
            <Text style={styles.stringName}>{stringNames[string]}</Text>
          </View>
        ))}
        {showRests && (
          <View style={[styles.stringLabel, rowStyle]}>
            <Text style={styles.stringName}>{t("TabRestShort")}</Text>
          </View>
        )}
      </View>
      <ScrollView
        horizontal
        ref={scroll}
        showsHorizontalScrollIndicator={!compact}
        contentContainerStyle={styles.staffContent}
      >
        <View>
          <View style={[styles.beatRow, dense && styles.denseBeats]}>
            {columns.map((position, index) => (
              <View key={position} style={[styles.cell, { width: cellWidth }]}>
                <Text
                  numberOfLines={1}
                  style={[styles.beat, index === active && styles.activeBeat]}
                >
                  {beatPosition(position)}
                </Text>
              </View>
            ))}
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
                      <Pressable
                        accessibilityRole="button"
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
                        accessibilityState={{ selected: chosen, disabled }}
                        disabled={disabled}
                        onPress={() => onNote(note)}
                        style={[
                          styles.note,
                          !compact && styles.editableCell,
                          continued && styles.continuation,
                          (index === active || chosen) && styles.activeNote
                        ]}
                      >
                        <Text
                          style={[
                            styles.fret,
                            compact && styles.compactFret,
                            dense && styles.denseFret,
                            (index === active || chosen) && styles.activeFret
                          ]}
                        >
                          {continued ? "↳" : note.fret}
                        </Text>
                        {!compact && (
                          <Text
                            style={[
                              styles.duration,
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
                      </Pressable>
                    ) : onCell ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("TabEmptyCell", {
                          string: 6 - string,
                          bar: bar + 1,
                          beat: beatPosition(position)
                        })}
                        accessibilityState={{ selected: chosen, disabled }}
                        disabled={disabled}
                        onPress={() => onCell(cell)}
                        style={[styles.emptyCell, chosen && styles.cursorCell]}
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
                      <Pressable
                        accessibilityRole="button"
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
                        accessibilityState={{
                          selected: selectedRest === rest.tick,
                          disabled: disabled || !onRest
                        }}
                        disabled={disabled || !onRest}
                        onPress={() => onRest?.(rest)}
                        style={[
                          styles.note,
                          !compact && styles.editableCell,
                          rest.tick < start && styles.continuation,
                          selectedRest === rest.tick && styles.activeNote
                        ]}
                      >
                        <Text
                          style={[
                            styles.restText,
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
                      </Pressable>
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
  onRecord
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
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const dense = height < 700 || width > height;
  const { tab, tick, status, range } = transport;
  const [full, setFull] = useState(false);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Selection | null>({
    string: 5,
    tick: 0
  });
  const [restSelection, setRestSelection] = useState<number | null>(null);
  const [insertFret, setInsertFret] = useState(0);
  const [insertDuration, setInsertDuration] = useState(24);
  const [grid, setGrid] = useState(6);
  const [advanceCursor, setAdvanceCursor] = useState(true);
  const [clipboard, setClipboard] = useState<TabBarClipboard | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const barTicks = tabBarTicks(tab);
  const beatTicks = tabBeatTicks(tab);
  const bars = tablatureLength(tab) / barTicks;
  const bar = Math.max(0, Math.min(page, bars - 1));
  const recording = status === "recording";
  const readOnly = disabled || recording;
  const moving = status === "playing" || recording;
  const sounding = status === "playing" || status === "preparing";
  const selected = tab.notes.find((note) => sameNote(selection, note));
  const selectedRest = (tab.rests ?? []).find(
    (rest) => rest.tick === restSelection
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
    if (moving) setPage(Math.floor(tick / barTicks));
  }, [moving, tick, barTicks]);
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
    if (readOnly) return;
    transport.pause();
    setSelection(note);
    setRestSelection(null);
    setInsertFret(note.fret);
    setInsertDuration(tabNoteDuration(note));
    setPage(Math.floor(note.tick / barTicks));
    setEditError(null);
  };
  const selectCell = (cell: Selection) => {
    if (readOnly) return;
    transport.pause();
    setSelection(cell);
    setRestSelection(null);
    setEditError(null);
  };
  const selectRest = (rest: TabRest) => {
    if (readOnly) return;
    transport.pause();
    setSelection(null);
    setRestSelection(rest.tick);
    setInsertDuration(rest.duration);
    setPage(Math.floor(rest.tick / barTicks));
    setEditError(null);
  };
  const showEditor = (note?: TabNote) => {
    if (readOnly) return;
    transport.pause();
    if (note) selectNote(note);
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
        icon="folder-open-outline"
        label={t("TabOpen")}
        disabled={readOnly}
        onPress={() => {
          setFull(false);
          onOpen();
        }}
      />
      <Action
        glass
        icon={recording ? "stop" : "record-circle-outline"}
        selected={recording}
        label={t(recording ? "TabStopRecording" : "TabRecord")}
        disabled={disabled}
        onPress={() => {
          setFull(false);
          if (recording) transport.stopRecording();
          else onRecord();
        }}
      />
      <Action
        glass
        icon="content-save-outline"
        label={t("TabSave")}
        disabled={!hasEvents || readOnly}
        onPress={() => {
          setFull(false);
          onSave();
        }}
      />
      <Action
        glass
        icon="skip-backward"
        label={t("TabRewind")}
        disabled={!hasEvents || readOnly}
        onPress={() => {
          transport.rewind();
          setPage(firstBar - 1);
        }}
      />
      <Action
        glass
        icon={sounding ? "pause" : "play"}
        label={t(
          status === "preparing"
            ? "TabCancelPreparing"
            : sounding
              ? "Pause"
              : "TabPlay"
        )}
        selected={sounding}
        disabled={!hasEvents || readOnly}
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
      <Text style={styles.caption}>
        {t("TabBarOf", { current: bar + 1, total: bars })}
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
    <View style={styles.panel}>
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
        <Action
          glass
          compact
          icon={recording ? "stop" : "arrow-expand"}
          label={t(recording ? "TabStopRecording" : "TabFullView")}
          selected={recording}
          disabled={disabled}
          onPress={() => {
            if (recording) transport.stopRecording();
            else showEditor();
          }}
        />
      </View>
      {expanded && (
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
                setFull(true);
              }}
            />
          ) : (
            <Text style={styles.empty}>
              {t(recording ? "TabRecordingHint" : "TabEmptyHint")}
            </Text>
          )}
          {actions}
          {(!dense || recording || status === "preparing") && (
            <View style={styles.metadata}>
              <Text style={styles.caption}>
                {recording
                  ? t("TabRecording")
                  : status === "preparing"
                    ? t("TabPreparing")
                    : `${tab.tempo} ♩ BPM · ${tab.beatsPerBar}/${tab.beatUnit ?? 4}`}
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
        <Sheet title={title || t("TabTitle")} onClose={() => setFull(false)}>
          <Text style={styles.caption}>{t("TabStandardTuning")}</Text>
          {actions}
          <View style={styles.options}>
            <Action
              glass
              label={t("TabUndo")}
              disabled={readOnly || !transport.canUndo}
              onPress={() => {
                transport.undo();
                setEditError(null);
              }}
            />
            <Action
              glass
              label={t("TabRedo")}
              disabled={readOnly || !transport.canRedo}
              onPress={() => {
                transport.redo();
                setEditError(null);
              }}
            />
          </View>
          {pager}
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
          <Text style={styles.caption}>{t("TabEditHint")}</Text>
          <Text style={styles.caption}>{t("TabContinuationHint")}</Text>
          <View style={styles.editor}>
            <Text style={styles.sectionTitle}>
              {t(
                selected
                  ? "TabEditNote"
                  : selectedRest
                    ? "TabEditRest"
                    : "TabInsert"
              )}
            </Text>
            <View style={styles.stepper}>
              <Text style={styles.stepperLabel}>{t("TabNoteTime")}</Text>
              <Action
                glass
                icon="chevron-left"
                label={t("TabNoteEarlier")}
                disabled={readOnly || position === 0}
                onPress={() => shiftPosition(Math.max(0, position - grid))}
              />
              <Text style={styles.timeValue}>
                {t("TabNotePosition", {
                  bar: Math.floor(position / barTicks) + 1,
                  beat: Number(
                    (1 + (position % barTicks) / beatTicks).toFixed(2)
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
              <>
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
              </>
            )}
            <Text style={styles.caption}>
              {t("TabDurationValue", { duration: durationLabel(duration) })}
            </Text>
            <View style={styles.options}>
              {durationChoices.map((denominator) => (
                <Action
                  key={denominator}
                  glass
                  label={`1/${denominator}`}
                  accessibilityLabel={t("TabDurationChoice", { denominator })}
                  selected={parts?.denominator === denominator}
                  disabled={readOnly}
                  onPress={() =>
                    changeDuration(
                      durationTicks(denominator, parts?.modifier ?? "plain")
                    )
                  }
                />
              ))}
              <Action
                glass
                label={t("TabDotted")}
                selected={parts?.modifier === "dotted"}
                disabled={readOnly}
                onPress={() =>
                  changeDuration(
                    durationTicks(
                      parts?.denominator ?? 4,
                      parts?.modifier === "dotted" ? "plain" : "dotted"
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
                      parts?.modifier === "triplet" ? "plain" : "triplet"
                    )
                  )
                }
              />
            </View>
            {selected || selectedRest ? (
              <Action
                glass
                label={t(selected ? "TabDeleteNote" : "TabDeleteRest")}
                disabled={readOnly}
                onPress={() => {
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
                        rests: (tab.rests ?? []).filter(
                          (rest) => rest !== selectedRest
                        )
                      }
                    });
                  setSelection(cursor);
                  setRestSelection(null);
                }}
              />
            ) : (
              <>
                <View style={styles.options}>
                  <Action
                    glass
                    primary
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
                <Action
                  glass
                  label={t("TabAdvanceCursor")}
                  selected={advanceCursor}
                  disabled={readOnly}
                  onPress={() => setAdvanceCursor((value) => !value)}
                />
                <Text style={styles.caption}>{t("TabChordEntryHint")}</Text>
              </>
            )}
            {editError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {t(editError)}
              </Text>
            )}
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
          </View>
          <View style={styles.editor}>
            <Text style={styles.sectionTitle}>{t("TabBars")}</Text>
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
                  if (apply(insertTabBar(tab, bar + 1, copyTabBar(tab, bar))))
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
                  if (clipboard && apply(pasteTabBar(tab, bar, clipboard)))
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
                  label={`${beats}/${unit}`}
                  accessibilityLabel={t("TabMeterValue", { beats, unit })}
                  disabled={readOnly}
                  selected={
                    tab.beatsPerBar === beats && (tab.beatUnit ?? 4) === unit
                  }
                  onPress={() => {
                    if (apply(changeTabMeter(tab, beats, unit))) choosePage(0);
                  }}
                />
              ))}
            </View>
            <Text style={styles.caption}>{t("TabMeterHint")}</Text>
          </View>
          <View style={styles.editor}>
            <Text style={styles.sectionTitle}>{t("TabPlayback")}</Text>
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
                  selected={transport.speed === speed}
                  disabled={readOnly}
                  onPress={() => transport.setSpeed(speed)}
                />
              ))}
            </View>
            <View style={styles.options}>
              <Action
                glass
                label={t("TabLoop")}
                selected={transport.loop}
                disabled={!hasEvents || readOnly}
                onPress={() => transport.setLoop(!transport.loop)}
              />
              <Action
                glass
                label={t("TabWholePiece")}
                selected={range === null}
                disabled={readOnly}
                onPress={() => transport.setRange(null)}
              />
            </View>
            <Text style={styles.caption}>{t("TabLoopRange")}</Text>
            <Stepper
              label={t("TabRangeFrom")}
              value={firstBar}
              min={1}
              max={lastBar}
              disabled={readOnly}
              onChange={(value) => changeRange(value, lastBar)}
            />
            <Stepper
              label={t("TabRangeTo")}
              value={lastBar}
              min={firstBar}
              max={bars}
              disabled={readOnly}
              onChange={(value) => changeRange(firstBar, value)}
            />
          </View>
        </Sheet>
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
  panel: {
    marginHorizontal: 8,
    marginTop: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.header,
    paddingHorizontal: 10,
    paddingBottom: 4
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
  compactRow: { height: 18 },
  denseRow: { height: 12 },
  stringRow: { height: 44 },
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
  fret: { fontSize: 16, fontWeight: "600", color: palette.glass.ink },
  compactFret: { fontSize: 12 },
  denseFret: { fontSize: 10, lineHeight: 12 },
  duration: { color: palette.glass.muted, fontSize: 9, textAlign: "center" },
  restText: { color: palette.glass.ink, fontSize: 10, textAlign: "center" },
  activeFret: { color: palette.gold.ink },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    marginVertical: 3
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  editor: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge,
    gap: 10
  },
  sectionTitle: { color: palette.glass.ink, fontWeight: "600", fontSize: 16 },
  stepper: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8
  },
  stepperLabel: { flexGrow: 1, flexBasis: 70, fontSize: 13 },
  value: { minWidth: 24, textAlign: "center", fontSize: 16 },
  timeValue: { width: 100, textAlign: "center", fontSize: 12 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
