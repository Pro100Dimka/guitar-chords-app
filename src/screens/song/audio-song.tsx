import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, FlatList, Pressable, View } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Dirs, FileSystem } from "react-native-file-access";
import type { ISong } from "../../@interfaces";
import type { NavigationProp } from "../../router";
import Header from "../../components/header";
import Text from "../../components/styled-text";
import { deleteItem } from "../../components/database/crud";
import {
  AudioSong,
  AnalysisJob,
  getAudioSong,
  getAnalysisJob,
  acceptGeneratedAnalysis
} from "../../components/database/audio-analysis";
import { songAudio, SongAudioState } from "../../components/song-audio";
import { analysisErrorKey } from "../../components/song-analysis/errors";
import {
  analysisIsRunning,
  analysisNetworkStatus,
  AnalysisNetworkStatus,
  cancelSongAnalysis,
  subscribeAnalysis
} from "../../components/song-analysis/client";
import {
  chordDisplay,
  formatTime,
  timelineAt
} from "../../components/song-analysis/timeline";
import type {
  TimedChord,
  TimedLyric
} from "../../components/song-analysis/types";
import {
  defaultSongPreferences,
  flushPreferences,
  usePreferences
} from "../../components/preferences";
import { Action, ChordSheet } from "./tools";
import { chordPattern } from "./chords";
import AudioImport from "../library/audio-import";
import AnalysisSettingsSheet from "./analysis-settings";
import AnalysisEditor, { EditSelection } from "./analysis-editor";
import styles from "./audio-styles";

const initialPlayback: SongAudioState = {
  path: null,
  state: "idle",
  positionMs: 0,
  durationMs: 0,
  seeking: false,
  loopStartMs: null,
  loopEndMs: null
};
const activeStatuses = ["queued", "uploading", "running"];

const LyricRow = memo(function LyricRow({
  item,
  index,
  active,
  wordIndex,
  editing,
  onSeek,
  onEdit,
  editLabel,
  lineTimingLabel,
  canSeek
}: {
  item: TimedLyric;
  index: number;
  active: boolean;
  wordIndex: number;
  editing: boolean;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onEdit: (selection: EditSelection) => void;
  editLabel: string;
  lineTimingLabel: string;
}) {
  return (
    <View style={[styles.line, active && styles.active]}>
      <Text
        style={styles.time}
        onPress={canSeek ? () => onSeek(item.start) : undefined}
        accessibilityRole={canSeek ? "button" : undefined}
      >
        {formatTime(item.start)} — {formatTime(item.end)}
      </Text>
      <Text
        style={[styles.text, item.uncertain && styles.uncertain]}
        onPress={canSeek ? () => onSeek(item.start) : undefined}
      >
        {item.words.length
          ? item.words.map((word, i) => (
              <Text
                key={i}
                style={[
                  word.uncertain && styles.uncertain,
                  wordIndex === i && styles.wordActive
                ]}
                onPress={
                  editing
                    ? () =>
                        onEdit({
                          kind: "word",
                          line: index,
                          index: i,
                          position: word.start
                        })
                    : canSeek
                      ? () => onSeek(word.start)
                      : undefined
                }
              >
                {word.text}
                {i < item.words.length - 1 ? " " : ""}
              </Text>
            ))
          : item.text}
      </Text>
      {!item.words.length && (
        <Text style={styles.muted}>{lineTimingLabel}</Text>
      )}
      {editing && (
        <Action
          glass
          compact
          label={editLabel}
          onPress={() => onEdit({ kind: "lyric", index, position: item.start })}
        />
      )}
    </View>
  );
});

const ChordTimeline = memo(function ChordTimeline({
  chords,
  current,
  transpose,
  capo,
  editing,
  canSeek,
  onSeek,
  onEdit,
  onShape
}: {
  chords: TimedChord[];
  current: number;
  transpose: number;
  capo: number;
  editing: boolean;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onEdit: (selection: EditSelection) => void;
  onShape: (chord: string) => void;
}) {
  return (
    <FlatList
      horizontal
      data={chords}
      keyExtractor={(_, index) => String(index)}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      contentContainerStyle={[styles.row, styles.noWrap]}
      extraData={`${current}:${transpose}:${capo}:${editing}:${canSeek}`}
      renderItem={({ item: chord, index }) => {
        const display = chordDisplay(chord.label, transpose, capo);
        return (
          <Pressable
            accessibilityRole="button"
            style={[styles.pill, current === index && styles.active]}
            onPress={() =>
              editing
                ? onEdit({ kind: "chord", index, position: chord.start })
                : canSeek
                  ? onSeek(chord.start)
                  : onShape(display.fingering)
            }
            onLongPress={() => onShape(display.fingering)}
          >
            <Text style={[styles.text, chord.uncertain && styles.uncertain]}>
              {display.original}
              {chordPattern.test(display.fingering)
                ? ` → ${display.fingering}`
                : ""}
            </Text>
            <Text style={styles.time}>
              {formatTime(chord.start)} — {formatTime(chord.end)}
            </Text>
          </Pressable>
        );
      }}
    />
  );
});

export default function AudioSongScreen({
  song,
  initialAudio
}: {
  song: ISong;
  initialAudio: AudioSong;
}) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const [audio, setAudio] = useState(initialAudio);
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [network, setNetwork] = useState<AnalysisNetworkStatus>({});
  const [playback, setPlayback] = useState(initialPlayback);
  const [playError, setPlayError] = useState("");
  const [readError, setReadError] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [setup, setSetup] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditSelection | null>(null);
  const [shape, setShape] = useState("");
  const [follow, setFollow] = useState(true);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [seekWidth, setSeekWidth] = useState(1);
  const position = useRef(0);
  const list = useRef<FlatList<TimedLyric>>(null);
  const followRetry = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const followTarget = useRef(-1);
  const followAttempts = useRef(0);
  const preferences = usePreferences(
    (state) => state.songs[song.id] ?? defaultSongPreferences
  );
  const updateSong = usePreferences((state) => state.updateSong);
  const reload = useCallback(() => {
    setNetwork(analysisNetworkStatus(song.id));
    void Promise.all([getAudioSong(song.id), getAnalysisJob(song.id)])
      .then(([nextAudio, nextJob]) => {
        if (nextAudio) setAudio(nextAudio);
        setJob(nextJob);
        setReadError(false);
      })
      .catch(() => setReadError(true));
  }, [song.id]);
  useEffect(() => {
    reload();
    return subscribeAnalysis(reload);
  }, [reload]);
  useEffect(() => {
    if (!network.retryUntil) return;
    const timer = setInterval(
      () => setNetwork(analysisNetworkStatus(song.id)),
      1000
    );
    return () => clearInterval(timer);
  }, [network.retryUntil, song.id]);
  useEffect(() => {
    setAudio(initialAudio);
  }, [initialAudio]);
  const persistPosition = useCallback(() => {
    updateSong(song.id, { audioPosition: position.current / 1000 });
    flushPreferences();
  }, [song.id, updateSong]);
  useEffect(() => {
    if (!focused || !audio.fileName || !songAudio.isSupported) return;
    let active = true;
    let loaded = false;
    setPlayError("");
    setLoopA(null);
    position.current = 0;
    setPlayback({ ...initialPlayback, state: "loading" });
    const event = songAudio.listen((state) => {
      if (!active || !state.path?.endsWith(`/${audio.fileName}`)) return;
      setPlayback(state);
      position.current = state.positionMs;
      if (loaded && !state.seeking && ["paused", "ended"].includes(state.state))
        persistPosition();
      if (state.state === "error")
        setPlayError(
          state.error
            ? analysisErrorKey({ code: state.error })
            : "AudioPlaybackError"
        );
    });
    const saved = usePreferences.getState().songs[song.id]?.audioPosition ?? 0;
    void songAudio
      .load(audio.fileName)
      .then(async (state) => {
        if (!active) return;
        if (saved > 0 && saved < state.durationMs / 1000)
          state = await songAudio.seek(saved * 1000);
        if (active) {
          loaded = true;
          position.current = state.positionMs;
          setPlayback(state);
        }
      })
      .catch((error) => {
        if (active) setPlayError(analysisErrorKey(error));
      });
    const timer = setInterval(() => {
      if (loaded) persistPosition();
    }, 5000);
    const app = AppState.addEventListener("change", (state) => {
      if (!loaded || !active) return;
      if (state !== "active") {
        void songAudio
          .pause()
          .then((current) => {
            if (active) {
              position.current = current.positionMs;
              setPlayback(current);
              persistPosition();
            }
          })
          .catch(() => {});
      } else {
        void songAudio
          .getState()
          .then((current) => {
            if (active) {
              position.current = current.positionMs;
              setPlayback(current);
            }
          })
          .catch(() => {});
      }
    });
    return () => {
      active = false;
      event.remove();
      app.remove();
      clearInterval(timer);
      if (loaded) persistPosition();
      void songAudio.unload().catch(() => {});
    };
  }, [audio.fileName, focused, persistPosition, playbackAttempt, song.id]);
  const perform = useCallback(
    (operation: () => Promise<unknown>) => {
      void Promise.resolve()
        .then(operation)
        .catch((error) => Alert.alert(t(analysisErrorKey(error))));
    },
    [t]
  );
  const seek = useCallback(
    (seconds: number) => {
      if (!songAudio.isSupported || !audio.fileName) return;
      perform(() =>
        songAudio.seek(Math.max(0, Math.min(audio.duration, seconds)) * 1000)
      );
    },
    [audio.duration, audio.fileName, perform]
  );
  const openEdit = useCallback((selection: EditSelection) => {
    if (songAudio.isSupported) void songAudio.pause().catch(() => {});
    setEdit(selection);
  }, []);
  const openShape = useCallback((chord: string) => {
    if (songAudio.isSupported) void songAudio.pause().catch(() => {});
    setShape(chord);
  }, []);
  const timeline = audio.analysis
    ? timelineAt(audio.analysis, playback.positionMs)
    : { line: -1, word: -1, chord: -1 };
  useEffect(() => {
    clearTimeout(followRetry.current ?? 0);
    followTarget.current = timeline.line;
    followAttempts.current = 0;
    if (follow && !editing && timeline.line >= 0) {
      list.current?.scrollToIndex({
        index: timeline.line,
        animated: true,
        viewPosition: 0.4
      });
    }
    return () => clearTimeout(followRetry.current ?? 0);
  }, [timeline.line, follow, editing]);
  const current = audio.analysis?.chords[timeline.chord];
  const harmony = current
    ? chordDisplay(current.label, preferences.transpose, preferences.capo)
    : null;
  const running =
    analysisIsRunning(song.id) ||
    (!!job && activeStatuses.includes(job.status));
  const playable =
    !!audio.fileName &&
    songAudio.isSupported &&
    !playError &&
    !["idle", "loading", "error"].includes(playback.state);
  const needsRelink =
    !audio.fileName ||
    [
      "AudioMissing",
      "AudioDifferentFile",
      "AudioFormatError",
      "AudioReadError"
    ].includes(playError);
  const showSetup = () => {
    if (songAudio.isSupported) void songAudio.pause().catch(() => {});
    setSetup(true);
  };
  const remove = () =>
    Alert.alert(t("Delete"), t("AudioDeleteConfirm"), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () =>
          perform(async () => {
            await cancelSongAnalysis(song.id);
            if (songAudio.isSupported) await songAudio.unload();
            await deleteItem({
              tableName: "songs",
              filters: `id = ${song.id}`
            });
            if (audio.fileName)
              await FileSystem.unlink(
                `${Dirs.DocumentDir}/FreeTuneAudio/${audio.fileName}`
              ).catch(() => {});
            navigation.navigate("Tabs", { screen: "library" });
          })
      }
    ]);
  return (
    <View style={styles.flex}>
      <Header glass showBack title={song.title}>
        <Action
          glass
          label={preferences.favorite ? "★" : "☆"}
          accessibilityLabel={t(
            preferences.favorite ? "FavoritesRemove" : "FavoritesAdd"
          )}
          onPress={() =>
            updateSong(song.id, { favorite: !preferences.favorite })
          }
        />
      </Header>
      <FlatList
        ref={list}
        data={audio.analysis?.lyrics ?? []}
        keyExtractor={(_, index) => String(index)}
        contentContainerStyle={styles.content}
        initialNumToRender={14}
        windowSize={7}
        onScrollBeginDrag={() => setFollow(false)}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          if (
            !follow ||
            editing ||
            index !== followTarget.current ||
            followAttempts.current >= 2
          )
            return;
          followAttempts.current++;
          list.current?.scrollToOffset({
            offset: index * averageItemLength,
            animated: false
          });
          clearTimeout(followRetry.current ?? 0);
          followRetry.current = setTimeout(() => {
            if (index === followTarget.current)
              list.current?.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.4
              });
          }, 200);
        }}
        renderItem={({ item, index }) => (
          <LyricRow
            item={item}
            index={index}
            active={timeline.line === index}
            wordIndex={timeline.line === index ? timeline.word : -1}
            editing={editing}
            canSeek={playable}
            onSeek={seek}
            onEdit={openEdit}
            editLabel={t("AnalysisEditLine")}
            lineTimingLabel={t("AnalysisLineTimingOnly")}
          />
        )}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={styles.card}>
              <Text style={styles.muted}>
                {audio.originalName} · {formatTime(audio.duration)}
              </Text>
              {!songAudio.isSupported && (
                <Text style={styles.muted}>
                  {t("AudioAnalysisAndroidOnly")}
                </Text>
              )}
              {needsRelink && (
                <>
                  <Text style={styles.error}>
                    {t(playError || "AudioMissing")}
                  </Text>
                  <Text style={styles.muted}>{t("AudioRelinkHint")}</Text>
                  <AudioImport
                    expectedSha={audio.sha256}
                    onImported={() => {
                      setPlayError("");
                      setPlaybackAttempt((attempt) => attempt + 1);
                      reload();
                    }}
                  />
                </>
              )}
              {!needsRelink && !!playError && (
                <>
                  <Text style={styles.error}>{t(playError)}</Text>
                  <Action
                    glass
                    label={t("Retry")}
                    onPress={() => setPlaybackAttempt((attempt) => attempt + 1)}
                  />
                </>
              )}
              {readError && (
                <>
                  <Text style={styles.error}>{t("AnalysisReadError")}</Text>
                  <Action glass label={t("Retry")} onPress={reload} />
                </>
              )}
              {job && (
                <>
                  <Text style={styles.text}>
                    {t(`AnalysisStage_${running ? job.stage : job.status}`, {
                      defaultValue: t(
                        running ? "AnalysisRunning" : "AnalysisFailed"
                      )
                    })}
                    {running ? ` · ${Math.round(job.progress * 100)}%` : ""}
                  </Text>
                  {running && !!network.queuePosition && (
                    <Text style={styles.muted}>
                      {t("AnalysisQueuePosition", {
                        position: network.queuePosition
                      })}
                    </Text>
                  )}
                  {!!network.retryAfterSeconds && (
                    <Text style={styles.muted}>
                      {t(
                        running ? "AnalysisRetryAfter" : "AnalysisRetryLater",
                        {
                          seconds: network.retryAfterSeconds
                        }
                      )}
                    </Text>
                  )}
                  {running && (
                    <View
                      style={styles.progress}
                      accessibilityRole="progressbar"
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: Math.round(job.progress * 100)
                      }}
                    >
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${job.progress * 100}%` }
                        ]}
                      />
                    </View>
                  )}
                  {!!job.error && (
                    <Text style={styles.error}>
                      {t(job.error, { defaultValue: t("AnalysisFailed") })}
                    </Text>
                  )}
                  {job.status === "cancelled" && (
                    <Text style={styles.muted}>
                      {t("AnalysisCancelledServerHint")}
                    </Text>
                  )}
                </>
              )}
              <View style={styles.row}>
                <Action
                  glass
                  primary
                  label={t(
                    running
                      ? "Cancel"
                      : audio.analysis
                        ? "AnalysisAgain"
                        : "AnalysisStart"
                  )}
                  disabled={
                    !running && (!audio.fileName || !songAudio.isSupported)
                  }
                  onPress={() =>
                    running
                      ? perform(() => cancelSongAnalysis(song.id))
                      : showSetup()
                  }
                />
                <Action
                  glass
                  label={t(editing ? "AnalysisFinishEdit" : "Edit")}
                  selected={editing}
                  onPress={() => {
                    setEditing(!editing);
                    if (songAudio.isSupported)
                      void songAudio.pause().catch(() => {});
                  }}
                />
                <Action glass label={t("Delete")} onPress={remove} />
              </View>
              {audio.manuallyEdited && (
                <Text style={styles.muted}>{t("AnalysisManualProtected")}</Text>
              )}
              {!!audio.generatedAnalysis && audio.manuallyEdited && (
                <Action
                  glass
                  label={t("AnalysisUseNewResult")}
                  onPress={() => {
                    Alert.alert(
                      t("AnalysisReplaceTitle"),
                      t("AnalysisReplaceHint"),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("AnalysisReplaceConfirm"),
                          style: "destructive",
                          onPress: () =>
                            perform(async () => {
                              await acceptGeneratedAnalysis(
                                song.id,
                                audio.revision
                              );
                              reload();
                            })
                        }
                      ]
                    );
                  }}
                />
              )}
              {audio.analysis?.warnings.map((warning, index) => (
                <Text key={index} style={styles.muted}>
                  {t(`AnalysisWarning_${warning}`, {
                    defaultValue: t("AnalysisWarningGeneric")
                  })}
                </Text>
              ))}
              {!audio.analysis && !running && (
                <Text style={styles.muted}>{t("AnalysisBeforeStart")}</Text>
              )}
            </View>
            {audio.analysis && (
              <View style={styles.card}>
                <Text style={styles.title}>{t("AnalysisHarmony")}</Text>
                <Text style={styles.muted}>
                  {t("AnalysisChordDistinction")}
                </Text>
                <View style={styles.row}>
                  <Text style={styles.text}>
                    {t("Transpose")}: {preferences.transpose > 0 ? "+" : ""}
                    {preferences.transpose}
                  </Text>
                  <Action
                    glass
                    compact
                    label="−"
                    accessibilityLabel={t("AnalysisTransposeDown")}
                    disabled={preferences.transpose <= -11}
                    onPress={() =>
                      updateSong(song.id, {
                        transpose: preferences.transpose - 1
                      })
                    }
                  />
                  <Action
                    glass
                    compact
                    label="+"
                    accessibilityLabel={t("AnalysisTransposeUp")}
                    disabled={preferences.transpose >= 11}
                    onPress={() =>
                      updateSong(song.id, {
                        transpose: preferences.transpose + 1
                      })
                    }
                  />
                  <Text style={styles.text}>
                    {t("Capo")}: {preferences.capo}
                  </Text>
                  <Action
                    glass
                    compact
                    label="−"
                    accessibilityLabel={t("AnalysisCapoDown")}
                    disabled={preferences.capo <= 0}
                    onPress={() =>
                      updateSong(song.id, { capo: preferences.capo - 1 })
                    }
                  />
                  <Action
                    glass
                    compact
                    label="+"
                    accessibilityLabel={t("AnalysisCapoUp")}
                    disabled={preferences.capo >= 12}
                    onPress={() =>
                      updateSong(song.id, { capo: preferences.capo + 1 })
                    }
                  />
                </View>
                <Text
                  style={preferences.transpose ? styles.error : styles.muted}
                >
                  {t(
                    preferences.transpose
                      ? "AnalysisAudioNotTransposed"
                      : "AnalysisOriginalPitch"
                  )}
                </Text>
                <ChordTimeline
                  chords={audio.analysis.chords}
                  current={timeline.chord}
                  transpose={preferences.transpose}
                  capo={preferences.capo}
                  editing={editing}
                  canSeek={playable}
                  onSeek={seek}
                  onEdit={openEdit}
                  onShape={openShape}
                />
              </View>
            )}
            {editing && (
              <View style={styles.row}>
                <Action
                  glass
                  label={t("AnalysisAddLine")}
                  onPress={() =>
                    openEdit({
                      kind: "lyric",
                      index: -1,
                      position: position.current / 1000
                    })
                  }
                />
                <Action
                  glass
                  label={t("AnalysisAddChord")}
                  onPress={() =>
                    openEdit({
                      kind: "chord",
                      index: -1,
                      position: position.current / 1000
                    })
                  }
                />
                <Text style={styles.muted}>{t("AnalysisEditHint")}</Text>
              </View>
            )}
            {!!audio.analysis && !audio.analysis.lyrics.length && (
              <Text style={styles.muted}>{t("AnalysisNoLyrics")}</Text>
            )}
          </View>
        }
      />
      <View
        style={[
          styles.playback,
          { paddingBottom: Math.max(insets.bottom, 12) }
        ]}
      >
        {harmony && (
          <View style={styles.row}>
            <Text style={styles.muted}>
              {t("AnalysisOriginalChord")}: {harmony.original}
            </Text>
            {!!preferences.transpose && (
              <Text style={styles.muted}>
                {t("AnalysisTargetChord")}: {harmony.target}
              </Text>
            )}
            {chordPattern.test(harmony.fingering) ? (
              <Action
                glass
                compact
                label={`${t("AnalysisFingering")}: ${harmony.fingering}`}
                onPress={() => openShape(harmony.fingering)}
              />
            ) : (
              <Text style={styles.muted}>{t("AnalysisNoFingering")}</Text>
            )}
          </View>
        )}
        <View style={styles.row}>
          <Action
            glass
            compact
            label="−10"
            disabled={!playable}
            onPress={() => seek(position.current / 1000 - 10)}
          />
          <Action
            primary
            icon={playback.state === "playing" ? "pause" : "play"}
            label={t(playback.state === "playing" ? "Pause" : "Play")}
            disabled={!playable || playback.seeking}
            onPress={() =>
              perform(
                playback.state === "playing" ? songAudio.pause : songAudio.play
              )
            }
          />
          <Action
            glass
            compact
            label="+10"
            disabled={!playable}
            onPress={() => seek(position.current / 1000 + 10)}
          />
          <Text style={styles.clock}>
            {formatTime(playback.positionMs / 1000)} /{" "}
            {formatTime(audio.duration)}
          </Text>
        </View>
        <Pressable
          style={styles.timeline}
          disabled={!playable}
          accessibilityRole="adjustable"
          accessibilityLabel={t("AnalysisSeek")}
          accessibilityValue={{
            min: 0,
            max: Math.round(audio.duration),
            now: Math.round(playback.positionMs / 1000)
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent }) =>
            seek(
              position.current / 1000 +
                (nativeEvent.actionName === "increment" ? 10 : -10)
            )
          }
          onLayout={({ nativeEvent }) =>
            setSeekWidth(Math.max(1, nativeEvent.layout.width))
          }
          onPress={({ nativeEvent }) =>
            seek((nativeEvent.locationX / seekWidth) * audio.duration)
          }
        >
          <View pointerEvents="none" style={styles.progress}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, playback.positionMs / (audio.duration * 10))}%`
                }
              ]}
            />
          </View>
        </Pressable>
        <View style={styles.row}>
          <Action
            glass
            compact
            label={
              loopA === null
                ? t("AnalysisSetA")
                : `A ${formatTime(loopA / 1000)}`
            }
            disabled={!playable}
            onPress={() => {
              setLoopA(position.current);
              perform(() => songAudio.setLoop(null, null));
            }}
          />
          <Action
            glass
            compact
            label={
              playback.loopEndMs === null
                ? t("AnalysisSetB")
                : `B ${formatTime(playback.loopEndMs / 1000)}`
            }
            disabled={
              !playable || loopA === null || position.current <= loopA + 250
            }
            onPress={() =>
              perform(() => songAudio.setLoop(loopA, position.current))
            }
          />
          {(loopA !== null || playback.loopEndMs !== null) && (
            <Action
              glass
              compact
              label={t("AnalysisClearLoop")}
              onPress={() => {
                setLoopA(null);
                perform(() => songAudio.setLoop(null, null));
              }}
            />
          )}
          <Action
            glass
            compact
            label={t("AnalysisFollow")}
            selected={follow}
            onPress={() => setFollow(!follow)}
          />
        </View>
      </View>
      {setup && (
        <AnalysisSettingsSheet
          songId={song.id}
          onClose={() => setSetup(false)}
        />
      )}
      {edit && (
        <AnalysisEditor
          audio={audio}
          selection={edit}
          onSaved={reload}
          onClose={() => setEdit(null)}
        />
      )}
      {!!shape && (
        <ChordSheet
          chord={shape}
          capo={preferences.capo}
          value={preferences.shapes[shape]}
          onChange={(index) =>
            updateSong(song.id, {
              shapes: { ...preferences.shapes, [shape]: index }
            })
          }
          onClose={() => setShape("")}
        />
      )}
    </View>
  );
}
