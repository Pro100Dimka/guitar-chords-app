import React, { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  AudioSong,
  saveManualAnalysis
} from "../../components/database/audio-analysis";
import {
  SongAnalysis,
  validateSongAnalysis
} from "../../components/song-analysis/types";
import { analysisErrorKey } from "../../components/song-analysis/errors";
import { formatTime, parseTime } from "../../components/song-analysis/timeline";
import { chordPattern } from "./chords";
import { Action, Sheet } from "./tools";
import styles from "./audio-styles";

export type EditSelection = {
  kind: "lyric" | "word" | "chord";
  index: number;
  line?: number;
  position: number;
};

export default function AnalysisEditor({
  audio,
  selection,
  onSaved,
  onClose
}: {
  audio: AudioSong;
  selection: EditSelection;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Freeze the viewed revision when the sheet opens. A concurrent analysis may
  // refresh its parent's props, but must not silently become this edit's base.
  const [{ baseline, revision }] = useState(() => ({
    baseline: JSON.parse(
      JSON.stringify(
        audio.analysis ?? {
          version: 1,
          duration: audio.duration,
          language: null,
          lyrics: [],
          chords: [],
          warnings: [],
          model: { lyrics: "manual", alignment: "manual", chords: "manual" }
        }
      )
    ) as SongAnalysis,
    revision: audio.revision
  }));
  const item =
    selection.kind === "chord"
      ? baseline.chords[selection.index]
      : selection.kind === "word"
        ? baseline.lyrics[selection.line!]?.words[selection.index]
        : baseline.lyrics[selection.index];
  const [text, setText] = useState(
    item ? ("label" in item ? item.label : item.text) : ""
  );
  const [start, setStart] = useState(
    String(
      item?.start ??
        Math.min(selection.position, Math.max(0, baseline.duration - 0.1))
    )
  );
  const [end, setEnd] = useState(
    String(item?.end ?? Math.min(baseline.duration, selection.position + 2))
  );
  const [busy, setBusy] = useState(false);
  const save = async (remove = false, dropWordTiming = false) => {
    if (busy) return;
    const from = parseTime(start),
      to = parseTime(end);
    if (
      !remove &&
      (!Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < 0 ||
        to <= from ||
        to > baseline.duration ||
        !text.trim())
    ) {
      Alert.alert(t("AnalysisEditInvalid"));
      return;
    }
    if (
      !remove &&
      selection.kind === "chord" &&
      text.trim() !== baseline.chords[selection.index]?.label &&
      !["N", "X", "?"].includes(text.trim()) &&
      !chordPattern.test(text.trim())
    ) {
      Alert.alert(t("AnalysisChordInvalid"));
      return;
    }
    const previousLine =
      selection.kind === "lyric" ? baseline.lyrics[selection.index] : undefined;
    if (
      !remove &&
      !dropWordTiming &&
      previousLine?.text === text.trim() &&
      previousLine.words.some((word) => word.start < from || word.end > to)
    ) {
      Alert.alert(t("AnalysisLineTimingTitle"), t("AnalysisLineTimingHint"), [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("AnalysisDropWordTiming"),
          onPress: () => void save(false, true)
        }
      ]);
      return;
    }
    setBusy(true);
    try {
      const draft = JSON.parse(JSON.stringify(baseline)) as SongAnalysis;
      const timing = { start: from, end: to };
      if (selection.kind === "chord") {
        if (remove) draft.chords.splice(selection.index, 1);
        else {
          const chord = { ...timing, label: text.trim(), uncertain: false };
          if (selection.index < 0) draft.chords.push(chord);
          else draft.chords[selection.index] = chord;
        }
        draft.chords.sort((a, b) => a.start - b.start);
      } else if (selection.kind === "word") {
        const line = draft.lyrics[selection.line!];
        if (remove) line.words.splice(selection.index, 1);
        else
          line.words[selection.index] = {
            ...timing,
            text: text.trim(),
            uncertain: false
          };
        // Do not retime neighbours when the user adjusts one word.
        line.words.sort((a, b) => a.start - b.start);
        line.text = line.words.map((word) => word.text.trim()).join(" ");
        if (!line.words.length) draft.lyrics.splice(selection.line!, 1);
      } else if (remove) draft.lyrics.splice(selection.index, 1);
      else {
        const previous = draft.lyrics[selection.index];
        const edited = {
          ...timing,
          text: text.trim(),
          // A rewritten line has no defensible word alignment. Keep line timing
          // and explicitly drop word timing instead of manufacturing intervals.
          words:
            !dropWordTiming && previous?.text === text.trim()
              ? previous.words
              : [],
          uncertain: false
        };
        if (selection.index < 0) draft.lyrics.push(edited);
        else draft.lyrics[selection.index] = edited;
      }
      draft.lyrics.sort((a, b) => a.start - b.start);
      await saveManualAnalysis(
        audio.songId,
        validateSongAnalysis(draft),
        revision
      );
      onSaved();
      onClose();
    } catch (error) {
      Alert.alert(t("ErrorSavingItem"), t(analysisErrorKey(error)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      musical
      title={t(
        selection.kind === "chord"
          ? "AnalysisEditChord"
          : selection.kind === "word"
            ? "AnalysisEditWord"
            : "AnalysisEditLine"
      )}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text style={styles.muted}>
        {t("AnalysisOriginalTimeline", {
          duration: formatTime(audio.duration)
        })}
      </Text>
      <TextInput
        accessibilityLabel={t(
          selection.kind === "chord"
            ? "AnalysisChordLabel"
            : "AnalysisLyricText"
        )}
        style={styles.input}
        value={text}
        multiline={selection.kind === "lyric"}
        onChangeText={setText}
        maxLength={selection.kind === "chord" ? 80 : 20000}
      />
      <View style={styles.row}>
        <View>
          <Text style={styles.muted}>{t("AnalysisStartTime")}</Text>
          <TextInput
            accessibilityLabel={t("AnalysisStartTime")}
            style={[styles.input, styles.timeInput]}
            value={start}
            keyboardType="decimal-pad"
            onChangeText={setStart}
          />
        </View>
        <View>
          <Text style={styles.muted}>{t("AnalysisEndTime")}</Text>
          <TextInput
            accessibilityLabel={t("AnalysisEndTime")}
            style={[styles.input, styles.timeInput]}
            value={end}
            keyboardType="decimal-pad"
            onChangeText={setEnd}
          />
        </View>
      </View>
      {selection.kind === "lyric" && (
        <Text style={styles.muted}>{t("AnalysisRewriteHint")}</Text>
      )}
      {selection.kind === "chord" && (
        <Text style={styles.muted}>{t("AnalysisSoundingChordHint")}</Text>
      )}
      <Action
        primary
        label={t("Save")}
        disabled={busy}
        onPress={() => void save()}
      />
      {selection.index >= 0 && (
        <Action
          glass
          label={t("Delete")}
          disabled={busy}
          onPress={() => {
            Alert.alert(t("AnalysisDeleteItem"), undefined, [
              { text: t("Cancel"), style: "cancel" },
              {
                text: t("Delete"),
                style: "destructive",
                onPress: () => void save(true)
              }
            ]);
          }}
        />
      )}
      <Action glass label={t("Cancel")} disabled={busy} onPress={onClose} />
    </Sheet>
  );
}
