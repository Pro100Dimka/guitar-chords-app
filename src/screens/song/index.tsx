import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AppState,
  FlatList,
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  type ScrollViewProps,
  type ViewToken,
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
  useNavigation,
  RouteProp
} from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import guitarBgSong from "../../../assets/images/gold-background.webp";
import CreateChordSong from "../create-song-chords";
import SongRecorder from "./recorder";
import SongModal from "./header-modal";
import VideoTabs from "./video-tabs";
import Header from "../../components/header";
import palette from "../../theme/palette";
import { NavigationProp, RootStackParamList } from "../../router";
import { ISong } from "../../@interfaces";
import { getAllItems } from "@/components/database/crud";
import {
  defaultSongPreferences,
  flushPreferences,
  usePreferences
} from "@/components/preferences";
import RequireMicAccess from "../tuner";
import MicrophoneStream from "../tuner/MicrophoneStream";
import {
  createSongEditorState,
  chordNotationPattern,
  chordLineParts,
  isChordLine,
  songChords,
  transposeSong
} from "./chords";
import { Action, ChordSheet, SongTools } from "./tools";

const SongDetail: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, "Song">>();
  const navigation = useNavigation<NavigationProp>();
  const songId = Number(route?.params?.id);
  const { t } = useTranslation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [song, setSong] = useState<ISong>();
  const [loading, setLoading] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const editorExitAllowed = useRef(false);
  const deletedSong = useRef<number | null>(null);
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
  const list = useRef<FlatList>(null);
  const scrollTo = useCallback((position: number) => {
    if (list.current)
      list.current.scrollToOffset({ offset: position, animated: false });
    else scroll.current?.scrollTo({ y: position, animated: false });
  }, []);
  const metrics = useRef({
    position: 0,
    content: 0,
    viewport: 0,
    restored: false,
    target: preferences.position,
    endVisible: false
  });
  const change = (patch: Partial<typeof preferences>) => {
    if (deletedSong.current !== songId) updateSong(songId, patch);
  };
  const savePosition = useCallback(() => {
    if (
      metrics.current.restored &&
      deletedSong.current !== songId &&
      usePreferences.getState().songs[songId]
    )
      updateSong(songId, { position: metrics.current.position });
  }, [songId, updateSong]);
  const finishRestoration = useCallback(() => {
    const bounds = metrics.current;
    const end = Math.max(0, bounds.content - bounds.viewport);
    if (
      !bounds.restored &&
      bounds.content > 0 &&
      bounds.viewport > 0 &&
      bounds.endVisible &&
      bounds.position >= end - 1
    ) {
      bounds.target = Math.min(bounds.target, end);
      bounds.restored = true;
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (isEdit) return;
      let active = true;
      metrics.current.restored = false;
      metrics.current.endVisible = false;
      metrics.current.target =
        usePreferences.getState().songs[songId]?.position ?? 0;
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
        .then(([found]) => {
          if (active && deletedSong.current !== songId) {
            setSong(found);
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
    metrics.current = {
      position: 0,
      content: 0,
      viewport: 0,
      restored: false,
      target: usePreferences.getState().songs[songId]?.position ?? 0,
      endVisible: false
    };
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
      if (!bounds.restored) {
        previous = 0;
        frame = requestAnimationFrame(tick);
        return;
      }
      const end = Math.max(0, bounds.content - bounds.viewport);
      if (previous)
        bounds.position = Math.min(
          end,
          bounds.position +
            (Math.min(time - previous, 100) / 1000) * preferences.speed
        );
      previous = time;
      scrollTo(bounds.position);
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
    savePosition,
    scrollTo
  ]);
  const restorePosition = () => {
    const bounds = metrics.current;
    if (!bounds.restored && bounds.content > 0 && bounds.viewport > 0) {
      bounds.position = Math.min(
        bounds.target,
        Math.max(0, bounds.content - bounds.viewport)
      );
      bounds.restored = !content.virtualized || bounds.target === 0;
      scrollTo(bounds.position);
    }
  };
  const startScrolling = () => {
    const bounds = metrics.current;
    const end = Math.max(0, bounds.content - bounds.viewport);
    if (bounds.restored && end > 0 && bounds.position >= end - 1) {
      bounds.position = 0;
      scrollTo(0);
    }
    setPlaying(true);
  };
  const openTools = () => {
    setPlaying(false);
    setTools("reading");
  };
  const content = useMemo(() => {
    const renderChord = (displayed: string, key: number) => {
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
    const renderLine = (
      line: string,
      index: number,
      onlyChords: boolean,
      paired = false
    ) => {
      const parts = onlyChords
        ? chordLineParts(line)
        : line.split(/(\[[^\[\]]+\])/);
      return (
        <Text
          key={index}
          numberOfLines={paired ? 1 : undefined}
          style={[
            styles.content,
            {
              fontSize: preferences.fontSize,
              lineHeight: preferences.fontSize * 1.65
            }
          ]}
        >
          {parts.length > 256
            ? line
            : parts.map((part, i) => {
                const token = onlyChords ? part : part.slice(1, -1);
                return (onlyChords || /^\[.*\]$/.test(part)) &&
                  chordNotationPattern.test(token)
                  ? renderChord(token, i)
                  : part;
              })}
          {line ? "" : " "}
        </Text>
      );
    };
    const display = createSongEditorState(
      transposeSong(
        song?.content ?? "",
        preferences.transpose - preferences.capo
      )
    );
    const lyricStarts = new Set(display.groups.map((group) => group.end));
    let offset = 0;
    const rows = display.text.split(/\r?\n/).map((line, index) => {
      const onlyChords = !lyricStarts.has(offset) && isChordLine(line);
      offset += line.length + 1;
      return { line, index, onlyChords };
    });
    const virtualized = rows.length > 200 || display.text.length > 20000;
    const blocks: (typeof rows)[] = [];
    for (let index = 0; index < rows.length; ) {
      const row = rows[index];
      if (!row.onlyChords) {
        blocks.push([row]);
        index++;
        continue;
      }
      let end = index + 1;
      while (end < rows.length && rows[end].onlyChords) end++;
      if (rows[end]?.line.trim()) end++;
      blocks.push(rows.slice(index, end));
      index = end;
    }
    const renderBlock = (block: typeof rows) => {
      const row = block[0];
      if (!row.onlyChords) return renderLine(row.line, row.index, false);
      return (
        <ScrollView
          key={row.index}
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.pairedLines}
          onScrollBeginDrag={() => setPlaying(false)}
        >
          <View>
            {block.map((item) =>
              renderLine(item.line, item.index, item.onlyChords, true)
            )}
          </View>
        </ScrollView>
      );
    };
    return {
      blocks,
      renderBlock,
      virtualized
    };
  }, [
    song?.content,
    preferences.transpose,
    preferences.capo,
    preferences.fontSize,
    t
  ]);
  const lastBlock = useRef(0);
  lastBlock.current = content.blocks.length - 1;
  const viewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      metrics.current.endVisible = viewableItems.some(
        (item) => item.isViewable && item.index === lastBlock.current
      );
      finishRestoration();
    }
  ).current;
  const scrollEvents: Pick<
    ScrollViewProps,
    | "onLayout"
    | "onContentSizeChange"
    | "scrollEventThrottle"
    | "onScroll"
    | "onScrollBeginDrag"
    | "onScrollEndDrag"
    | "onMomentumScrollEnd"
  > = {
    onLayout: ({ nativeEvent }) => {
      metrics.current.viewport = nativeEvent.layout.height;
      restorePosition();
    },
    onContentSizeChange: (_, height) => {
      metrics.current.content = height;
      restorePosition();
    },
    scrollEventThrottle: 32,
    onScroll: ({ nativeEvent }) => {
      metrics.current.position = Math.max(0, nativeEvent.contentOffset.y);
      if (Math.abs(metrics.current.position - metrics.current.target) < 1)
        metrics.current.restored = true;
      finishRestoration();
    },
    onScrollBeginDrag: () => {
      metrics.current.restored = true;
      setPlaying(false);
    },
    onScrollEndDrag: savePosition,
    onMomentumScrollEnd: savePosition
  };
  const metadata = (
    <>
      {(preferences.transpose !== 0 || preferences.capo !== 0) && (
        <Text style={styles.metadata}>
          {t("Transpose")}: {preferences.transpose > 0 ? "+" : ""}
          {preferences.transpose} · {t("Capo")}: {preferences.capo}
        </Text>
      )}
      {!!preferences.sourceTuning && (
        <Text style={styles.metadata}>
          {t("Tuning")}: {preferences.sourceTuning}
        </Text>
      )}
      {!!song?.band_name && (
        <Text style={styles.metadata}>{song.band_name}</Text>
      )}
    </>
  );
  const videoContent = (
    <>
      {(song?.youtube_music || song?.youtobe_lesson) && (
        <Action
          glass
          label={t(videos ? "HideVideos" : "ShowVideos")}
          onPress={() => {
            setPlaying(false);
            setVideos(!videos);
          }}
        />
      )}
      {song && videos && focused && !tuner && !tools && !chord && (
        <VideoTabs {...song} />
      )}
    </>
  );
  const previewChord = chord || songChords(song?.content ?? "")[0];
  return (
    <ImageBackground
      source={guitarBgSong}
      style={styles.background}
      resizeMode="stretch"
    >
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
            editorExitAllowed.current = false;
            setPlaying(false);
            setIsEdit(edit);
          }}
          songId={songId}
          onDeleted={() => {
            deletedSong.current = songId;
            editorExitAllowed.current = true;
            navigation.popTo("Tabs", { screen: "library" });
          }}
        />
      </Header>
      {loading || !song ? (
        <View style={styles.center}>
          <Text style={styles.status}>
            {t(loading ? "LoadingSong" : "SongNotFound")}
          </Text>
        </View>
      ) : isEdit ? (
        <>
          <CreateChordSong
            song={song}
            setIsEdit={setIsEdit}
            exitAllowed={editorExitAllowed}
          />
          <SongRecorder
            songId={songId}
            browseOnly
            open={route.params?.recordings}
            onOpened={() => navigation.setParams({ recordings: false })}
            active={focused && !tuner}
            onStart={() => setPlaying(false)}
          />
        </>
      ) : (
        <>
          {content.virtualized ? (
            <FlatList
              ref={list}
              {...scrollEvents}
              data={content.blocks}
              onViewableItemsChanged={viewableItemsChanged}
              keyExtractor={(block) => String(block[0].index)}
              renderItem={({ item }) => content.renderBlock(item)}
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              windowSize={3}
              contentContainerStyle={[styles.scroll, styles.virtualScroll]}
              ListHeaderComponent={
                <View style={styles.listHeader}>{metadata}</View>
              }
              ListFooterComponent={
                <View style={styles.listFooter}>{videoContent}</View>
              }
            />
          ) : (
            <ScrollView
              ref={scroll}
              {...scrollEvents}
              contentContainerStyle={styles.scroll}
            >
              <View style={styles.paper}>
                {metadata}
                {content.blocks.map(content.renderBlock)}
              </View>
              {videoContent}
            </ScrollView>
          )}
          <View
            style={[
              styles.toolbar,
              { paddingBottom: Math.max(insets.bottom, 12) }
            ]}
          >
            <SongRecorder
              songId={songId}
              open={route.params?.recordings}
              onOpened={() => navigation.setParams({ recordings: false })}
              active={focused && !tuner && !isEdit}
              controlsEnabled={focused && !tuner && !tools && !chord && !isEdit}
              onStart={() => {
                setVideos(false);
                startScrolling();
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
                if (playing) {
                  savePosition();
                  setPlaying(false);
                } else startScrolling();
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
          {!!previewChord && (
            <ChordSheet
              chord={previewChord}
              visible={!!chord}
              value={preferences.shapes[previewChord]}
              capo={preferences.capo}
              onChange={(index) =>
                change({
                  shapes: { ...preferences.shapes, [previewChord]: index }
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
  virtualScroll: { gap: 0 },
  listHeader: { paddingTop: 12 },
  listFooter: { paddingTop: 28, gap: 16 },
  paper: {
    borderRadius: 20,
    paddingVertical: 12,
    backgroundColor: palette.colors.transparent
  },
  pairedLines: { flexGrow: 0, flexShrink: 0 },
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
