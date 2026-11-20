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
  TAB_TICKS_PER_BEAT,
  TabNote,
  Tablature,
  tablatureLength
} from "../../components/tablature";
import palette from "../../theme/palette";
import { Action, Sheet } from "../song/tools";
import type { useTablature } from "./use-tablature";

type Transport = ReturnType<typeof useTablature>;
type Selection = Pick<TabNote, "string" | "tick">;
const stringNames = ["E", "A", "D", "G", "B", "e"];
const stringOrder = [5, 4, 3, 2, 1, 0];
const columnWidth = 34;
const sameNote = (a: Selection | null, b: Selection) =>
  a?.string === b.string && a.tick === b.tick;

/** A single bar, with explicit beat positions and the high e string on top. */
export function TablatureBar({
  tab,
  bar,
  tick,
  compact = false,
  selected = null,
  disabled = false,
  onNote
}: {
  tab: Tablature;
  bar: number;
  tick: number;
  compact?: boolean;
  selected?: Selection | null;
  disabled?: boolean;
  onNote: (note: TabNote) => void;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const dense = compact && (height < 700 || width > height);
  const scroll = useRef<ScrollView>(null);
  const barTicks = tab.beatsPerBar * TAB_TICKS_PER_BEAT;
  const start = bar * barTicks;
  const { columns, notes } = useMemo(() => {
    const times = new Set(
      Array.from(
        { length: tab.beatsPerBar },
        (_, beat) => start + beat * TAB_TICKS_PER_BEAT
      )
    );
    const entries = new Map<string, TabNote>();
    for (const note of tab.notes) {
      if (note.tick < start || note.tick >= start + barTicks) continue;
      times.add(note.tick);
      entries.set(`${note.string}:${note.tick}`, note);
    }
    return { columns: [...times].sort((a, b) => a - b), notes: entries };
  }, [tab, start, barTicks]);
  const active =
    tick >= start && tick < start + barTicks
      ? columns.findIndex(
          (position, index) =>
            tick >= position && tick < (columns[index + 1] ?? start + barTicks)
        )
      : -1;
  useEffect(() => {
    if (active >= 0)
      scroll.current?.scrollTo({
        x: Math.max(0, active - 2) * columnWidth,
        animated: false
      });
  }, [active]);
  const rowStyle = dense
    ? styles.denseRow
    : compact
      ? styles.compactRow
      : styles.stringRow;
  return (
    <View style={styles.staff}>
      <View style={styles.stringLabels}>
        <View style={[styles.beatRow, dense && styles.denseBeats]} />
        {stringOrder.map((string) => (
          <View key={string} style={[styles.stringLabel, rowStyle]}>
            <Text style={styles.stringName}>{stringNames[string]}</Text>
          </View>
        ))}
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
              <View key={position} style={styles.cell}>
                <Text
                  numberOfLines={1}
                  style={[styles.beat, index === active && styles.activeBeat]}
                >
                  {Number(
                    (1 + (position - start) / TAB_TICKS_PER_BEAT).toFixed(2)
                  )}
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
                const note = notes.get(`${string}:${position}`);
                return (
                  <View key={position} style={styles.cell}>
                    {note && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("TabNoteDescription", {
                          string: 6 - string,
                          fret: note.fret,
                          bar: bar + 1,
                          beat: Number(
                            (
                              1 +
                              (position - start) / TAB_TICKS_PER_BEAT
                            ).toFixed(2)
                          )
                        })}
                        accessibilityState={{
                          selected: sameNote(selected, note),
                          disabled
                        }}
                        disabled={disabled}
                        onPress={() => onNote(note)}
                        style={[
                          styles.note,
                          (index === active || sameNote(selected, note)) &&
                            styles.activeNote
                        ]}
                      >
                        <Text
                          style={[
                            styles.fret,
                            compact && styles.compactFret,
                            dense && styles.denseFret,
                            (index === active || sameNote(selected, note)) &&
                              styles.activeFret
                          ]}
                        >
                          {note.fret}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
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
  onToggle,
  onOpen,
  onSave,
  onRecord
}: {
  transport: Transport;
  title?: string;
  dirty: boolean;
  expanded: boolean;
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editError, setEditError] = useState(false);
  const barTicks = tab.beatsPerBar * TAB_TICKS_PER_BEAT;
  const bars = tablatureLength(tab) / barTicks;
  const bar = Math.max(0, Math.min(page, bars - 1));
  const recording = status === "recording";
  const moving = status === "playing" || recording;
  const sounding = status === "playing" || status === "preparing";
  const selected = tab.notes.find((note) => sameNote(selection, note));
  const hasNotes = tab.notes.length > 0;
  useEffect(() => {
    if (moving) setPage(Math.floor(tick / barTicks));
  }, [moving, tick, barTicks]);
  const showEditor = (note?: TabNote) => {
    transport.pause();
    if (note) setSelection(note);
    setEditError(false);
    setFull(true);
  };
  const changeNote = (patch: Partial<TabNote>) => {
    if (!selected || recording) return;
    const next = { ...selected, ...patch };
    if (tab.notes.some((note) => note !== selected && sameNote(next, note))) {
      setEditError(true);
      return;
    }
    setEditError(false);
    transport.setTab({
      ...tab,
      notes: tab.notes.map((note) => (note === selected ? next : note))
    });
    setSelection(next);
    setPage(Math.floor(next.tick / barTicks));
  };
  const changeRange = (first: number, last: number) => {
    transport.setRange({ start: (first - 1) * barTicks, end: last * barTicks });
    transport.setLoop(true);
  };
  const firstBar = range ? Math.floor(range.start / barTicks) + 1 : 1;
  const lastBar = range ? Math.ceil(range.end / barTicks) : bars;
  const actions = (
    <View style={styles.actions}>
      <Action
        glass
        icon="folder-open-outline"
        label={t("TabOpen")}
        disabled={recording}
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
        disabled={!hasNotes || recording}
        onPress={() => {
          setFull(false);
          onSave();
        }}
      />
      <Action
        glass
        icon="skip-backward"
        label={t("TabRewind")}
        disabled={!hasNotes || recording}
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
        disabled={!hasNotes || recording}
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
        disabled={bar === 0 || recording}
        onPress={() => {
          transport.pause();
          setPage(bar - 1);
        }}
      />
      <Text style={styles.caption}>
        {t("TabBarOf", { current: bar + 1, total: bars })}
      </Text>
      <Action
        glass
        compact
        icon="chevron-right"
        label={t("TabNextBar")}
        disabled={bar + 1 >= bars || recording}
        onPress={() => {
          transport.pause();
          setPage(bar + 1);
        }}
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
          onPress={() => {
            if (recording) transport.stopRecording();
            else showEditor();
          }}
        />
      </View>
      {expanded && (
        <>
          {hasNotes ? (
            <TablatureBar
              tab={tab}
              bar={bar}
              tick={tick}
              compact
              disabled={recording}
              onNote={showEditor}
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
                    : `${tab.tempo} BPM · ${tab.beatsPerBar}/4`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("TabFullView")}
                disabled={recording}
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
          {hasNotes ? (
            <>
              {pager}
              <TablatureBar
                tab={tab}
                bar={bar}
                tick={tick}
                selected={selection}
                disabled={recording}
                onNote={(note) => {
                  transport.pause();
                  setSelection(note);
                  setEditError(false);
                }}
              />
              <Text style={styles.caption}>{t("TabEditHint")}</Text>
            </>
          ) : (
            <Text style={styles.empty}>{t("TabEmptyHint")}</Text>
          )}
          {selected && (
            <View style={styles.editor}>
              <Text style={styles.sectionTitle}>{t("TabEditNote")}</Text>
              <Stepper
                label={t("TabFret")}
                value={selected.fret}
                min={0}
                max={24}
                onChange={(fret) => changeNote({ fret })}
              />
              <Stepper
                label={t("TabString")}
                value={6 - selected.string}
                min={1}
                max={6}
                onChange={(value) => changeNote({ string: 6 - value })}
              />
              <View style={styles.stepper}>
                <Text style={styles.stepperLabel}>{t("TabNoteTime")}</Text>
                <Action
                  glass
                  icon="chevron-left"
                  label={t("TabNoteEarlier")}
                  disabled={selected.tick === 0}
                  onPress={() =>
                    changeNote({ tick: Math.max(0, selected.tick - 6) })
                  }
                />
                <Text style={styles.timeValue}>
                  {t("TabNotePosition", {
                    bar: Math.floor(selected.tick / barTicks) + 1,
                    beat: Number(
                      (
                        1 +
                        (selected.tick % barTicks) / TAB_TICKS_PER_BEAT
                      ).toFixed(2)
                    )
                  })}
                </Text>
                <Action
                  glass
                  icon="chevron-right"
                  label={t("TabNoteLater")}
                  disabled={selected.tick + 6 >= TAB_MAX_BARS * barTicks}
                  onPress={() => changeNote({ tick: selected.tick + 6 })}
                />
              </View>
              {editError && (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {t("TabNoteCollision")}
                </Text>
              )}
              <Action
                glass
                label={t("TabDeleteNote")}
                onPress={() => {
                  transport.setTab({
                    ...tab,
                    notes: tab.notes.filter((note) => note !== selected)
                  });
                  setSelection(null);
                  setEditError(false);
                }}
              />
            </View>
          )}
          <View style={styles.editor}>
            <Text style={styles.sectionTitle}>{t("TabPlayback")}</Text>
            <Stepper
              label={t("Tempo")}
              value={tab.tempo}
              min={40}
              max={200}
              step={5}
              onChange={(tempo) => transport.setTab({ ...tab, tempo })}
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
                  onPress={() => transport.setSpeed(speed)}
                />
              ))}
            </View>
            <View style={styles.options}>
              <Action
                glass
                label={t("TabLoop")}
                selected={transport.loop}
                disabled={!hasNotes}
                onPress={() => transport.setLoop(!transport.loop)}
              />
              <Action
                glass
                label={t("TabWholePiece")}
                selected={range === null}
                onPress={() => transport.setRange(null)}
              />
            </View>
            <Text style={styles.caption}>{t("TabLoopRange")}</Text>
            <Stepper
              label={t("TabRangeFrom")}
              value={firstBar}
              min={1}
              max={lastBar}
              onChange={(value) => changeRange(value, lastBar)}
            />
            <Stepper
              label={t("TabRangeTo")}
              value={lastBar}
              min={firstBar}
              max={bars}
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
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Action
        glass
        label="−"
        accessibilityLabel={`${label}: −`}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
      />
      <Text style={styles.value}>{value}</Text>
      <Action
        glass
        label="+"
        accessibilityLabel={`${label}: +`}
        disabled={value >= max}
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
  stringLabels: { width: 22 },
  stringLabel: { alignItems: "center", justifyContent: "center" },
  stringName: { color: palette.glass.muted, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center" },
  compactRow: { height: 18 },
  denseRow: { height: 12 },
  stringRow: { height: 32 },
  beatRow: { height: 18, flexDirection: "row", alignItems: "center" },
  denseBeats: { height: 14 },
  beat: { color: palette.glass.muted, fontSize: 10, textAlign: "center" },
  activeBeat: { color: palette.glass.accent },
  cell: { width: columnWidth, height: "100%", justifyContent: "center" },
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
  activeNote: { backgroundColor: palette.glass.accent },
  fret: { fontSize: 16, fontWeight: "600", color: palette.glass.ink },
  compactFret: { fontSize: 12 },
  denseFret: { fontSize: 10, lineHeight: 12 },
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
  timeValue: { width: 90, textAlign: "center", fontSize: 12 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
