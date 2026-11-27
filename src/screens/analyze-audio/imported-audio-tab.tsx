import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { normalizeTablature, type Tablature } from "../../components/tablature";
import type {
  AudioNoteTranscription,
  AudioRhythmAnalysis
} from "../../components/audio-transcription";
import {
  AUDIO_TAB_MAX_BARS,
  AUDIO_TAB_MAX_NOTES,
  type projectAudioTablature
} from "../../components/audio-tablature";
import { chordTime } from "../../components/offline-chords";
import Text from "../../components/styled-text";
import palette from "../../theme/palette";
import { Action, TempoControl } from "../song/tools";
import { TablaturePanel } from "../play/tablature-panel";
import { useTablature } from "../play/use-tablature";

const styleKeys = {
  strumming: "OfflineAudioStyleStrumming",
  picking: "OfflineAudioStylePicking",
  mixed: "OfflineAudioStyleMixed",
  undetermined: "OfflineAudioStyleUndetermined"
};
const projectionErrors = {
  invalidRange: "OfflineAudioRangeInvalid",
  invalidTempo: "OfflineAudioTempoInvalid",
  invalidNotes: "OfflineAudioNotesInvalid",
  incompleteCoverage: "OfflineAudioIncomplete",
  selectShorter: "OfflineAudioSelectShorter",
  noPlayableNotes: "OfflineAudioNoPlayableNotes"
};
const pitchName = (midi: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;

export function AudioPerformanceCard({
  notes,
  rhythm,
  projection,
  tempo,
  estimatedTempo,
  disabled,
  hasTab,
  edited,
  tempoPending,
  onTempo,
  onGenerate,
  onOpen
}: {
  notes?: AudioNoteTranscription;
  rhythm: AudioRhythmAnalysis | null;
  projection: ReturnType<typeof projectAudioTablature> | null;
  tempo: number;
  estimatedTempo: number | null;
  disabled: boolean;
  hasTab: boolean;
  edited: boolean;
  tempoPending: boolean;
  onTempo: (tempo: number) => void;
  onGenerate: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const examples = rhythm?.attacks.slice(0, 8) ?? [];
  const sections = rhythm?.sections.slice(0, 8) ?? [];
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("OfflineAudioPerformanceTitle")}
      </Text>
      {!notes || !rhythm ? (
        <Text style={styles.hint}>{t("OfflineAudioNotesUnavailable")}</Text>
      ) : (
        <>
          <Text style={styles.text}>
            {t("OfflineAudioStyleEstimate", {
              style: t(styleKeys[rhythm.style])
            })}
          </Text>
          <Text style={styles.hint}>{t("OfflineAudioStyleNotice")}</Text>
          {!rhythm.complete && (
            <Text style={styles.text}>
              {t("OfflineAudioCoverage", { end: chordTime(notes.coverageEnd) })}
            </Text>
          )}
          {sections.length > 1 && (
            <View style={styles.events}>
              {sections.map((section, index) => (
                <Text key={index} style={styles.hint}>
                  {t("OfflineAudioStyleSection", {
                    start: chordTime(section.start),
                    end: chordTime(section.end),
                    style: t(styleKeys[section.style])
                  })}
                </Text>
              ))}
              {rhythm.sections.length > sections.length && (
                <Text style={styles.hint}>
                  {t("OfflineAudioMoreSections", {
                    count: rhythm.sections.length - sections.length
                  })}
                </Text>
              )}
            </View>
          )}
          {!!examples.length && (
            <View style={styles.events}>
              <Text style={styles.text}>
                {t("OfflineAudioAttackPreview", {
                  shown: examples.length,
                  count: rhythm.attackCount
                })}
              </Text>
              {examples.map((attack, index) => (
                <Text key={index} style={styles.event}>
                  {`${chordTime(attack.time)}  ${attack.pitches.map(pitchName).join(" · ")}`}
                </Text>
              ))}
              {rhythm.attackCount > examples.length && (
                <Text style={styles.hint}>
                  {t("OfflineAudioAttackPreviewHint")}
                </Text>
              )}
            </View>
          )}
          <TempoControl
            value={tempo}
            label={t("OfflineAudioLayoutTempo")}
            disabled={disabled}
            onChange={onTempo}
          />
          <Text style={styles.hint}>
            {t(
              estimatedTempo === null
                ? "OfflineAudioTempoUnknown"
                : tempo === Math.round(estimatedTempo)
                  ? "OfflineAudioTempoEstimated"
                  : "OfflineAudioTempoChosen",
              { tempo }
            )}
          </Text>
          <Text style={styles.hint}>{t("OfflineAudioTabAssumptions")}</Text>
          {projection?.status === "ready" ? (
            <View style={styles.events}>
              <Text style={styles.text}>
                {t("OfflineAudioProjectionCounts", { ...projection.counts })}
              </Text>
              <Text style={styles.hint}>
                {t("OfflineAudioProjectionSkipped", { ...projection.counts })}
              </Text>
              <Text style={styles.hint}>
                {t("OfflineAudioProjectionClipped", { ...projection.counts })}
              </Text>
              <Action
                label={t(
                  hasTab
                    ? "OfflineAudioRegenerateTabs"
                    : "OfflineAudioGenerateTabs"
                )}
                icon="music-note-plus"
                disabled={disabled}
                onPress={onGenerate}
              />
            </View>
          ) : projection?.status === "unavailable" ? (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {projection.reason === "selectShorter"
                ? t("OfflineAudioSelectShorter", {
                    notes: AUDIO_TAB_MAX_NOTES,
                    bars: AUDIO_TAB_MAX_BARS
                  })
                : t(projectionErrors[projection.reason])}
            </Text>
          ) : null}
          {tempoPending && (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {t("OfflineAudioTempoPending")}
            </Text>
          )}
          {hasTab && (
            <>
              <Text style={styles.hint}>
                {t(edited ? "OfflineAudioTabEdited" : "OfflineAudioTabReady")}
              </Text>
              <Text style={styles.hint}>{t("OfflineAudioTabPlayback")}</Text>
              <Action
                label={t("OfflineAudioOpenTabs")}
                icon="pencil-outline"
                disabled={disabled || tempoPending}
                onPress={onOpen}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}

/** An independent editor; it never reads or writes Play's working copy. */
export function ImportedAudioTab({
  initial,
  title,
  visible,
  active,
  disabled,
  onChange,
  onSave,
  onClose
}: {
  initial: Tablature;
  title: string;
  visible: boolean;
  active: boolean;
  disabled: boolean;
  onChange: (tab: Tablature, edited: boolean) => void;
  onSave: (tab: Tablature) => void;
  onClose: () => void;
}) {
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive"
  );
  const transport = useTablature(
    active && visible && foreground && !disabled,
    () => {},
    false
  );
  const { replaceTab } = transport;
  const [ready, setReady] = useState(false);
  const baseline = useMemo(
    () => JSON.stringify(normalizeTablature(initial)),
    [initial]
  );
  const serialized = useMemo(
    () => JSON.stringify(transport.tab),
    [transport.tab]
  );
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    // The caller remounts this component only after an explicit replacement.
    // Keep the transport alive when the editor modal is merely closed.
    setReady(replaceTab(initial));
  }, [initial, replaceTab]);
  useEffect(() => {
    if (ready) changed.current(transport.tab, serialized !== baseline);
  }, [baseline, ready, serialized, transport.tab]);
  if (!ready || !visible || !active) return null;
  return (
    <TablaturePanel
      standalone
      visible={visible && foreground}
      transport={transport}
      title={title}
      dirty={serialized !== baseline}
      expanded={false}
      disabled={disabled}
      onToggle={onClose}
      onClose={() => {
        transport.pause();
        onClose();
      }}
      onSave={() => {
        if (disabled) return;
        transport.pause();
        onSave(transport.tab);
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: palette.glass.card
  },
  title: { color: palette.glass.ink, fontSize: 16, fontWeight: "600" },
  text: { color: palette.glass.ink, fontSize: 15, lineHeight: 22 },
  hint: { color: palette.glass.muted, fontSize: 14, lineHeight: 21 },
  events: { gap: 6 },
  event: {
    color: palette.glass.ink,
    fontSize: 14,
    fontVariant: ["tabular-nums"]
  }
});
