import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
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
import { tabBarTicks, tablatureLength } from "../../components/tablature";
import type { TabPracticeSettings } from "../../components/tablature-practice";
import palette from "../../theme/palette";
import { TablatureBar } from "./tablature-panel";
import type { useTablature } from "./use-tablature";

type Transport = ReturnType<typeof useTablature>;
const sizes = [0.85, 1, 1.2, 1.4];

/** A performance surface: the score can only be read or used to seek. */
export function TablaturePractice({
  transport,
  title,
  onClose,
  active,
  disabled = false
}: {
  transport: Transport;
  title?: string;
  onClose: () => void;
  active: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const columns = landscape && width >= 740 ? 2 : 1;
  const list = useRef<FlatList<number[]>>(null);
  const [following, setFollowing] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [size, setSize] = useState(2);
  const [laidOut, setLaidOut] = useState(false);
  const { tab, tick, status, practice, countIn, range } = transport;
  const scale = sizes[size] * (landscape ? 0.8 : 1);
  const barTicks = tabBarTicks(tab);
  const bars = Math.max(1, Math.ceil(tablatureLength(tab) / barTicks));
  const currentBar = Math.max(
    0,
    Math.min(bars - 1, Math.floor(tick / barTicks))
  );
  // Card padding + heading + staff margins; every readonly staff has seven rows.
  const rowHeight = 70 + 244 * scale;
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(bars / columns) }, (_, row) =>
        Array.from(
          { length: Math.min(columns, bars - row * columns) },
          (_, column) => row * columns + column
        )
      ),
    [bars, columns]
  );
  const counting = status === "countingIn";
  const preparing = status === "preparing";
  const running = status === "playing" || preparing || counting;
  const recording =
    status === "recording" || (counting && countIn?.target === "record");
  const locked = disabled || !active || recording;
  const settingsLocked = locked || preparing || counting;
  const hasEvents = tab.notes.length > 0 || !!tab.rests?.length;
  const firstBar = range ? Math.floor(range.start / barTicks) + 1 : 1;
  const lastBar = range
    ? Math.min(bars, Math.ceil(range.end / barTicks))
    : bars;
  const playLabel = t(
    counting
      ? "TabCancelCountIn"
      : preparing
        ? "TabCancelPreparing"
        : running
          ? "Pause"
          : "TabPlay"
  );

  useEffect(() => {
    if (!active || !following || !laidOut) return;
    list.current?.scrollToIndex({
      index: Math.floor(currentBar / columns),
      animated: true,
      viewPosition: 0
    });
  }, [active, currentBar, columns, following, laidOut, rowHeight]);

  const updatePractice = (patch: Partial<TabPracticeSettings>) => {
    if (!settingsLocked) transport.setPractice({ ...practice, ...patch });
  };
  const updateTrainer = (patch: Partial<TabPracticeSettings["trainer"]>) =>
    updatePractice({ trainer: { ...practice.trainer, ...patch } });
  const changeRange = (first: number, last: number) => {
    if (settingsLocked) return;
    transport.setRange({ start: (first - 1) * barTicks, end: last * barTicks });
    transport.setLoop(true);
  };
  const stopFollowing = () => setFollowing(false);

  return (
    <Modal
      visible={active}
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={[
        "portrait",
        "landscape",
        "landscape-left",
        "landscape-right"
      ]}
      onRequestClose={() => (settingsOpen ? setSettingsOpen(false) : onClose())}
    >
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <View
          style={styles.content}
          accessibilityElementsHidden={settingsOpen}
          importantForAccessibility={
            settingsOpen ? "no-hide-descendants" : "auto"
          }
        >
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <Text style={styles.eyebrow}>{t("TabPractice")}</Text>
              <Text numberOfLines={1} style={styles.title}>
                {title || t("TabTitle")}
              </Text>
            </View>
            <PracticeButton
              icon="format-font-size-decrease"
              label={t("TabPracticeSmaller")}
              iconOnly
              disabled={size === 0}
              onPress={() => setSize((value) => Math.max(0, value - 1))}
            />
            <PracticeButton
              icon="format-font-size-increase"
              label={t("TabPracticeLarger")}
              iconOnly
              disabled={size === sizes.length - 1}
              onPress={() =>
                setSize((value) => Math.min(sizes.length - 1, value + 1))
              }
            />
            <PracticeButton
              icon="tune-variant"
              label={t("TabPracticeSettings")}
              iconOnly
              onPress={() => setSettingsOpen(true)}
            />
            <PracticeButton
              icon="close"
              label={t("TabPracticeClose")}
              iconOnly
              onPress={onClose}
            />
          </View>
          <View style={[styles.workspace, landscape && styles.landscape]}>
            <View style={styles.reading}>
              <View style={styles.summary}>
                <Text
                  style={styles.tempo}
                  accessibilityLabel={t("TabPracticeTempo", {
                    bpm: Math.round(transport.practiceBpm)
                  })}
                >
                  ♩ {Math.round(transport.practiceBpm)} BPM
                </Text>
                <Text style={styles.caption}>
                  {tab.beatsPerBar}/{tab.beatUnit ?? 4}
                </Text>
                <Text style={styles.caption}>
                  {t("TabBarOf", { current: currentBar + 1, total: bars })}
                </Text>
                <Text style={styles.caption}>
                  {t("TabPracticeRepeats", { count: transport.completedLoops })}
                </Text>
                {!following && (
                  <Text style={styles.manual}>{t("TabPracticeBrowsing")}</Text>
                )}
              </View>
              {counting && countIn && (
                <View
                  style={styles.countIn}
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={t("TabCountInStatus", {
                    ...countIn,
                    beats: tab.beatsPerBar
                  })}
                >
                  <Text style={styles.caption}>
                    {t("TabCountInProgress", {
                      bar: countIn.bar,
                      bars: countIn.bars
                    })}
                  </Text>
                  <View style={styles.beats}>
                    {Array.from({ length: tab.beatsPerBar }, (_, index) => (
                      <View
                        key={index}
                        testID={`practice-count-beat-${index + 1}`}
                        style={[
                          styles.countBeat,
                          tab.beatsPerBar === 6 &&
                            tab.beatUnit === 8 &&
                            index === 3 &&
                            styles.compoundBeat,
                          countIn.beat === index + 1 && styles.countBeatActive
                        ]}
                      >
                        <Text
                          style={[
                            styles.countNumber,
                            countIn.beat === index + 1 && styles.selectedText
                          ]}
                        >
                          {index + 1}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {preparing && (
                <Text accessibilityLiveRegion="polite" style={styles.notice}>
                  {t("TabPreparing")}
                </Text>
              )}
              {transport.error && (
                <Text accessibilityLiveRegion="polite" style={styles.notice}>
                  {t(transport.error)}
                </Text>
              )}
              <FlatList
                ref={list}
                testID="practice-bars"
                data={rows}
                keyExtractor={(row) => String(row[0])}
                extraData={{
                  currentBar,
                  tick,
                  following,
                  scale,
                  range,
                  locked
                }}
                style={styles.barList}
                contentContainerStyle={styles.barListContent}
                initialNumToRender={3}
                windowSize={5}
                maxToRenderPerBatch={4}
                getItemLayout={(_, index) => ({
                  length: rowHeight,
                  offset: rowHeight * index,
                  index
                })}
                onLayout={() => setLaidOut(true)}
                onScrollBeginDrag={stopFollowing}
                renderItem={({ item }) => (
                  <View style={[styles.barRow, { height: rowHeight }]}>
                    {item.map((bar) => {
                      const outsideRange =
                        !!range &&
                        (bar * barTicks < range.start ||
                          bar * barTicks >= range.end);
                      const selected = bar === currentBar;
                      const seekBar = () => {
                        if (locked || outsideRange) return;
                        transport.seek(bar * barTicks);
                        setFollowing(true);
                      };
                      return (
                        <Pressable
                          key={bar}
                          testID={`practice-bar-${bar}`}
                          accessible={false}
                          accessibilityRole="button"
                          accessibilityLabel={t("TabPracticeSeekBar", {
                            bar: bar + 1
                          })}
                          accessibilityHint={t(
                            outsideRange
                              ? "TabPracticeOutsideRange"
                              : "TabPracticeSeekHint"
                          )}
                          accessibilityState={{
                            selected,
                            disabled: locked || outsideRange
                          }}
                          disabled={locked || outsideRange}
                          onPress={seekBar}
                          style={[
                            styles.bar,
                            selected && styles.currentBar,
                            outsideRange && styles.outsideRange
                          ]}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("TabPracticeSeekBar", {
                              bar: bar + 1
                            })}
                            accessibilityHint={t(
                              outsideRange
                                ? "TabPracticeOutsideRange"
                                : "TabPracticeSeekHint"
                            )}
                            accessibilityState={{
                              selected,
                              disabled: locked || outsideRange
                            }}
                            disabled={locked || outsideRange}
                            onPress={seekBar}
                            style={styles.barHeading}
                          >
                            <Text
                              style={[
                                styles.barNumber,
                                selected && styles.accent
                              ]}
                            >
                              {t("TabPracticeBar", { bar: bar + 1 })}
                            </Text>
                            {selected && (
                              <MaterialCommunityIcons
                                name="play"
                                size={18}
                                color={palette.glass.accent}
                              />
                            )}
                          </Pressable>
                          <TablatureBar
                            tab={tab}
                            bar={bar}
                            tick={tick}
                            readOnly
                            readingScale={scale}
                            followPlayback={following}
                            onManualScroll={stopFollowing}
                          />
                        </Pressable>
                      );
                    })}
                    {item.length < columns && <View style={styles.emptyBar} />}
                  </View>
                )}
              />
            </View>
            <View style={[styles.transport, landscape && styles.transportRail]}>
              <PracticeButton
                rail={landscape}
                icon="skip-backward"
                label={t("TabRewind")}
                disabled={locked || !hasEvents}
                onPress={() => {
                  if (locked) return;
                  transport.rewind();
                  setFollowing(true);
                }}
              />
              <PracticeButton
                rail={landscape}
                icon={
                  counting || preparing ? "stop" : running ? "pause" : "play"
                }
                label={playLabel}
                primary
                selected={running}
                disabled={
                  disabled ||
                  !active ||
                  status === "recording" ||
                  (!hasEvents && !running)
                }
                onPress={() => {
                  if (disabled || !active || status === "recording") return;
                  if (running) transport.pause();
                  else {
                    setFollowing(true);
                    void transport.play();
                  }
                }}
              />
              <PracticeButton
                rail={landscape}
                icon="repeat"
                label={t("TabLoop")}
                toggle
                selected={transport.loop}
                disabled={settingsLocked || !hasEvents}
                onPress={() => {
                  if (!settingsLocked) transport.setLoop(!transport.loop);
                }}
              />
              <PracticeButton
                rail={landscape}
                icon="metronome"
                label={t("TabMetronome")}
                toggle
                selected={practice.metronome}
                disabled={settingsLocked}
                onPress={() =>
                  updatePractice({ metronome: !practice.metronome })
                }
              />
              <PracticeButton
                rail={landscape}
                icon="crosshairs-gps"
                label={t(
                  following ? "TabPracticeFollowing" : "TabPracticeFollow"
                )}
                selected={following}
                onPress={() => setFollowing(true)}
              />
            </View>
          </View>
        </View>
        {settingsOpen && (
          <View style={styles.settingsOverlay} accessibilityViewIsModal>
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityLabel={t("TabPracticeCloseSettings")}
              onPress={() => setSettingsOpen(false)}
            />
            <View
              style={[
                styles.settingsPanel,
                { maxHeight: height - 40, width: Math.min(width - 24, 600) }
              ]}
            >
              <View style={styles.settingsHeader}>
                <Text style={styles.sectionTitle}>
                  {t("TabPracticeSettings")}
                </Text>
                <PracticeButton
                  icon="close"
                  label={t("TabPracticeCloseSettings")}
                  iconOnly
                  onPress={() => setSettingsOpen(false)}
                />
              </View>
              <ScrollView contentContainerStyle={styles.settingsContent}>
                {(counting || preparing) && (
                  <Text style={styles.caption}>
                    {t("TabPracticeSettingsPending")}
                  </Text>
                )}
                <Text style={styles.sectionTitle}>{t("TabMetronome")}</Text>
                <PracticeButton
                  label={t("TabMetronomeEnabled")}
                  toggle
                  selected={practice.metronome}
                  disabled={settingsLocked}
                  onPress={() =>
                    updatePractice({ metronome: !practice.metronome })
                  }
                />
                <PracticeStepper
                  label={t("TabMetronomeVolume")}
                  value={Math.round(practice.volume * 100)}
                  min={0}
                  max={100}
                  step={10}
                  suffix="%"
                  disabled={settingsLocked}
                  onChange={(volume) =>
                    updatePractice({ volume: volume / 100 })
                  }
                />
                <Text style={styles.sectionTitle}>{t("TabCountIn")}</Text>
                <View style={styles.options}>
                  {([0, 1, 2] as const).map((countInBars) => (
                    <PracticeButton
                      key={countInBars}
                      label={t(
                        countInBars === 0
                          ? "TabCountInOff"
                          : countInBars === 1
                            ? "TabCountInOne"
                            : "TabCountInTwo"
                      )}
                      selected={practice.countInBars === countInBars}
                      disabled={settingsLocked}
                      onPress={() => updatePractice({ countInBars })}
                    />
                  ))}
                </View>
                <PracticeButton
                  label={t("TabCountInBetweenLoops")}
                  toggle
                  selected={practice.countInBetweenLoops}
                  disabled={settingsLocked || practice.countInBars === 0}
                  onPress={() =>
                    updatePractice({
                      countInBetweenLoops: !practice.countInBetweenLoops
                    })
                  }
                />
                <Text style={styles.caption}>{t("TabCountInHint")}</Text>
                <Text style={styles.sectionTitle}>{t("TabTrainer")}</Text>
                <PracticeButton
                  label={t("TabTrainerEnabled")}
                  toggle
                  selected={practice.trainer.enabled}
                  disabled={settingsLocked || !hasEvents}
                  onPress={() =>
                    updateTrainer({ enabled: !practice.trainer.enabled })
                  }
                />
                <PracticeStepper
                  label={t("TabTrainerStart")}
                  value={practice.trainer.startBpm}
                  min={20}
                  max={300}
                  step={5}
                  disabled={settingsLocked}
                  onChange={(startBpm) =>
                    updateTrainer({
                      startBpm,
                      targetBpm: Math.max(startBpm, practice.trainer.targetBpm)
                    })
                  }
                />
                <PracticeStepper
                  label={t("TabTrainerTarget")}
                  value={practice.trainer.targetBpm}
                  min={practice.trainer.startBpm}
                  max={300}
                  step={5}
                  disabled={settingsLocked}
                  onChange={(targetBpm) => updateTrainer({ targetBpm })}
                />
                <PracticeStepper
                  label={t("TabTrainerStep")}
                  value={practice.trainer.stepBpm}
                  min={1}
                  max={20}
                  disabled={settingsLocked}
                  onChange={(stepBpm) => updateTrainer({ stepBpm })}
                />
                <PracticeStepper
                  label={t("TabTrainerRepeats")}
                  value={practice.trainer.repeats}
                  min={1}
                  max={16}
                  disabled={settingsLocked}
                  onChange={(repeats) => updateTrainer({ repeats })}
                />
                <Text style={styles.caption}>{t("TabTrainerHint")}</Text>
                <Text style={styles.sectionTitle}>{t("TabSpeed")}</Text>
                <View style={styles.options}>
                  {[0.5, 0.75, 1].map((speed) => (
                    <PracticeButton
                      key={speed}
                      label={`${Math.round(speed * 100)}%`}
                      accessibilityLabel={t("TabSpeedPercent", {
                        percent: Math.round(speed * 100)
                      })}
                      selected={
                        !practice.trainer.enabled && transport.speed === speed
                      }
                      disabled={settingsLocked}
                      onPress={() => {
                        if (!settingsLocked) transport.setSpeed(speed);
                      }}
                    />
                  ))}
                </View>
                <Text style={styles.caption}>
                  {t("TabTrainerManualSpeedHint")}
                </Text>
                <Text style={styles.sectionTitle}>{t("TabLoopRange")}</Text>
                <PracticeButton
                  label={t("TabWholePiece")}
                  selected={range === null}
                  disabled={settingsLocked}
                  onPress={() => {
                    if (!settingsLocked) transport.setRange(null);
                  }}
                />
                <PracticeStepper
                  label={t("TabRangeFrom")}
                  value={firstBar}
                  min={1}
                  max={lastBar}
                  disabled={settingsLocked}
                  onChange={(first) => changeRange(first, lastBar)}
                />
                <PracticeStepper
                  label={t("TabRangeTo")}
                  value={lastBar}
                  min={firstBar}
                  max={bars}
                  disabled={settingsLocked}
                  onChange={(last) => changeRange(firstBar, last)}
                />
              </ScrollView>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function PracticeButton({
  label,
  accessibilityLabel,
  icon,
  iconOnly = false,
  selected = false,
  disabled = false,
  primary = false,
  toggle = false,
  rail = false,
  onPress
}: {
  label: string;
  accessibilityLabel?: string;
  icon?: string;
  iconOnly?: boolean;
  selected?: boolean;
  disabled?: boolean;
  primary?: boolean;
  toggle?: boolean;
  rail?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        disabled,
        ...(toggle ? { checked: selected } : { selected })
      }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        iconOnly && styles.iconButton,
        primary && styles.primaryButton,
        rail && styles.railButton,
        selected && styles.selectedButton,
        disabled && styles.disabled
      ]}
    >
      {icon && (
        <MaterialCommunityIcons
          name={icon}
          size={primary ? 30 : 24}
          color={selected || primary ? palette.gold.ink : palette.glass.accent}
        />
      )}
      {!iconOnly && (
        <Text
          numberOfLines={2}
          style={[
            styles.buttonText,
            !icon && styles.optionText,
            (selected || primary) && styles.selectedText
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function PracticeStepper({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <PracticeButton
        label="−"
        accessibilityLabel={`${label}: −`}
        disabled={disabled || value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
      />
      <Text style={styles.stepperValue}>
        {value}
        {suffix}
      </Text>
      <PracticeButton
        label="+"
        accessibilityLabel={`${label}: +`}
        disabled={disabled || value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.paper.background },
  content: { flex: 1 },
  header: {
    minHeight: 56,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge
  },
  titleGroup: { flex: 1, minWidth: 0 },
  eyebrow: { color: palette.glass.accent, fontSize: 11 },
  title: { fontSize: 17, fontWeight: "600" },
  workspace: { flex: 1 },
  landscape: { flexDirection: "row" },
  reading: { flex: 1, minWidth: 0 },
  summary: {
    minHeight: 38,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 10
  },
  tempo: { fontSize: 14, fontWeight: "600", color: palette.glass.accent },
  caption: { fontSize: 12, lineHeight: 18, color: palette.glass.muted },
  manual: { fontSize: 12, color: palette.glass.accent },
  barList: { flex: 1 },
  barListContent: { paddingHorizontal: 10, paddingBottom: 8 },
  barRow: { flexDirection: "row", gap: 10, paddingBottom: 12 },
  bar: {
    flex: 1,
    minWidth: 0,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.control
  },
  currentBar: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.paper.soft
  },
  outsideRange: { opacity: 0.45 },
  emptyBar: { flex: 1 },
  barHeading: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  barNumber: { fontSize: 13, color: palette.glass.muted },
  accent: { color: palette.glass.accent },
  transport: {
    flexDirection: "row",
    justifyContent: "space-around",
    gap: 4,
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge,
    backgroundColor: palette.glass.header
  },
  transportRail: {
    width: 124,
    padding: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
    borderTopWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: palette.glass.edge
  },
  button: {
    minWidth: 44,
    minHeight: 52,
    flexShrink: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.control,
    alignItems: "center",
    justifyContent: "center",
    gap: 2
  },
  iconButton: { width: 44, minHeight: 44, padding: 6 },
  primaryButton: { backgroundColor: palette.glass.accent, minWidth: 64 },
  railButton: { width: 50, minWidth: 50, minHeight: 56, paddingHorizontal: 3 },
  selectedButton: {
    backgroundColor: palette.glass.accent,
    borderColor: palette.glass.accent
  },
  buttonText: { fontSize: 10, textAlign: "center", color: palette.glass.ink },
  optionText: { fontSize: 13 },
  selectedText: { color: palette.gold.ink },
  disabled: { opacity: 0.4 },
  countIn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge
  },
  beats: { flexDirection: "row", gap: 6 },
  countBeat: {
    minWidth: 30,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.paper.soft
  },
  compoundBeat: { marginLeft: 8 },
  countBeatActive: { backgroundColor: palette.glass.accent },
  countNumber: { fontSize: 22, fontWeight: "600" },
  notice: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    color: palette.glass.accent,
    fontSize: 13
  },
  settingsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.finish.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: 12
  },
  settingsPanel: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.paper.soft,
    overflow: "hidden"
  },
  settingsHeader: {
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge
  },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: palette.glass.ink },
  settingsContent: { padding: 16, gap: 14 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepperLabel: { flex: 1, fontSize: 13 },
  stepperValue: { minWidth: 40, textAlign: "center", fontSize: 16 }
});
