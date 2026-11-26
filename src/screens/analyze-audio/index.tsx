import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  analyzeAudioFile,
  chordAnalysisCancelled,
  chordTime,
  offlineChordDraft,
  type OfflineChordAnalysis
} from "../../components/offline-chords";
import {
  chordSection,
  parseChordRange,
  type ChordRange,
  type ChordSectionRow
} from "../../components/offline-chord-section";
import type { NavigationProp } from "../../router";
import palette from "../../theme/palette";
import { Action } from "../song/tools";

const errors: Record<string, string> = {
  AudioTooShort: "OfflineChordsTooShort",
  AudioTooLong: "OfflineChordsTooLong",
  Busy: "OfflineChordsBusy",
  ChordAnalysisUnsupported: "OfflineChordsUnavailable",
  AnalysisUnsupported: "OfflineChordsUnavailable",
  FileUnavailable: "OfflineChordsFileError",
  FileReadTimeout: "OfflineChordsFileError",
  UnsupportedAudio: "OfflineChordsFormatError",
  UnsupportedPcmFormat: "OfflineChordsFormatError",
  NoAudioTrack: "OfflineChordsFormatError",
  AudioDecodeFailed: "OfflineChordsFormatError"
};

export default function AnalyzeAudio() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const controller = useRef<AbortController | null>(null);
  const container = useRef<View>(null);
  const endInput = useRef<TextInput>(null);
  const [screenTop, setScreenTop] = useState(0);
  const [stage, setStage] = useState<"" | "picking" | "analyzing" | "stopping">(
    ""
  );
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<OfflineChordAnalysis | null>(null);
  const [range, setRange] = useState<ChordRange | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [appliedText, setAppliedText] = useState({ start: "", end: "" });
  const [rangeError, setRangeError] = useState(false);
  const dirtyRange =
    startText !== appliedText.start || endText !== appliedText.end;
  const section = useMemo(
    () => (result ? chordSection(result, range ?? undefined) : null),
    [result, range]
  );
  useFocusEffect(
    useCallback(() => {
      setStage("");
      return () => {
        controller.current?.abort();
        controller.current = null;
      };
    }, [])
  );
  const start = async () => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setStage("picking");
    setMessage("");
    try {
      const next = await analyzeAudioFile(abort.signal, () => {
        if (controller.current === abort) setStage("analyzing");
      });
      if (controller.current === abort && !abort.signal.aborted) {
        // A cancelled or failed replacement keeps the current inspection intact.
        const texts = { start: chordTime(0), end: chordTime(next.duration) };
        setRange(null);
        setStartText(texts.start);
        setEndText(texts.end);
        setAppliedText(texts);
        setRangeError(false);
        setResult(next);
      }
    } catch (error) {
      if (controller.current !== abort) return;
      if (abort.signal.aborted || chordAnalysisCancelled(error)) {
        setMessage(t("OfflineChordsCancelled"));
      } else {
        const failure = error as { code?: string; message?: string };
        setMessage(
          t(
            errors[failure?.code ?? failure?.message ?? ""] ??
              "OfflineChordsError"
          )
        );
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setStage("");
      }
    }
  };
  const applyRange = () => {
    if (!result || stage || controller.current) return;
    const next = parseChordRange(startText, endText, result.duration);
    if (!next) {
      setRangeError(true);
      return;
    }
    setRange(next.start === 0 && next.end === result.duration ? null : next);
    // Preserve entered precision; formatting is only for displayed timestamps.
    setAppliedText({ start: startText, end: endText });
    setRangeError(false);
    setMessage("");
    Keyboard.dismiss();
  };
  const wholeRecording = () => {
    if (!result || stage || controller.current) return;
    const texts = { start: chordTime(0), end: chordTime(result.duration) };
    setRange(null);
    setStartText(texts.start);
    setEndText(texts.end);
    setAppliedText(texts);
    setRangeError(false);
    setMessage("");
    Keyboard.dismiss();
  };
  const hasChords = section?.rows.some(
    (row) => row.kind === "chord" && row.chord !== "N"
  );
  const clipped = section?.rows.some(
    (row) => row.kind === "chord" && (row.startClipped || row.endClipped)
  );
  const renderSegment = ({ item }: { item: ChordSectionRow }) => {
    const boundary =
      item.kind === "chord" && (item.startClipped || item.endClipped);
    const unknown = item.kind === "gap" || item.chord === "N";
    return (
      <View
        style={[styles.segment, item.kind === "gap" && styles.missingSegment]}
      >
        <View style={styles.segmentHeading}>
          <Text style={styles.time}>
            {`${chordTime(item.start)}–${chordTime(item.end)}${boundary ? " *" : ""}`}
          </Text>
          <Text style={[styles.chord, unknown && styles.unknownChord]}>
            {item.kind === "gap"
              ? t("OfflineChordsMissing")
              : item.chord === "N"
                ? t("OfflineChordsUnknown")
                : item.chord}
          </Text>
        </View>
        {boundary && item.kind === "chord" && (
          <Text style={styles.originalTime}>
            {t("OfflineChordsOriginalInterval", {
              start: chordTime(item.sourceStart),
              end: chordTime(item.sourceEnd)
            })}
          </Text>
        )}
      </View>
    );
  };
  return (
    <View
      ref={container}
      style={styles.flex}
      onLayout={() =>
        container.current?.measureInWindow((_, y) => setScreenTop(y))
      }
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={screenTop}
      >
        <FlatList
          data={section?.rows ?? []}
          keyExtractor={(item, index) => `${item.kind}:${item.start}:${index}`}
          renderItem={renderSegment}
          initialNumToRender={24}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 24 }
          ]}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.description}>
                {t("OfflineChordsDescription")}
              </Text>
              <Text style={styles.hint}>{t("OfflineChordsFormats")}</Text>
              <Action
                label={t(
                  result
                    ? "OfflineChordsAnotherFile"
                    : "OfflineChordsChooseFile"
                )}
                icon="file-music-outline"
                primary
                disabled={!!stage}
                onPress={() => void start()}
              />
              {!!stage && (
                <View style={styles.progress}>
                  <ActivityIndicator color={palette.glass.accent} />
                  <Text accessibilityLiveRegion="polite" style={styles.status}>
                    {t(
                      stage === "picking"
                        ? "OfflineChordsPicking"
                        : stage === "stopping"
                          ? "AutofillStopping"
                          : "OfflineChordsAnalyzing"
                    )}
                  </Text>
                  <Action
                    label={t("Cancel")}
                    disabled={stage === "stopping"}
                    onPress={() => {
                      setStage("stopping");
                      controller.current?.abort();
                    }}
                  />
                </View>
              )}
              {!!message && (
                <Text accessibilityLiveRegion="polite" style={styles.status}>
                  {message}
                </Text>
              )}
              {!!result && (
                <>
                  <Text accessibilityRole="header" style={styles.title}>
                    {result.fileName || t("OfflineChordsTitle")}
                  </Text>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    {t("OfflineChordsFullRecording")}
                  </Text>
                  <Text style={styles.metadata}>
                    {t("OfflineChordsDuration", {
                      duration: chordTime(result.duration)
                    })}
                  </Text>
                  {result.key !== null && (
                    <Text style={styles.metadata}>
                      {t("OfflineChordsKey", { key: result.key })}
                    </Text>
                  )}
                  {result.tempo !== null && (
                    <Text style={styles.metadata}>
                      {t("OfflineChordsTempo", {
                        tempo: Math.round(result.tempo)
                      })}
                    </Text>
                  )}
                  <Text style={styles.metadata}>
                    {t("OfflineChordsElapsed", {
                      seconds: (result.elapsedMs / 1000).toFixed(1)
                    })}
                  </Text>
                  <Text style={styles.hint}>{t("OfflineChordsNotice")}</Text>
                  <View style={styles.rangeCard}>
                    <Text
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
                      {t("OfflineChordsSectionTitle")}
                    </Text>
                    <Text style={styles.hint}>
                      {t("OfflineChordsRangeHint")}
                    </Text>
                    <View style={styles.rangeFields}>
                      <View style={styles.rangeField}>
                        <Text style={styles.inputLabel}>
                          {t("OfflineChordsRangeFrom")}
                        </Text>
                        <TextInput
                          testID="offline-range-start"
                          accessibilityLabel={t("OfflineChordsRangeFrom")}
                          value={startText}
                          editable={!stage}
                          maxLength={16}
                          keyboardType={
                            Platform.OS === "ios"
                              ? "numbers-and-punctuation"
                              : "default"
                          }
                          keyboardAppearance="dark"
                          autoCorrect={false}
                          autoCapitalize="none"
                          returnKeyType="next"
                          selectionColor={palette.glass.accent}
                          style={[
                            styles.timeInput,
                            rangeError && styles.invalidInput
                          ]}
                          onChangeText={(text) => {
                            if (stage || controller.current) return;
                            setStartText(text);
                            setRangeError(false);
                          }}
                          onSubmitEditing={() => endInput.current?.focus()}
                        />
                      </View>
                      <View style={styles.rangeField}>
                        <Text style={styles.inputLabel}>
                          {t("OfflineChordsRangeTo")}
                        </Text>
                        <TextInput
                          ref={endInput}
                          testID="offline-range-end"
                          accessibilityLabel={t("OfflineChordsRangeTo")}
                          value={endText}
                          editable={!stage}
                          maxLength={16}
                          keyboardType={
                            Platform.OS === "ios"
                              ? "numbers-and-punctuation"
                              : "default"
                          }
                          keyboardAppearance="dark"
                          autoCorrect={false}
                          autoCapitalize="none"
                          returnKeyType="done"
                          selectionColor={palette.glass.accent}
                          style={[
                            styles.timeInput,
                            rangeError && styles.invalidInput
                          ]}
                          onChangeText={(text) => {
                            if (stage || controller.current) return;
                            setEndText(text);
                            setRangeError(false);
                          }}
                          onSubmitEditing={applyRange}
                        />
                      </View>
                    </View>
                    <View style={styles.rangeActions}>
                      <Action
                        label={t("OfflineChordsRangeApply")}
                        disabled={!!stage}
                        onPress={applyRange}
                        style={styles.rangeAction}
                      />
                      <Action
                        label={t("OfflineChordsRangeAll")}
                        disabled={!!stage}
                        selected={!range && !dirtyRange}
                        onPress={wholeRecording}
                        style={styles.rangeAction}
                      />
                    </View>
                    {rangeError && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.status}
                      >
                        {t("OfflineChordsRangeInvalid", {
                          end: chordTime(result.duration)
                        })}
                      </Text>
                    )}
                    {dirtyRange && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.hint}
                      >
                        {t("OfflineChordsRangePending")}
                      </Text>
                    )}
                  </View>
                  {!!section && (
                    <>
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        {t(
                          range
                            ? "OfflineChordsRangeApplied"
                            : "OfflineChordsRangeWhole",
                          {
                            start: chordTime(section.start),
                            end: chordTime(section.end)
                          }
                        )}
                      </Text>
                      {section.unknownSeconds > 0 && (
                        <Text style={styles.hint}>
                          {t("OfflineChordsSectionUnknownDuration", {
                            duration: chordTime(section.unknownSeconds)
                          })}
                        </Text>
                      )}
                      {section.missingSeconds > 0 && (
                        <>
                          <Text style={styles.hint}>
                            {t("OfflineChordsSectionMissingDuration", {
                              duration: chordTime(section.missingSeconds)
                            })}
                          </Text>
                          <Text style={styles.hint}>
                            {t("OfflineChordsMissingHint")}
                          </Text>
                        </>
                      )}
                      {!!clipped && (
                        <Text style={styles.hint}>
                          {t("OfflineChordsBoundaryNotice")}
                        </Text>
                      )}
                    </>
                  )}
                  {hasChords ? (
                    <Action
                      label={t(
                        range ? "OfflineChordsSectionEdit" : "OfflineChordsEdit"
                      )}
                      icon="pencil-outline"
                      disabled={!!stage || dirtyRange}
                      onPress={() => {
                        if (stage || controller.current || dirtyRange) return;
                        let draft;
                        try {
                          draft = offlineChordDraft(
                            result,
                            t("OfflineChordsTitle"),
                            t("OfflineChordsChartNotice"),
                            t("OfflineChordsUnknown"),
                            {
                              range: range ?? undefined,
                              missingLabel: t("OfflineChordsMissing"),
                              rangeNotice: range
                                ? t("OfflineChordsSectionChartNotice", {
                                    start: chordTime(range.start),
                                    end: chordTime(range.end),
                                    duration: chordTime(result.duration)
                                  })
                                : undefined,
                              boundaryNotice: t("OfflineChordsBoundaryNotice")
                            }
                          );
                        } catch {
                          setMessage(t("OfflineChordsChartTooLarge"));
                          return;
                        }
                        navigation.navigate("createSong", {
                          draft,
                          notice: "OfflineChordsNotice"
                        });
                      }}
                    />
                  ) : (
                    <Text style={styles.status}>
                      {t(
                        range
                          ? "OfflineChordsSectionNoChords"
                          : "OfflineChordsNoChords"
                      )}
                    </Text>
                  )}
                  <Text style={styles.hint}>
                    {t("OfflineChordsUnknownHint")}
                  </Text>
                </>
              )}
            </View>
          }
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 6 },
  header: { gap: 12, paddingBottom: 14 },
  description: { color: palette.glass.ink, fontSize: 17, lineHeight: 25 },
  title: { color: palette.glass.ink, fontSize: 21, fontWeight: "600" },
  hint: { color: palette.glass.muted, fontSize: 14, lineHeight: 21 },
  metadata: { color: palette.glass.ink, fontSize: 15 },
  progress: { gap: 12, paddingVertical: 10 },
  status: { color: palette.glass.ink, fontSize: 15, lineHeight: 22 },
  sectionTitle: { color: palette.glass.ink, fontSize: 16, fontWeight: "600" },
  rangeCard: {
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: palette.glass.card
  },
  rangeFields: { flexDirection: "row", gap: 12 },
  rangeField: { flex: 1, minWidth: 0, gap: 6 },
  inputLabel: { color: palette.glass.muted, fontSize: 14 },
  timeInput: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 10,
    color: palette.glass.ink,
    backgroundColor: palette.glass.control,
    fontSize: 16,
    fontVariant: ["tabular-nums"]
  },
  invalidInput: { borderColor: palette.glass.accent },
  rangeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rangeAction: { flexGrow: 1, flexBasis: 120 },
  segment: {
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: palette.glass.card
  },
  segmentHeading: { flexDirection: "row", alignItems: "center", gap: 16 },
  missingSegment: { backgroundColor: palette.glass.control },
  originalTime: { color: palette.glass.muted, fontSize: 12, lineHeight: 18 },
  time: { color: palette.glass.muted, fontSize: 15, flex: 1 },
  chord: { color: palette.glass.accent, fontSize: 22, fontWeight: "600" },
  unknownChord: {
    color: palette.glass.muted,
    fontSize: 14,
    fontWeight: "400",
    flexShrink: 1,
    maxWidth: "45%",
    textAlign: "right"
  }
});
