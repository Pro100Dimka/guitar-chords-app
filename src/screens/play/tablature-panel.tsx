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
import Svg, { Ellipse, G, Path, Text as SvgText } from "react-native-svg";
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
import notationSymbols from "../../../assets/notation-symbols.json";
import { Action, Sheet } from "../song/tools";
import { TablatureKeypad } from "./tablature-keypad";
import { useTablaturePreview } from "./use-tablature-preview";
import { useTablaturePosition } from "./use-tablature";
import type { useTablature } from "./use-tablature";
import {
  changeTabMeter,
  copyTabSelection,
  deleteTabSelection,
  tabBarCoverage,
  durationChoices,
  durationLabel,
  durationParts,
  durationTicks,
  insertTabBar,
  pasteTabSelection,
  putTabNote,
  putTabRest,
  TabBarClipboard,
  TabEditResult
} from "./tablature-editor";

type Transport = ReturnType<typeof useTablature>;
type Selection = Pick<TabNote, "string" | "tick">;
const lineTechniques: TabTechnique[] = ["palmMute", "letRing"];
const stringNames = ["E", "A", "D", "G", "B", "e"];
const stringOrder = [5, 4, 3, 2, 1, 0];
const meterChoices = [
  [2, 2],
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [12, 8]
] as const;
const musicGlyphs: Record<string, string> = notationSymbols.glyphs;
function MusicGlyph({
  name,
  selected = false,
  size = 22,
  tint
}: {
  name: string;
  selected?: boolean;
  size?: number;
  tint?: string;
}) {
  const color = tint ?? (selected ? palette.gold.ink : palette.notation.text);
  const tuplet = ["triplet", "quintuplet"].includes(name);
  const dynamic = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"].includes(
    name
  );
  const letters: Record<string, string> = {
    hammerOn: "H",
    pullOff: "P",
    palmMute: "P.M.",
    letRing: "let ring",
    tapping: "tap",
    slap: "slap",
    pop: "pop",
    rasgueado: "rasg."
  };
  const glyph =
    musicGlyphs[
      name === "doubleDotted" ? "dot" : name === "dotted" ? "dot" : name
    ];
  if (["duplet", "triplet"].includes(name)) {
    const count = name === "duplet" ? 2 : 3;
    const positions = count === 2 ? [7, 19] : [5, 12, 19];
    return (
      <Svg
        width={size + 5}
        height={size}
        viewBox="0 0 26 25"
        accessible={false}
      >
        <Path
          d="M2 8V4H8M18 4H24V8"
          fill="none"
          stroke={color}
          strokeWidth={1.1}
        />
        <SvgText
          x={13}
          y={8}
          textAnchor="middle"
          fill={color}
          fontSize={11}
          fontWeight="600"
        >
          {count}
        </SvgText>
        <Path
          d={`M${positions[0] + 2} 12H${positions.at(-1)! + 2}`}
          stroke={color}
          strokeWidth={2}
        />
        {positions.map((x) => (
          <G key={x}>
            <Path d={`M${x + 2} 12V22`} stroke={color} strokeWidth={1} />
            <Ellipse
              cx={x}
              cy={22}
              rx={2.5}
              ry={1.6}
              fill={color}
              transform={`rotate(-15 ${x} 22)`}
            />
          </G>
        ))}
      </Svg>
    );
  }
  if (["slide", "bend"].includes(name))
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Path
          d={
            name === "slide"
              ? "M4 20L20 4M13 4H20V11"
              : "M4 21Q8 4 20 4M14 2L20 4L17 10"
          }
          fill="none"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  if (name === "dotted")
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Path
          d={musicGlyphs.duration4}
          fill={color}
          transform="translate(-3 0)"
        />
        <Ellipse cx={20} cy={18} rx={1.5} ry={1.5} fill={color} />
      </Svg>
    );
  return (
    <Svg
      width={dynamic ? 30 : size}
      height={size}
      viewBox={dynamic ? "0 0 36 24" : "0 0 24 24"}
      accessible={false}
    >
      {letters[name] ? (
        <>
          <SvgText
            x={12}
            y={14}
            textAnchor="middle"
            fill={color}
            fontFamily="serif"
            fontStyle="italic"
            fontSize={letters[name].length > 3 ? 8 : 14}
          >
            {letters[name]}
          </SvgText>
          {["hammerOn", "pullOff"].includes(name) && (
            <Path
              d="M2 22Q12 12 22 22"
              fill="none"
              stroke={color}
              strokeWidth={1.3}
            />
          )}
        </>
      ) : name === "tie" ? (
        <Path d="M2 17Q12 3 22 17Q12 9 2 17Z" fill={color} />
      ) : (
        <Path
          d={glyph}
          fill={color}
          transform={
            tuplet
              ? "translate(5 0) scale(.6)"
              : name === "doubleDotted"
                ? "translate(-4 0)"
                : undefined
          }
        />
      )}
      {name === "doubleDotted" && (
        <Path d={musicGlyphs.dot} fill={color} transform="translate(4 0)" />
      )}
      {tuplet && (
        <Path
          d="M2 18V14H8M16 14H22V18"
          fill="none"
          stroke={color}
          strokeWidth={1.4}
        />
      )}
    </Svg>
  );
}
const sameNote = (a: Selection | null, b: Selection) =>
  a?.string === b.string && a.tick === b.tick;

type NoteSettings = Omit<TabNote, "string" | "fret" | "tick" | "duration">;

type RhythmEvent = {
  tick: number;
  duration: number;
  voice: number;
  tuplet?: TabNote["tuplet"];
  continued: boolean;
  string: number;
};
const RhythmNotation = React.memo(function RhythmNotation({
  events,
  columns,
  cellWidth,
  beatTicks,
  start,
  scale,
  rowHeight
}: {
  events: RhythmEvent[];
  columns: number[];
  cellWidth: number;
  beatTicks: number;
  start: number;
  scale: number;
  rowHeight: number;
}) {
  const staffHeight = rowHeight * 6;
  const items = events.map((event) => {
    const parts = durationParts(event.duration);
    const denominator = event.tuplet?.denominator ?? parts?.denominator;
    return {
      ...event,
      parts,
      denominator,
      x:
        (columns.indexOf(event.tick) + 0.5) * cellWidth +
        (event.voice - 1) * 2 * scale,
      flags: denominator ? Math.max(0, Math.log2(denominator) - 2) : 0
    };
  });
  const beams: {
    from: number;
    to: number;
    x1: number;
    x2: number;
    level: number;
    voice: number;
  }[] = [];
  for (const voice of new Set(items.map((item) => item.voice))) {
    const line = items.filter((item) => item.voice === voice);
    for (let index = 1; index < line.length; index++) {
      const left = line[index - 1],
        right = line[index];
      if (
        left.continued ||
        right.continued ||
        Math.abs(left.tick + left.duration - right.tick) > 1 / 960 ||
        Math.floor((left.tick - start) / beatTicks) !==
          Math.floor((right.tick - start) / beatTicks)
      )
        continue;
      for (let level = 0; level < Math.min(left.flags, right.flags); level++)
        beams.push({
          from: left.tick,
          to: right.tick,
          x1: left.x - 10 * scale,
          x2: right.x - 10 * scale,
          level,
          voice
        });
    }
  }
  return (
    <Svg
      width={columns.length * cellWidth}
      height={staffHeight + 32 * scale}
      style={[styles.rhythmSvg, { top: -staffHeight }]}
      accessible={false}
    >
      {items.map((item) => {
        const color = palette.glass.accent;
        const x = item.x;
        const valueY = (5 - item.string + 0.5) * rowHeight + 6 * scale;
        const tuplet =
          item.tuplet?.actual ??
          {
            plain: undefined,
            dotted: undefined,
            doubleDotted: undefined,
            triplet: 3,
            duplet: 2,
            quintuplet: 5
          }[item.parts?.modifier ?? "plain"];
        const dots =
          {
            plain: 0,
            dotted: 1,
            doubleDotted: 2,
            triplet: 0,
            duplet: 0,
            quintuplet: 0
          }[item.parts?.modifier ?? "plain"] ?? 0;
        return (
          <G
            key={`${item.tick}:${item.voice}:${item.duration}`}
            testID={`tab-rhythm-event-${item.tick}-${item.voice}-${item.duration}`}
          >
            {item.denominator ? (
              <>
                {item.denominator > 1 && (
                  <Path
                    testID={`tab-rhythm-stem-${item.tick}-${item.voice}`}
                    d={`M${x - 10 * scale} ${valueY}V${staffHeight + 28 * scale}`}
                    stroke={color}
                    strokeWidth={1.2 * scale}
                  />
                )}
                {Array.from({ length: item.flags }, (_, level) => {
                  const connected = beams.some(
                    (beam) =>
                      beam.voice === item.voice &&
                      beam.level === level &&
                      [beam.from, beam.to].includes(item.tick)
                  );
                  const y = staffHeight + (27 - level * 3) * scale;
                  return connected ? null : (
                    <Path
                      key={level}
                      d={`M${x - 10 * scale} ${y}q${-8 * scale} ${-4 * scale} ${-4 * scale} ${-10 * scale}`}
                      stroke={color}
                      strokeWidth={1.6 * scale}
                      fill="none"
                    />
                  );
                })}
                {Array.from({ length: dots }, (_, index) => (
                  <Ellipse
                    key={index}
                    cx={x + (8 + index * 4) * scale}
                    cy={valueY - 6 * scale}
                    rx={1.3 * scale}
                    ry={1.3 * scale}
                    fill={color}
                  />
                ))}
                {tuplet && (
                  <SvgText
                    x={x}
                    y={staffHeight + 7 * scale}
                    fontSize={8 * scale}
                    textAnchor="middle"
                    fill={palette.glass.accent}
                  >
                    {tuplet}
                  </SvgText>
                )}
                {item.continued && (
                  <Path
                    d={`M${x - 12 * scale} ${valueY - 8 * scale}q${6 * scale} ${-5 * scale} ${12 * scale} 0`}
                    stroke={color}
                    fill="none"
                  />
                )}
              </>
            ) : (
              <SvgText
                x={x}
                y={staffHeight + 18 * scale}
                textAnchor="middle"
                fontSize={9 * scale}
                fill={color}
              >
                {durationLabel(item.duration)}
              </SvgText>
            )}
          </G>
        );
      })}
      {beams.map((beam) => (
        <Path
          key={`${beam.voice}:${beam.from}:${beam.level}`}
          testID={`tab-rhythm-beam-${beam.from}-${beam.to}-${beam.level}`}
          d={`M${beam.x1} ${staffHeight + (27 - beam.level * 3) * scale}H${beam.x2}`}
          stroke={palette.glass.accent}
          strokeWidth={2.8 * scale}
        />
      ))}
    </Svg>
  );
});

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
  availableHeight = 0,
  multiBar = false,
  onManualScroll,
  onNote,
  onCell,
  onRest,
  selectedRange = null,
  onRange,
  onMeter
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
  availableHeight?: number;
  multiBar?: boolean;
  onManualScroll?: () => void;
  onNote?: (note: TabNote) => void;
  onCell?: (cell: Selection) => void;
  onRest?: (rest: TabRest) => void;
  selectedRange?: { start: number; end: number } | null;
  onRange?: (range: { start: number; end: number }) => void;
  onMeter?: () => void;
}) {
  const { t } = useTranslation();
  const { width, height, fontScale } = useWindowDimensions();
  const dense = compact && (height < 700 || width > height);
  const textScale = Math.max(1, fontScale);
  const scroll = useRef<ScrollView>(null);
  const [staffWidth, setStaffWidth] = useState(0);
  const staffElement = useRef<View>(null);
  const staffOrigin = useRef(0);
  const scrollOffset = useRef(0);
  const rangeAnchor = useRef<number | null>(null);
  const lastTap = useRef<{ tick: number; string: number; time: number } | null>(
    null
  );
  const [draggingRange, setDraggingRange] = useState(false);
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
  const prefixWidth = bar === 0 && !compact && !readOnly ? 64 : 0;
  const labelWidth = readOnly
    ? Math.max(24, 20 * readingScale)
    : 24 * textScale;
  const cellWidth = Math.max(
    readOnly
      ? 44 * readingScale
      : (multiBar ? 28 : compact ? 34 : 44) * textScale,
    (staffWidth - labelWidth - prefixWidth) / Math.max(1, columns.length)
  );
  const editingRowHeight =
    availableHeight > 0 && width > height
      ? Math.max(
          14 * textScale,
          Math.min(26 * textScale, (availableHeight - 70 * textScale) / 6)
        )
      : (width > height ? 26 : 44) * textScale;
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
  const effectRuns = useMemo(
    () =>
      lineTechniques
        .map((technique) => {
          const spans: Array<{ start: number; end: number }> = [];
          tab.notes
            .filter(
              (note) =>
                note.techniques?.includes(technique) &&
                note.tick < start + barTicks &&
                note.tick + tabNoteDuration(note) > start
            )
            .sort((a, b) => a.tick - b.tick)
            .forEach((note) => {
              const first = Math.max(start, note.tick);
              const last = Math.min(
                start + barTicks,
                note.tick + tabNoteDuration(note)
              );
              const previous = spans.at(-1);
              if (previous && first <= previous.end)
                previous.end = Math.max(previous.end, last);
              else spans.push({ start: first, end: last });
            });
          return { technique, spans };
        })
        .filter(({ spans }) => spans.length),
    [tab.notes, start, barTicks]
  );
  const effectHeight = effectRuns.length * 16;
  const barLineTop = readOnly
    ? 20 * readingScale
    : (dense ? 14 : 18) * textScale;
  const stringsTop = barLineTop + effectHeight;
  const barLineHeight = rowHeight * 6;
  const showRests = readOnly || notes.size > 0 || rests.size > 0;
  const rhythmScale = readOnly ? readingScale : textScale;
  const rhythmEvents = useMemo(() => {
    const events = new Map<string, RhythmEvent>();
    for (const { note, end } of notes.values()) {
      const position = Math.max(start, note.tick);
      const duration =
        note.tick < start
          ? Math.min(end, start + barTicks) - start
          : Math.min(tabNoteDuration(note), start + barTicks - note.tick);
      const voice = note.voice ?? 1;
      const key = `${position}:${voice}:${duration}`;
      events.set(key, {
        tick: position,
        duration,
        voice,
        tuplet: note.tuplet,
        continued: note.tick < start,
        string: Math.min(note.string, events.get(key)?.string ?? note.string)
      });
    }
    return [...events.values()].sort(
      (left, right) => left.tick - right.tick || left.voice - right.voice
    );
  }, [notes, start, barTicks]);
  const beamTicks =
    tab.beatUnit === 8 && tab.beatsPerBar % 3 === 0 ? beatTicks * 3 : beatTicks;
  const coverage = useMemo(() => tabBarCoverage(tab, bar), [tab, bar]);
  const invalidDuration =
    editable &&
    (coverage.covered < coverage.expected - 1 / 960 || coverage.overflow);
  const beginRange = (
    position: number,
    noteDuration: number,
    dragging = false
  ) => {
    if (!onRange || disabled) return;
    const anchor = selectedRange?.start ?? position;
    rangeAnchor.current = dragging ? anchor : null;
    setDraggingRange(dragging);
    onRange({
      start: Math.min(anchor, position),
      end: Math.min(
        tablatureLength(tab),
        Math.max(
          selectedRange?.end ?? 0,
          anchor + noteDuration,
          position + noteDuration
        )
      )
    });
  };
  const pressNote = (note: TabNote) => {
    const previous = lastTap.current;
    const time = Date.now();
    lastTap.current = { tick: note.tick, string: note.string, time };
    if (
      previous?.tick === note.tick &&
      previous.string === note.string &&
      time - previous.time < 350
    ) {
      beginRange(note.tick, tabNoteDuration(note));
      lastTap.current = null;
    } else if (selectedRange && onRange) {
      onRange({
        start: Math.min(selectedRange.start, note.tick),
        end: Math.max(selectedRange.end, note.tick + tabNoteDuration(note))
      });
    } else onNote?.(note);
  };
  const moveRange = (pageX: number) => {
    if (rangeAnchor.current === null || !onRange || disabled) return;
    const local =
      pageX -
      staffOrigin.current -
      labelWidth -
      prefixWidth +
      scrollOffset.current;
    const index = Math.max(
      0,
      Math.min(columns.length - 1, Math.floor(local / cellWidth))
    );
    const position = columns[index];
    const eventDuration = Math.max(
      grid,
      ...[...notes.values()]
        .filter((entry) => entry.note.tick === position)
        .map((entry) => tabNoteDuration(entry.note)),
      rests.get(position)?.duration ?? 0
    );
    onRange({
      start: Math.min(rangeAnchor.current, position),
      end: Math.min(
        start + barTicks,
        Math.max(rangeAnchor.current + grid, position + eventDuration)
      )
    });
  };
  const beatPosition = (position: number) =>
    Number((1 + (position - start) / beatTicks).toFixed(2));
  return (
    <View
      ref={staffElement}
      style={styles.staff}
      onLayout={(event) => {
        setStaffWidth(event.nativeEvent.layout.width);
        staffElement.current?.measureInWindow?.((x) => {
          staffOrigin.current = x;
        });
      }}
      onMoveShouldSetResponder={() => rangeAnchor.current !== null && !disabled}
      onResponderMove={(event) => moveRange(event.nativeEvent.pageX)}
      onResponderRelease={() => {
        rangeAnchor.current = null;
        setDraggingRange(false);
      }}
      onResponderTerminate={() => {
        rangeAnchor.current = null;
        setDraggingRange(false);
      }}
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
        {effectHeight > 0 && <View style={{ height: effectHeight }} />}
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
        {showRests && <View style={{ height: 32 * rhythmScale }} />}
      </View>
      {prefixWidth > 0 && (
        <View
          style={[
            styles.staffPrefix,
            {
              width: prefixWidth,
              paddingBottom: Number(showRests) * 32 * rhythmScale
            }
          ]}
        >
          <Svg
            testID="tab-treble-clef"
            width={28}
            height={Math.min(90, barLineHeight)}
            viewBox="0 0 24 72"
            accessible={false}
          >
            <Path d={musicGlyphs.trebleClef} fill={palette.glass.accent} />
          </Svg>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("TabMeterValue", {
              beats: tab.beatsPerBar,
              unit: tab.beatUnit ?? 4
            })}
            disabled={!onMeter || disabled}
            onPress={onMeter}
            style={styles.staffMeter}
          >
            <Text style={styles.staffMeterText}>
              {tab.beatsPerBar}/{tab.beatUnit ?? 4}
            </Text>
          </Pressable>
        </View>
      )}
      <ScrollView
        horizontal
        ref={scroll}
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={32}
        scrollEnabled={!draggingRange}
        showsHorizontalScrollIndicator={!compact}
        onScrollBeginDrag={onManualScroll}
        contentContainerStyle={styles.staffContent}
      >
        <View>
          {selectedRange && (
            <View
              pointerEvents="box-none"
              style={[StyleSheet.absoluteFillObject, { top: stringsTop }]}
            >
              {columns.map((position, index) =>
                position >= selectedRange.start &&
                position < selectedRange.end ? (
                  <View
                    key={position}
                    pointerEvents="none"
                    testID={`tab-range-cell-${position}`}
                    style={[
                      styles.rangeCell,
                      {
                        left: index * cellWidth,
                        width: cellWidth,
                        height: barLineHeight
                      }
                    ]}
                  />
                ) : null
              )}
            </View>
          )}
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
                  {multiBar
                    ? index === Math.floor(columns.length / 2)
                      ? bar + 1
                      : ""
                    : beatPosition(position)}
                </Text>
              </View>
            ))}
          </View>
          {effectRuns.map(({ technique, spans }) => (
            <View key={technique} style={styles.effectRow}>
              {spans.map((span) => {
                const first = Math.max(
                  0,
                  columns.findIndex((at) => at >= span.start)
                );
                const end = columns.findIndex((at) => at >= span.end);
                const width =
                  ((end < 0 ? columns.length : end) - first) * cellWidth;
                return (
                  <View
                    key={span.start}
                    style={[
                      styles.effectSpan,
                      { left: first * cellWidth, width }
                    ]}
                  >
                    <Text style={styles.effectLabel}>
                      {technique === "palmMute" ? "P.M." : "l.r."}
                    </Text>
                    <View style={styles.effectRule} />
                  </View>
                );
              })}
            </View>
          ))}
          <View
            pointerEvents="none"
            style={[
              styles.barLines,
              {
                top: stringsTop + rowHeight / 2,
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
                const symbol = note
                  ? tabNoteSymbols({
                      ...note,
                      techniques: note.techniques?.filter(
                        (technique) => !lineTechniques.includes(technique)
                      )
                    })
                  : "";
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
                        onPress={readOnly ? undefined : () => pressNote(note)}
                        onLongPress={
                          readOnly || !onRange
                            ? undefined
                            : () =>
                                beginRange(
                                  position,
                                  tabNoteDuration(note),
                                  true
                                )
                        }
                        onPressOut={() => {
                          rangeAnchor.current = null;
                          setDraggingRange(false);
                        }}
                        style={[
                          styles.note,
                          !compact && styles.editableCell,
                          !compact &&
                            !readOnly && { height: editingRowHeight - 2 },
                          readOnly && { height: 32 * readingScale - 2 },
                          continued && styles.continuation,
                          (index === active || chosen) && styles.activeNote,
                          styles.ovalNote,
                          {
                            width: readOnly
                              ? 38 * readingScale
                              : 34 * textScale,
                            height: Math.max(
                              12,
                              Math.min(rowHeight - 2, 26 * rhythmScale)
                            )
                          }
                        ]}
                      >
                        <Svg
                          pointerEvents="none"
                          style={StyleSheet.absoluteFillObject}
                          width="100%"
                          height="100%"
                          viewBox="0 0 38 26"
                          accessible={false}
                        >
                          <Ellipse
                            testID={`tab-notehead-${position}-${string}`}
                            cx={19}
                            cy={13}
                            rx={16}
                            ry={10}
                            transform="rotate(-12 19 13)"
                            fill={
                              tabNoteDuration(note) >= 48
                                ? palette.paper.background
                                : palette.glass.accent
                            }
                            stroke={palette.glass.accent}
                            strokeWidth={1.5}
                          />
                          {chosen && (
                            <Ellipse
                              cx={19}
                              cy={13}
                              rx={18}
                              ry={12}
                              fill="none"
                              stroke={palette.glass.accent}
                              strokeWidth={0.8}
                            />
                          )}
                        </Svg>
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
                            {
                              color:
                                tabNoteDuration(note) >= 48
                                  ? palette.glass.accent
                                  : palette.gold.ink
                            }
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
                        {!!symbol && (
                          <Text
                            numberOfLines={1}
                            style={[styles.noteSymbol, styles.noteMark]}
                          >
                            {symbol}
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
                        onLongPress={
                          !onRange
                            ? undefined
                            : () => beginRange(position, grid, true)
                        }
                        onPressOut={() => {
                          rangeAnchor.current = null;
                          setDraggingRange(false);
                        }}
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
            <View style={[styles.row, { height: 32 * rhythmScale }]}>
              <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                <RhythmNotation
                  events={rhythmEvents}
                  columns={columns}
                  cellWidth={cellWidth}
                  beatTicks={beamTicks}
                  start={start}
                  scale={rhythmScale}
                  rowHeight={rowHeight}
                />
              </View>
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
                        onLongPress={
                          readOnly || !onRange
                            ? undefined
                            : () => beginRange(position, rest.duration)
                        }
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
                        <MusicGlyph
                          tint={
                            selectedRest === rest.tick
                              ? palette.gold.ink
                              : palette.glass.accent
                          }
                          name={`rest${durationParts(rest.duration)?.denominator ?? 4}`}
                          selected={selectedRest === rest.tick}
                          size={22 * rhythmScale}
                        />
                      </NoteTarget>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          {selectedRange && onRange && !disabled && (
            <View
              pointerEvents="box-none"
              style={StyleSheet.absoluteFillObject}
            >
              {[
                {
                  key: "start",
                  tick: selectedRange.start,
                  anchor: selectedRange.end - grid,
                  label: "TabSelectionStart"
                },
                {
                  key: "end",
                  tick: selectedRange.end,
                  anchor: selectedRange.start,
                  label: "TabSelectionEnd"
                }
              ]
                .filter(
                  (handle) =>
                    handle.tick >= start && handle.tick <= start + barTicks
                )
                .map((handle) => {
                  const index =
                    handle.tick === start + barTicks
                      ? columns.length
                      : Math.max(
                          0,
                          columns.findIndex((at) => at >= handle.tick)
                        );
                  return (
                    <Pressable
                      key={handle.key}
                      accessibilityRole="button"
                      accessibilityLabel={t(handle.label)}
                      onPressIn={() => {
                        rangeAnchor.current = handle.anchor;
                        setDraggingRange(true);
                      }}
                      onTouchMove={(event) =>
                        moveRange(event.nativeEvent.pageX)
                      }
                      onPressOut={() => {
                        rangeAnchor.current = null;
                        setDraggingRange(false);
                      }}
                      style={[
                        styles.rangeHandle,
                        {
                          left: index * cellWidth - 18,
                          top: stringsTop + barLineHeight - 18
                        }
                      ]}
                    >
                      <View style={styles.rangeHandleDot} />
                    </Pressable>
                  );
                })}
            </View>
          )}
          {invalidDuration && (
            <View
              testID={`tab-invalid-duration-${bar}`}
              accessibilityLabel={t("TabInvalidDuration", {
                actual: Number((coverage.covered / beatTicks).toFixed(2)),
                expected: tab.beatsPerBar
              })}
              style={styles.invalidDuration}
            >
              <Text style={styles.invalidDurationText}>
                {Number((coverage.covered / beatTicks).toFixed(2))}/
                {tab.beatsPerBar}
                {coverage.overflow ? "+" : ""}
              </Text>
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
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 12 });
  const [editorSection, setEditorSection] = useState<
    "score" | "note" | "bars" | "meter"
  >("score");
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Selection | null>({
    string: 5,
    tick: 0
  });
  const [restSelection, setRestSelection] = useState<number | null>(null);
  const [insertDuration, setInsertDuration] = useState(24);
  const grid = Math.min(24, insertDuration);
  const [editError, setEditError] = useState<string | null>(null);
  const [insertSettings, setInsertSettings] = useState<NoteSettings>({});
  const [noteClipboard, setNoteClipboard] = useState<TabBarClipboard | null>(
    null
  );
  const [noteRange, setNoteRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [contextVisible, setContextVisible] = useState(true);
  const [meterChoice, setMeterChoice] = useState<[number, 2 | 4 | 8]>([
    tab.beatsPerBar,
    tab.beatUnit ?? 4
  ]);
  const [keypadExpanded, setKeypadExpanded] = useState(false);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const fretInput = useRef<{
    string: number;
    tick: number;
    fret: number;
    time: number;
  } | null>(null);
  const sections = [
    { key: "note", label: "TabScore", icon: "music-note-eighth" },
    { key: "bars", label: "TabBars", icon: "view-column-outline" }
  ] as const;
  const barTicks = tabBarTicks(tab);
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
    visible && !readOnly && (full || expanded),
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
  const chordAt = (notes: TabNote[], at: number) =>
    notes.filter((note) => note.tick === at);
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
    setNoteRange(null);
    transport.setRange(null);
    setContextVisible(true);
    setInsertDuration(tabNoteDuration(note));
    fretInput.current = null;
    if (readOnly) return;
    transport.pause();
    setSelection(note);
    setRestSelection(null);
    setPage(Math.floor(note.tick / barTicks));
    setEditError(null);
    preview(chordAt(tab.notes, note.tick));
  };
  const selectCell = (cell: Selection) => {
    setNoteRange(null);
    transport.setRange(null);
    setContextVisible(true);
    fretInput.current = null;
    if (readOnly) return;
    cancelPreview();
    transport.pause();
    setSelection(cell);
    setPage(Math.floor(cell.tick / barTicks));
    setRestSelection(null);
    setEditError(null);
  };
  const selectRest = (rest: TabRest) => {
    setNoteRange(null);
    transport.setRange(null);
    setContextVisible(true);
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
    setActionsMenuOpen(false);
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
    if (readOnly || (!scopedNotes.length && !noteRange && !selectedRest))
      return;
    cancelPreview();
    fretInput.current = null;
    if (selectedRest && !scopedNotes.length && !noteRange) {
      if (
        apply({
          tab: {
            ...tab,
            rests: (tab.rests ?? []).filter((rest) => rest !== selectedRest)
          }
        })
      ) {
        setSelection({ ...cursor, tick: selectedRest.tick });
        setRestSelection(null);
      }
      return;
    }
    if (apply(deleteTabSelection(tab, scopedNotes, noteRange ?? undefined))) {
      setSelection(cursor);
      setRestSelection(null);
      setNoteRange(null);
      transport.setRange(null);
    }
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
    const target = (tab.rests ?? []).find(
      (rest) =>
        rest.tick <= cursor.tick && rest.tick + rest.duration > cursor.tick
    );
    const rests = (tab.rests ?? []).flatMap((rest) =>
      rest !== target
        ? [rest]
        : [
            ...(rest.tick < cursor.tick
              ? [{ tick: rest.tick, duration: cursor.tick - rest.tick }]
              : []),
            ...(rest.tick + rest.duration > cursor.tick + next.duration
              ? [
                  {
                    tick: cursor.tick + next.duration,
                    duration:
                      rest.tick + rest.duration - cursor.tick - next.duration
                  }
                ]
              : [])
          ]
    );
    const result = putTabNote({ ...tab, rests }, next, selected);
    if (!apply(result)) return;
    preview(chordAt(result.tab!.notes, next.tick));
    setSelection(next);
    setRestSelection(null);
    fretInput.current = { ...cursor, fret, time };
  };
  const movePosition = (direction: number) => {
    if (readOnly) return;
    const step = selected
      ? tabNoteDuration(selected)
      : (selectedRest?.duration ?? insertDuration);
    const events = [
      ...tab.notes.map((note) => note.tick),
      ...(tab.rests ?? []).map((rest) => rest.tick)
    ];
    const target =
      direction > 0
        ? Math.min(position + step, ...events.filter((at) => at > position))
        : Math.max(
            0,
            position - insertDuration,
            ...events.filter(
              (at) => at < position && at >= position - insertDuration
            )
          );
    if (target >= TAB_MAX_BARS * barTicks) return;
    if (target >= length && !apply(insertTabBar(tab, bars))) return;
    selectCell({ ...cursor, tick: target });
    setPage(Math.floor(target / barTicks));
  };
  const nextPosition = () => movePosition(1);
  const selectRange = (next: { start: number; end: number }) => {
    if (readOnly) return;
    cancelPreview();
    transport.pause();
    const bounded = {
      start: Math.max(0, next.start),
      end: Math.min(length, next.end)
    };
    if (bounded.start >= bounded.end) return;
    setNoteRange(bounded);
    setContextVisible(true);
    transport.setRange(bounded);
  };
  const noteSettings = selected ?? insertSettings;
  const scopedNotes = noteRange
    ? tab.notes.filter(
        (note) => note.tick >= noteRange.start && note.tick < noteRange.end
      )
    : selected
      ? [selected]
      : [];
  const patchSettings = (patch: NoteSettings) => {
    if (readOnly || selectedRest) return;
    if (!selected) {
      setInsertSettings((settings) => ({ ...settings, ...patch }));
      return;
    }
    const next = {
      ...tab,
      version: 3 as const,
      notes: tab.notes.map((note) =>
        (noteRange ? scopedNotes.includes(note) : note.tick === selected.tick)
          ? { ...note, ...patch }
          : note
      )
    };
    if (apply({ tab: next })) preview(chordAt(next.notes, selected.tick));
  };
  const toggleTechnique = (technique: TabTechnique) =>
    patchSettings({
      techniques: noteSettings.techniques?.includes(technique)
        ? noteSettings.techniques.filter((entry) => entry !== technique)
        : [...(noteSettings.techniques ?? []), technique]
    });
  const selectedClipboard = () =>
    copyTabSelection(
      tab,
      noteRange?.start ?? position,
      noteRange?.end ?? position + duration,
      noteRange ? undefined : selected
    );
  const saveNotesToClipboard = (cut = false) => {
    if (readOnly || (!scopedNotes.length && !selectedRest && !noteRange))
      return;
    setNoteClipboard(selectedClipboard());
    if (cut) removeSelection();
  };
  const pasteNotes = (duplicate = false) => {
    if (readOnly) return;
    const source = duplicate ? selectedClipboard() : noteClipboard;
    if (!source || (!source.notes.length && !source.rests.length)) return;
    const at = duplicate
      ? (noteRange?.end ?? position + duration)
      : cursor.tick;
    if (
      apply(
        pasteTabSelection(
          tab,
          at,
          source,
          noteRange ? undefined : cursor.string
        )
      )
    ) {
      setNoteRange(null);
      transport.setRange(null);
      setSelection({ ...cursor, tick: at });
      setRestSelection(null);
      setPage(Math.floor(at / barTicks));
    }
  };
  const convertToRest = () => {
    if (readOnly || selectedRest) return;
    const notes = tab.notes.filter((note) => !scopedNotes.includes(note));
    const at = position;
    const restDuration = Math.max(
      duration,
      ...scopedNotes.map(tabNoteDuration)
    );
    if (
      apply(putTabRest({ ...tab, notes }, { tick: at, duration: restDuration }))
    ) {
      cancelPreview();
      setSelection(null);
      setRestSelection(at);
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
  const changeDuration = (next: number, tuplet?: TabNote["tuplet"]) => {
    if (readOnly) return;
    fretInput.current = null;
    if (selected) {
      const notes = tab.notes.map((note) =>
        note.tick === selected.tick ? { ...note, duration: next, tuplet } : note
      );
      if (apply({ tab: { ...tab, version: 3, notes } }))
        setSelection({ string: selected.string, tick: selected.tick });
    } else if (selectedRest) changeRest({ duration: next });
    else {
      setEditError(null);
      setInsertSettings((settings) => ({ ...settings, tuplet }));
    }
    setInsertDuration(next);
  };
  const choosePage = (next: number) => {
    cancelPreview();
    transport.pause();
    setPage(next);
    setSelection({ ...cursor, tick: next * barTicks });
    setRestSelection(null);
    setEditError(null);
  };
  const barsPerRow = Math.max(
    1,
    Math.min(4, Math.floor((width - (keypadExpanded ? 218 : 44) - 24) / 200))
  );
  const barsPerPage = barsPerRow * 2;
  const windowStart = Math.floor(bar / barsPerPage) * barsPerPage;
  const visibleBars = Array.from(
    { length: Math.min(barsPerPage, bars - windowStart) },
    (_, index) => windowStart + index
  );
  const staffRows = Math.ceil(visibleBars.length / barsPerRow);
  const playback = (
    <Action
      glass
      compact={standalone}
      style={full ? styles.roundControl : undefined}
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
  const actionItems = [
    {
      key: "open",
      icon: "folder-open-outline",
      label: t("TabOpen"),
      disabled: controlsLocked,
      onPress: () => {
        setActionsMenuOpen(false);
        cancelPreview();
        if (!standalone) setFull(false);
        onOpen();
      }
    },
    {
      key: "record",
      icon: recording || recordPending ? "stop" : "record-circle-outline",
      label: t(
        recording
          ? "TabStopRecording"
          : recordPending
            ? "TabCancelCountIn"
            : "TabRecord"
      ),
      selected: recording || recordPending,
      disabled:
        disabled || (!recordPending && (countingIn || status === "preparing")),
      onPress: () => {
        setActionsMenuOpen(false);
        cancelPreview();
        setFull(false);
        if (recording) transport.stopRecording();
        else if (recordPending) transport.pause();
        else onRecord();
      }
    },
    {
      key: "save",
      icon: "content-save-outline",
      label: t("TabSave"),
      disabled: !hasEvents || controlsLocked,
      onPress: () => {
        setActionsMenuOpen(false);
        cancelPreview();
        if (!standalone) setFull(false);
        onSave();
      }
    },
    {
      key: "practice",
      icon: standalone ? "music-box-outline" : "skip-backward",
      label: t(standalone ? "TabPractice" : "TabRewind"),
      disabled: !hasEvents || controlsLocked,
      onPress: () => {
        setActionsMenuOpen(false);
        cancelPreview();
        if (standalone) {
          onPractice?.();
          return;
        }
        transport.rewind();
        setPage(Math.floor((range?.start ?? 0) / barTicks));
      }
    }
  ];
  const actions = (
    <View style={styles.actions}>
      {actionItems.map((item) => (
        <Action
          key={item.key}
          glass
          compact={standalone}
          showLabel
          icon={item.icon}
          label={item.label}
          selected={item.selected}
          disabled={item.disabled}
          onPress={item.onPress}
        />
      ))}
      {!full && playback}
    </View>
  );
  const openMeter = () => {
    setMeterChoice([tab.beatsPerBar, tab.beatUnit ?? 4]);
    setEditorSection("meter");
  };
  const glyph = (name: string, selected = false) => (
    <MusicGlyph name={name} selected={selected} size={22} />
  );
  type NoteControl = {
    label: string;
    accessibilityLabel?: string;
    icon: React.ReactElement;
    selected?: boolean;
    disabled?: boolean;
    onPress: () => void;
  };
  const baseDenominator =
    noteSettings.tuplet?.denominator ?? parts?.denominator ?? 4;
  const noteRows: NoteControl[][] = [
    [
      {
        label: t("TabMeterShort"),
        accessibilityLabel: t("TabMeter"),
        icon: (
          <Text style={styles.meterIcon}>
            {tab.beatsPerBar}/{tab.beatUnit ?? 4}
          </Text>
        ),
        onPress: openMeter
      },
      ...durationChoices
        .filter((n) => n <= 32)
        .map((denominator) => ({
          label: `1/${denominator}`,
          accessibilityLabel: t("TabDurationChoice", { denominator }),
          icon: glyph(
            `duration${denominator}`,
            baseDenominator === denominator
          ),
          selected: baseDenominator === denominator,
          onPress: () => changeDuration(durationTicks(denominator))
        })),
      {
        label: t("TabRestShort"),
        accessibilityLabel: t("TabAddRest"),
        icon: glyph("rest4", !!selectedRest),
        selected: !!selectedRest,
        onPress: convertToRest
      },
      {
        label: t("TabMutedShort"),
        accessibilityLabel: t("TabDeadNote"),
        icon: glyph("dead", noteSettings.accent === "dead"),
        selected: noteSettings.accent === "dead",
        disabled: !!selectedRest,
        onPress: () =>
          patchSettings({
            accent: noteSettings.accent === "dead" ? undefined : "dead"
          })
      },
      {
        label: t("TabDotShort"),
        accessibilityLabel: t("TabDotted"),
        icon: glyph(
          "dotted",
          parts?.modifier === "dotted" && !noteSettings.tuplet
        ),
        selected: parts?.modifier === "dotted" && !noteSettings.tuplet,
        onPress: () =>
          changeDuration(
            durationTicks(
              baseDenominator,
              parts?.modifier === "dotted" && !noteSettings.tuplet
                ? "plain"
                : "dotted"
            )
          )
      },
      ...(
        [
          { name: "duplet", label: "TabDuplet", actual: 2, normal: 3 },
          { name: "triplet", label: "TabTriplet", actual: 3, normal: 2 }
        ] as const
      ).map((item) => ({
        label: t(item.label),
        icon: glyph(item.name, noteSettings.tuplet?.actual === item.actual),
        selected: noteSettings.tuplet?.actual === item.actual,
        onPress: () =>
          noteSettings.tuplet?.actual === item.actual
            ? changeDuration(durationTicks(baseDenominator))
            : changeDuration(durationTicks(baseDenominator, item.name), {
                actual: item.actual,
                normal: item.normal,
                denominator: baseDenominator
              })
      })),
      {
        label: t("TabTie"),
        icon: glyph("tie", noteSettings.tie),
        selected: !!noteSettings.tie,
        disabled: !!selectedRest,
        onPress: () => patchSettings({ tie: !noteSettings.tie })
      }
    ],
    [
      ...(
        [
          { key: "down", label: "TabPick_down" },
          { key: "up", label: "TabPick_up" },
          { key: "downBrush", label: "TabPick_downBrush" },
          { key: "upBrush", label: "TabPick_upBrush" },
          { key: "arpeggio", label: "TabPick_arpeggio" }
        ] as const
      ).map((item) => ({
        label: t(item.label),
        icon: glyph(item.key, noteSettings.pick === item.key),
        selected: noteSettings.pick === item.key,
        disabled: !!selectedRest,
        onPress: () =>
          patchSettings({
            pick: noteSettings.pick === item.key ? undefined : item.key
          })
      })),
      ...(
        [
          "palmMute",
          "letRing",
          "hammerOn",
          "pullOff",
          "slide",
          "bend",
          "vibrato",
          "harmonic"
        ] as const
      ).map((technique) => ({
        label: t(`TabTechnique_${technique}`),
        icon: glyph(technique, noteSettings.techniques?.includes(technique)),
        selected: noteSettings.techniques?.includes(technique),
        disabled: !!selectedRest,
        onPress: () => toggleTechnique(technique)
      }))
    ],
    [
      ...(
        [
          { key: "p", velocity: 48 },
          { key: "mp", velocity: 56 },
          { key: "mf", velocity: 64 },
          { key: "f", velocity: 96 }
        ] as const
      ).map((item) => ({
        label: item.key,
        accessibilityLabel: t("TabVelocityValue", { value: item.key }),
        icon: glyph(item.key, (noteSettings.velocity ?? 64) === item.velocity),
        selected: (noteSettings.velocity ?? 64) === item.velocity,
        disabled: !!selectedRest,
        onPress: () => patchSettings({ velocity: item.velocity })
      })),
      ...(
        [
          { key: "accent", label: "TabAccent" },
          { key: "staccato", label: "TabStaccato" }
        ] as const
      ).map((item) => ({
        label: t(item.label),
        icon: glyph(item.key, noteSettings.accent === item.key),
        selected: noteSettings.accent === item.key,
        disabled: !!selectedRest,
        onPress: () =>
          patchSettings({
            accent: noteSettings.accent === item.key ? undefined : item.key
          })
      }))
    ]
  ];
  const pager = (
    <View style={styles.pager}>
      <Action
        glass
        compact
        icon="chevron-left"
        style={styles.roundControl}
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
        style={styles.roundControl}
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
          onRequestClose={() =>
            actionsMenuOpen ? setActionsMenuOpen(false) : closeEditor()
          }
        >
          <SafeAreaView style={styles.editorScreen}>
            <View
              style={styles.editorHeader}
              onLayout={(event) =>
                setMenuPosition({
                  top:
                    event.nativeEvent.layout.y +
                    event.nativeEvent.layout.height +
                    4,
                  right:
                    width -
                    event.nativeEvent.layout.x -
                    event.nativeEvent.layout.width +
                    12
                })
              }
            >
              <Action
                glass
                compact
                icon="arrow-left"
                style={styles.roundControl}
                label={t("Close")}
                onPress={closeEditor}
              />
              <View style={styles.editorIdentity}>
                <Text numberOfLines={1} style={styles.editorTitle}>
                  {title || t("TabTitle")}
                </Text>
              </View>
              <View style={styles.headerControls}>
                {pager}
                <View style={styles.headerTempo}>
                  <Action
                    glass
                    compact
                    style={styles.roundControl}
                    icon="minus"
                    label="−"
                    accessibilityLabel={`${t("TabQuarterTempo")}: −`}
                    disabled={readOnly || tab.tempo <= 40}
                    onPress={() =>
                      apply({
                        tab: { ...tab, tempo: Math.max(40, tab.tempo - 1) }
                      })
                    }
                  />
                  <Text style={styles.headerBpm}>{tab.tempo} BPM</Text>
                  <Action
                    glass
                    compact
                    style={styles.roundControl}
                    icon="plus"
                    label="+"
                    accessibilityLabel={`${t("TabQuarterTempo")}: +`}
                    disabled={readOnly || tab.tempo >= 200}
                    onPress={() =>
                      apply({
                        tab: { ...tab, tempo: Math.min(200, tab.tempo + 1) }
                      })
                    }
                  />
                </View>
                {[
                  {
                    icon: "undo",
                    label: "TabUndo",
                    enabled: transport.canUndo,
                    action: transport.undo
                  },
                  {
                    icon: "redo",
                    label: "TabRedo",
                    enabled: transport.canRedo,
                    action: transport.redo
                  }
                ].map((item) => (
                  <Action
                    key={item.label}
                    glass
                    compact
                    style={styles.roundControl}
                    icon={item.icon}
                    label={t(item.label)}
                    disabled={readOnly || !item.enabled}
                    onPress={() => {
                      cancelPreview();
                      fretInput.current = null;
                      item.action();
                      setEditError(null);
                    }}
                  />
                ))}
              </View>
              <View style={styles.headerMenu}>
                <Action
                  glass
                  compact
                  icon="dots-vertical"
                  style={styles.roundControl}
                  label={t("TabActionsMenu")}
                  selected={actionsMenuOpen || recording || recordPending}
                  onPress={() => setActionsMenuOpen(!actionsMenuOpen)}
                />
              </View>
            </View>
            {actionsMenuOpen && (
              <View
                accessibilityViewIsModal
                accessibilityRole="menu"
                style={[styles.actionsMenu, menuPosition]}
              >
                {actionItems.map((item) => (
                  <Pressable
                    key={item.key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    accessibilityState={{ disabled: item.disabled }}
                    disabled={item.disabled}
                    onPress={item.onPress}
                    style={({ pressed }) => [
                      styles.actionsMenuItem,
                      pressed && styles.actionsMenuPressed,
                      item.disabled && styles.actionsMenuDisabled
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={21}
                      color={palette.glass.accent}
                    />
                    <Text style={styles.actionsMenuLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {actionsMenuOpen && (
              <Pressable
                accessibilityLabel={t("Close")}
                style={[StyleSheet.absoluteFillObject, styles.menuBackdrop]}
                onPress={() => setActionsMenuOpen(false)}
              />
            )}
            {contextVisible &&
              !readOnly &&
              (!!selected ||
                !!selectedRest ||
                !!noteRange ||
                !!noteClipboard) && (
                <View
                  style={styles.contextBar}
                  accessibilityLabel={t("TabSelectionActions")}
                >
                  {[
                    {
                      icon: "content-copy",
                      label: "TabCopyNotes",
                      disabled:
                        !scopedNotes.length && !selectedRest && !noteRange,
                      action: () => saveNotesToClipboard()
                    },
                    {
                      icon: "content-cut",
                      label: "TabCutNotes",
                      disabled: !scopedNotes.length && !noteRange,
                      action: () => saveNotesToClipboard(true)
                    },
                    {
                      icon: "content-paste",
                      label: "TabPasteNotes",
                      disabled: !noteClipboard,
                      action: () => pasteNotes()
                    },
                    {
                      icon: "content-duplicate",
                      label: "TabDuplicateNotes",
                      disabled:
                        !scopedNotes.length && !selectedRest && !noteRange,
                      action: () => pasteNotes(true)
                    },
                    {
                      icon: "trash-can-outline",
                      label: "TabDeleteNote",
                      disabled:
                        !scopedNotes.length && !noteRange && !selectedRest,
                      action: removeSelection
                    },
                    {
                      icon: "close",
                      label: "TabCancelSelection",
                      disabled: false,
                      action: () => {
                        setNoteRange(null);
                        transport.setRange(null);
                        setContextVisible(false);
                      }
                    }
                  ].map((item) => (
                    <Action
                      key={item.label}
                      glass
                      compact
                      style={styles.roundControl}
                      icon={item.icon}
                      label={t(item.label)}
                      disabled={item.disabled}
                      onPress={item.action}
                    />
                  ))}
                </View>
              )}
            <View
              style={styles.entryWorkspace}
              onLayout={(event) =>
                setWorkspaceHeight(event.nativeEvent.layout.height)
              }
            >
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
                  <View style={styles.barGrid}>
                    {visibleBars.map((visibleBar) => (
                      <View
                        key={visibleBar}
                        style={{
                          width: `${100 / Math.min(barsPerRow, visibleBars.length)}%`
                        }}
                      >
                        <TablatureBar
                          tab={tab}
                          bar={visibleBar}
                          tick={tick}
                          multiBar
                          availableHeight={Math.max(
                            0,
                            workspaceHeight / staffRows - 24
                          )}
                          selected={moving ? null : selection}
                          selectedRest={moving ? null : restSelection}
                          grid={grid}
                          disabled={readOnly}
                          onNote={selectNote}
                          onCell={selectCell}
                          onRest={selectRest}
                          selectedRange={noteRange}
                          onRange={selectRange}
                          onMeter={openMeter}
                        />
                      </View>
                    ))}
                  </View>
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
            <View style={styles.compactFooter}>
              <View style={styles.footerSections}>
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
                    <Text style={styles.sectionTabText}>
                      {t(section.label)}
                    </Text>
                  </Pressable>
                ))}
                <Action
                  glass
                  compact
                  showLabel
                  icon="repeat"
                  label={t("TabLoopShort")}
                  style={styles.loopControl}
                  selected={transport.loop}
                  disabled={controlsLocked || !hasEvents}
                  onPress={() => transport.setLoop(!transport.loop)}
                />
              </View>
              <View style={styles.headerControls}>
                <Action
                  glass
                  compact
                  style={styles.roundControl}
                  icon="skip-backward"
                  label={t("TabRewind")}
                  disabled={disabled || recording || recordPending}
                  onPress={() => {
                    cancelPreview();
                    transport.rewind();
                    setPage(Math.floor((range?.start ?? 0) / barTicks));
                  }}
                />
                {playback}
                <Action
                  glass
                  compact
                  style={styles.roundControl}
                  icon="skip-forward"
                  label={t("TabLastPosition")}
                  disabled={readOnly}
                  onPress={() => choosePage(bars - 1)}
                />
              </View>
              <View style={styles.navigation}>
                <Action
                  glass
                  compact
                  style={styles.roundControl}
                  icon="chevron-left"
                  label={t("TabPreviousPosition")}
                  disabled={readOnly || position <= 0}
                  onPress={() => movePosition(-1)}
                />
                <Action
                  glass
                  compact
                  style={styles.roundControl}
                  icon="chevron-right"
                  label={t("TabNextPosition")}
                  disabled={
                    readOnly || position + duration >= TAB_MAX_BARS * barTicks
                  }
                  onPress={nextPosition}
                />
                {[
                  { icon: "chevron-up", delta: 1 },
                  { icon: "chevron-down", delta: -1 }
                ].map((item) => (
                  <Action
                    key={item.delta}
                    glass
                    compact
                    style={styles.roundControl}
                    icon={item.icon}
                    label={t("TabString") + (item.delta > 0 ? " ↑" : " ↓")}
                    disabled={
                      readOnly ||
                      cursor.string + item.delta < 0 ||
                      cursor.string + item.delta > 5
                    }
                    onPress={() =>
                      selectCell({
                        ...cursor,
                        string: cursor.string + item.delta
                      })
                    }
                  />
                ))}
              </View>
            </View>
            {editorSection !== "score" && (
              <Sheet
                compact
                dense
                landscapeOnly
                maxWidth={width - 24}
                title={t(
                  editorSection === "meter"
                    ? "TabMeter"
                    : editorSection === "bars"
                      ? "TabBars"
                      : "TabScore"
                )}
                onClose={() =>
                  setEditorSection(editorSection === "meter" ? "note" : "score")
                }
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
                    {noteRows.map((row, index) => (
                      <View
                        key={index}
                        style={[
                          styles.paletteRow,
                          index > 0 && styles.paletteDivider
                        ]}
                      >
                        {row.map((item) => (
                          <Action
                            key={item.label}
                            notation
                            showLabel
                            style={styles.paletteCell}
                            label={item.label}
                            accessibilityLabel={
                              item.accessibilityLabel ?? item.label
                            }
                            icon={item.icon}
                            selected={item.selected}
                            disabled={readOnly || item.disabled}
                            onPress={item.onPress}
                          />
                        ))}
                      </View>
                    ))}
                    {noteSettings.techniques?.includes("bend") && (
                      <View style={styles.paletteRow}>
                        {[0.5, 1, 1.5].map((bend) => (
                          <Action
                            key={bend}
                            notation
                            showLabel
                            style={styles.paletteCell}
                            label={`${bend} ${t("TabTone")}`}
                            selected={(noteSettings.bend ?? 1) === bend}
                            disabled={readOnly || !!selectedRest}
                            onPress={() => patchSettings({ bend })}
                          />
                        ))}
                      </View>
                    )}
                  </>
                )}
                {editorSection === "meter" && (
                  <>
                    <View style={styles.paletteRow}>
                      {meterChoices.map(([beats, unit]) => (
                        <Action
                          key={`${beats}/${unit}`}
                          notation
                          showLabel
                          style={styles.paletteCell}
                          label={`${beats}/${unit}`}
                          accessibilityLabel={t("TabMeterValue", {
                            beats,
                            unit
                          })}
                          selected={
                            meterChoice[0] === beats && meterChoice[1] === unit
                          }
                          disabled={readOnly}
                          onPress={() => setMeterChoice([beats, unit])}
                        />
                      ))}
                    </View>
                    <View style={styles.meterFooter}>
                      <Action
                        glass
                        label={t("Cancel")}
                        onPress={() => setEditorSection("note")}
                      />
                      <Action
                        glass
                        primary
                        label={t("Apply")}
                        disabled={readOnly}
                        onPress={() => {
                          if (apply(changeTabMeter(tab, ...meterChoice))) {
                            setNoteRange(null);
                            transport.setRange(null);
                            choosePage(0);
                            setEditorSection("note");
                          }
                        }}
                      />
                    </View>
                  </>
                )}
                {editorSection === "bars" && (
                  <View style={styles.paletteRow}>
                    {[
                      { label: "TabInsertBar", at: bar },
                      { label: "TabAppendBar", at: bar + 1 }
                    ].map((item) => (
                      <Action
                        key={item.label}
                        glass
                        icon="plus"
                        label={t(item.label)}
                        disabled={readOnly || bars >= TAB_MAX_BARS}
                        onPress={() => {
                          if (apply(insertTabBar(tab, item.at))) {
                            choosePage(item.at);
                            setEditorSection("score");
                          }
                        }}
                      />
                    ))}
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

const styles = StyleSheet.create({
  barGrid: { flexDirection: "row", flexWrap: "wrap" },
  rangeHandle: {
    position: "absolute",
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center"
  },
  rangeHandleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.glass.accent
  },
  staffPrefix: { flexDirection: "row", alignItems: "center" },
  rangeCell: {
    position: "absolute",
    backgroundColor: palette.glass.cell,
    opacity: 0.65,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.glass.accent
  },
  ovalNote: {
    backgroundColor: palette.colors.transparent,
    minWidth: 0,
    paddingHorizontal: 0,
    borderRadius: 18
  },
  noteMark: { position: "absolute", top: -10 },

  staffMeter: { minHeight: 36, justifyContent: "center", paddingHorizontal: 2 },
  staffMeterText: {
    color: palette.glass.accent,
    fontSize: 14,
    fontWeight: "600"
  },
  invalidDuration: {
    borderTopWidth: 2,
    borderTopColor: palette.error.main,
    marginHorizontal: 4,
    paddingTop: 2
  },
  invalidDurationText: {
    color: palette.error.main,
    fontSize: 10,
    textAlign: "center"
  },
  paletteRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingVertical: 6
  },
  paletteDivider: { borderTopWidth: 1, borderTopColor: palette.notation.edge },
  paletteCell: {
    width: 56,
    minWidth: 56,
    maxWidth: 56,
    height: 44,
    minHeight: 44,
    flex: 0
  },
  meterIcon: { color: palette.notation.gold, fontSize: 18, fontWeight: "600" },
  meterFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8
  },
  roundControl: {
    width: 36,
    height: 36,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    flex: 0,
    paddingHorizontal: 0
  },
  headerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0
  },
  headerTempo: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerBpm: { minWidth: 52, textAlign: "center", fontSize: 15 },
  compactFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge
  },
  loopControl: {
    flex: 0,
    width: 84,
    minWidth: 84,
    height: 38,
    minHeight: 38,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 0
  },
  footerSections: { flexDirection: "row", alignItems: "center", gap: 6 },
  navigation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    padding: 4,
    borderRadius: 24
  },
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    padding: 4,
    gap: 5,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 24,
    backgroundColor: palette.glass.card,
    marginVertical: 4
  },

  editorScreen: { flex: 1, backgroundColor: palette.paper.background },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge,
    zIndex: 20
  },
  editorIdentity: { flex: 1, minWidth: 40, gap: 2 },
  editorTitle: { fontSize: 19, fontWeight: "600" },
  headerMenu: { position: "relative", alignSelf: "center" },
  menuBackdrop: { zIndex: 10 },
  actionsMenu: {
    position: "absolute",
    zIndex: 30,
    width: 210,
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.header,
    elevation: 12
  },
  actionsMenuItem: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8
  },
  actionsMenuLabel: { color: palette.glass.ink, fontSize: 14 },
  actionsMenuPressed: { backgroundColor: palette.glass.cell },
  actionsMenuDisabled: { opacity: 0.4 },
  workspace: { flex: 1 },
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
  rhythmSvg: { position: "absolute" },
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
  effectRow: { height: 16 },
  effectSpan: {
    position: "absolute",
    height: 16,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 3
  },
  effectLabel: { color: palette.glass.accent, fontSize: 10, marginRight: 4 },
  effectRule: { flex: 1, height: 1, backgroundColor: palette.glass.accent },
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
    color: palette.glass.accent
  },
  compactFret: { fontSize: 12 },
  denseFret: { fontSize: 10, lineHeight: 12 },
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
    flex: 0,
    width: 126,
    minWidth: 126,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4
  },
  pageCaption: { flexShrink: 1, textAlign: "center" }
});
