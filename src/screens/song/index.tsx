import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets
} from "react-native-safe-area-context";
import {
  useFocusEffect,
  useIsFocused,
  useRoute,
  RouteProp
} from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import guitarBgSong from "../../../assets/images/gold-background.png";
import CreateChordSong from "../create-song-chords";
import SongRecorder from "./recorder";
import SongModal from "./header-modal";
import VideoTabs from "./video-tabs";
import Header from "../../components/header";
import palette from "../../theme/palette";
import { RootStackParamList } from "../../router";
import { ISong } from "../../@interfaces";
import { getAllItems } from "@/components/database/crud";
import {
  defaultSongPreferences,
  flushPreferences,
  usePreferences
} from "@/components/preferences";
import RequireMicAccess from "../tuner";
import MicrophoneStream from "../tuner/MicrophoneStream";
import { chordPattern, isChordLine, transposeChord } from "./chords";
import { Action, ChordSheet, SongTools } from "./tools";
import {
  AudioSong,
  getAudioSong
} from "../../components/database/audio-analysis";
import AudioSongScreen from "./audio-song";

const SongDetail: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, "Song">>();
  const songId = Number(route?.params?.id);
  const { t } = useTranslation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [song, setSong] = useState<ISong>();
  const [audioSong, setAudioSong] = useState<AudioSong | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tools, setTools] = useState<false | "reading" | "rhythm">(false);
  const [tuner, setTuner] = useState(false);
  const [chord, setChord] = useState("");
  const [videos, setVideos] = useState(false);
  const preferences = usePreferences(
    (state) => state.songs[songId] ?? defaultSongPreferences
  );
  const updateSong = usePreferences((state) => state.updateSong);
  const scroll = useRef<ScrollView>(null);
  const metrics = useRef({
    position: 0,
    content: 0,
    viewport: 0,
    restored: false
  });
  const change = (patch: Partial<typeof preferences>) =>
    updateSong(songId, patch);
  const savePosition = useCallback(() => {
    if (metrics.current.restored)
      updateSong(songId, { position: metrics.current.position });
  }, [songId, updateSong]);
  useFocusEffect(
    useCallback(() => {
      if (isEdit) return;
      let active = true;
      metrics.current.restored = false;
      setLoading(true);
      getAllItems<ISong>({
        tableName: "songs",
        filters: "songs.id = ?",
        parameters: [songId],
        fields:
          "songs.id, fk_band.name as band_name, fk_band.id as band_id, title, content, youtube_music, youtobe_lesson",
        joins: ["LEFT JOIN bands fk_band ON songs.band_id = fk_band.id"],
        limit: 1
      })
        .then(async ([found]) => {
          const audio = found ? await getAudioSong(songId) : null;
          if (active) {
            setSong(found);
            setAudioSong(audio);
            if (found) updateSong(songId, { opened: Date.now() });
          }
        })
        .catch((error) => {
          console.error("Error loading song:", error);
          if (active) setSong(undefined);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
        setPlaying(false);
        savePosition();
        flushPreferences();
      };
    }, [songId, isEdit, savePosition, updateSong])
  );
  useEffect(() => {
    metrics.current = { position: 0, content: 0, viewport: 0, restored: false };
  }, [songId, isEdit]);
  useEffect(() => {
    const updateAwake = (active: boolean) =>
      MicrophoneStream.setKeepAwake(focused && active);
    updateAwake(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      updateAwake(state === "active");
      if (state !== "active") {
        setPlaying(false);
        setVideos(false);
        setTools(false);
        setChord("");
        savePosition();
        flushPreferences();
      }
    });
    return () => {
      subscription.remove();
      MicrophoneStream.setKeepAwake(false);
    };
  }, [focused, savePosition]);
  useEffect(() => {
    if (!playing || !focused || tuner || tools || chord || isEdit || loading)
      return;
    let frame: number;
    let previous = 0;
    const tick = (time: number) => {
      const bounds = metrics.current;
      const end = Math.max(0, bounds.content - bounds.viewport);
      if (previous)
        bounds.position = Math.min(
          end,
          bounds.position +
            (Math.min(time - previous, 100) / 1000) * preferences.speed
        );
      previous = time;
      scroll.current?.scrollTo({ y: bounds.position, animated: false });
      if (bounds.position >= end) {
        setPlaying(false);
        savePosition();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      savePosition();
    };
  }, [
    playing,
    focused,
    tuner,
    tools,
    chord,
    isEdit,
    loading,
    preferences.speed,
    savePosition
  ]);
  const restorePosition = () => {
    const bounds = metrics.current;
    if (!bounds.restored && bounds.content > 0 && bounds.viewport > 0) {
      bounds.position = Math.min(
        preferences.position,
        Math.max(0, bounds.content - bounds.viewport)
      );
      bounds.restored = true;
      scroll.current?.scrollTo({ y: bounds.position, animated: false });
    }
  };
  const openTools = () => {
    setPlaying(false);
    setTools("reading");
  };
  const renderChord = (text: string, key: number) => {
    const displayed = transposeChord(
      text,
      preferences.transpose - preferences.capo
    );
    return (
      <Text
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${displayed}, ${t("Fingering")}`}
        onPress={() => {
          setPlaying(false);
          setChord(displayed);
        }}
        style={styles.chord}
      >
        {displayed}
      </Text>
    );
  };
  const renderLine = (line: string, index: number) => {
    const onlyChords = isChordLine(line);
    const parts = onlyChords ? line.split(/(\s+)/) : line.split(/(\[[^\]]+\])/);
    return (
      <Text
        key={index}
        style={[
          styles.content,
          {
            fontSize: preferences.fontSize,
            lineHeight: preferences.fontSize * 1.65
          }
        ]}
      >
        {parts.map((part, i) => {
          if (
            onlyChords &&
            /^ +$/.test(part) &&
            chordPattern.test(parts[i - 1] ?? "")
          ) {
            const previous = parts[i - 1];
            const shifted = transposeChord(
              previous,
              preferences.transpose - preferences.capo
            );
            return " ".repeat(
              Math.max(1, part.length + previous.length - shifted.length)
            );
          }
          const token = onlyChords ? part : part.slice(1, -1);
          return (onlyChords || /^\[.*\]$/.test(part)) &&
            chordPattern.test(token)
            ? renderChord(token, i)
            : part;
        })}
        {line ? "" : " "}
      </Text>
    );
  };
  return (
    <ImageBackground
      source={guitarBgSong}
      style={styles.background}
      resizeMode="stretch"
    >
      {!loading && song && audioSong ? (
        <AudioSongScreen song={song} initialAudio={audioSong} />
      ) : (
        <>
          <Header glass title={song?.title ?? t("SongTitle")} showBack>
            <Action
              glass
              label={preferences.favorite ? "★" : "☆"}
              accessibilityLabel={t(
                preferences.favorite ? "FavoritesRemove" : "FavoritesAdd"
              )}
              selected={preferences.favorite}
              onPress={() => change({ favorite: !preferences.favorite })}
            />
            <Action
              glass
              compact
              label={t("tuner")}
              onPress={() => {
                setPlaying(false);
                setVideos(false);
                savePosition();
                setTuner(true);
              }}
            />
            <SongModal
              setIsEdit={(edit) => {
                setPlaying(false);
                setIsEdit(edit);
              }}
              songId={songId}
            />
          </Header>
          {loading || !song ? (
            <View style={styles.center}>
              <Text style={styles.status}>
                {t(loading ? "LoadingSong" : "SongNotFound")}
              </Text>
            </View>
          ) : isEdit ? (
            <CreateChordSong song={song} setIsEdit={setIsEdit} />
          ) : (
            <>
              <ScrollView
                ref={scroll}
                onLayout={({ nativeEvent }) => {
                  metrics.current.viewport = nativeEvent.layout.height;
                  restorePosition();
                }}
                onContentSizeChange={(_, height) => {
                  metrics.current.content = height;
                  restorePosition();
                }}
                scrollEventThrottle={32}
                onScroll={({ nativeEvent }) => {
                  metrics.current.position = Math.max(
                    0,
                    nativeEvent.contentOffset.y
                  );
                }}
                onScrollBeginDrag={() => setPlaying(false)}
                onScrollEndDrag={savePosition}
                onMomentumScrollEnd={savePosition}
                contentContainerStyle={styles.scroll}
              >
                <View style={styles.paper}>
                  {(preferences.transpose !== 0 || preferences.capo !== 0) && (
                    <Text style={styles.metadata}>
                      {t("Transpose")}: {preferences.transpose > 0 ? "+" : ""}
                      {preferences.transpose} · {t("Capo")}: {preferences.capo}
                    </Text>
                  )}
                  {!!song.band_name && (
                    <Text style={styles.metadata}>{song.band_name}</Text>
                  )}
                  <Text style={styles.metadata}>{t("TapChordHint")}</Text>
                  {song.content.split(/\r?\n/).map(renderLine)}
                </View>
                {(song.youtube_music || song.youtobe_lesson) && (
                  <Action
                    glass
                    label={t(videos ? "HideVideos" : "ShowVideos")}
                    onPress={() => {
                      setPlaying(false);
                      setVideos(!videos);
                    }}
                  />
                )}
                {videos && focused && !tuner && !tools && !chord && (
                  <VideoTabs {...song} />
                )}
              </ScrollView>
              <View
                style={[
                  styles.toolbar,
                  { paddingBottom: Math.max(insets.bottom, 12) }
                ]}
              >
                <SongRecorder
                  songId={songId}
                  active={focused && !tuner && !tools && !chord && !isEdit}
                  onStart={() => {
                    setVideos(false);
                    setPlaying(true);
                  }}
                />
                <Action
                  glass
                  compact
                  label={t("ScrollLyrics")}
                  icon={playing ? "pause" : "chevron-double-down"}
                  accessibilityLabel={playing ? t("Pause") : t("AutoScroll")}
                  selected={playing}
                  onPress={() => {
                    if (playing) savePosition();
                    setPlaying(!playing);
                  }}
                />
                <Action
                  glass
                  compact
                  label="⚙"
                  icon="cog"
                  accessibilityLabel={t("SongTools")}
                  onPress={openTools}
                />
              </View>
              {tools && (
                <SongTools
                  initialTab={tools}
                  content={song.content}
                  value={preferences}
                  onChange={change}
                  onClose={() => setTools(false)}
                />
              )}
              {!!chord && (
                <ChordSheet
                  chord={chord}
                  value={preferences.shapes[chord]}
                  capo={preferences.capo}
                  onChange={(index) =>
                    change({
                      shapes: { ...preferences.shapes, [chord]: index }
                    })
                  }
                  onClose={() => setChord("")}
                />
              )}
            </>
          )}
          {tuner && (
            <Modal animationType="slide" onRequestClose={() => setTuner(false)}>
              <SafeAreaView style={styles.tuner}>
                <View style={styles.returnBar}>
                  <Action
                    label={t("ReturnToSong")}
                    onPress={() => setTuner(false)}
                  />
                </View>
                <RequireMicAccess />
              </SafeAreaView>
            </Modal>
          )}
        </>
      )}
    </ImageBackground>
  );
};
const styles = StyleSheet.create({
  background: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  status: {
    fontFamily: palette.typography.body,
    color: palette.glass.ink,
    backgroundColor: palette.glass.header,
    padding: 20,
    borderRadius: 16
  },
  scroll: { padding: 20, gap: 16, paddingBottom: 28 },
  paper: {
    borderRadius: 20,
    paddingVertical: 12,
    backgroundColor: palette.colors.transparent
  },
  content: {
    color: palette.glass.ink,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace"
  },
  chord: {
    color: palette.glass.play,
    fontWeight: "800",
    textDecorationLine: "none"
  },
  metadata: {
    fontFamily: palette.typography.body,
    color: palette.glass.muted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-evenly",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.header
  },
  tuner: { flex: 1, backgroundColor: palette.paper.background },
  returnBar: { padding: 12 }
});
export default SongDetail;
