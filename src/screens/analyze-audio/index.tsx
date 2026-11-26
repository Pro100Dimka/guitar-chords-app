import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  analyzeAudioFile,
  chordAnalysisCancelled,
  chordTime,
  offlineChordDraft,
  type ChordSegment,
  type OfflineChordAnalysis
} from "../../components/offline-chords";
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
  const [stage, setStage] = useState<"" | "picking" | "analyzing" | "stopping">(
    ""
  );
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<OfflineChordAnalysis | null>(null);
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
  const hasChords = result?.segments.some((segment) => segment.chord !== "N");
  const renderSegment = ({ item }: { item: ChordSegment }) => (
    <View style={styles.segment}>
      <Text style={styles.time}>
        {chordTime(item.start)}–{chordTime(item.end)}
      </Text>
      <Text style={styles.chord}>{item.chord === "N" ? "—" : item.chord}</Text>
    </View>
  );
  return (
    <FlatList
      data={result?.segments ?? []}
      keyExtractor={(_, index) => String(index)}
      renderItem={renderSegment}
      initialNumToRender={24}
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
              result ? "OfflineChordsAnotherFile" : "OfflineChordsChooseFile"
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
                  {t("OfflineChordsTempo", { tempo: Math.round(result.tempo) })}
                </Text>
              )}
              <Text style={styles.metadata}>
                {t("OfflineChordsElapsed", {
                  seconds: (result.elapsedMs / 1000).toFixed(1)
                })}
              </Text>
              <Text style={styles.hint}>{t("OfflineChordsNotice")}</Text>
              {hasChords ? (
                <Action
                  label={t("OfflineChordsEdit")}
                  icon="pencil-outline"
                  disabled={!!stage}
                  onPress={() => {
                    let draft;
                    try {
                      draft = offlineChordDraft(
                        result,
                        t("OfflineChordsTitle"),
                        t("OfflineChordsChartNotice")
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
                <Text style={styles.status}>{t("OfflineChordsNoChords")}</Text>
              )}
              <Text style={styles.hint}>{t("OfflineChordsUnknownHint")}</Text>
            </>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 6 },
  header: { gap: 12, paddingBottom: 14 },
  description: { color: palette.glass.ink, fontSize: 17, lineHeight: 25 },
  title: { color: palette.glass.ink, fontSize: 21, fontWeight: "600" },
  hint: { color: palette.glass.muted, fontSize: 14, lineHeight: 21 },
  metadata: { color: palette.glass.ink, fontSize: 15 },
  progress: { gap: 12, paddingVertical: 10 },
  status: { color: palette.glass.ink, fontSize: 15, lineHeight: 22 },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: palette.glass.card
  },
  time: { color: palette.glass.muted, fontSize: 15, flex: 1 },
  chord: { color: palette.glass.accent, fontSize: 22, fontWeight: "600" }
});
