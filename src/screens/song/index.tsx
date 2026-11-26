import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Alert,
  AppState,
  Animated,
  FlatList,
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  type ScrollViewProps,
  type ViewToken,
  type TextProps,
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
  songPlaybackLines,
  timedSongContent,
  transposeSong
} from "./chords";
import { Action, ChordSheet, SongTools, SongPlayback } from "./tools";
import { sourceSong } from "../../components/song-autofill/source-metadata";
import {
  lookupChordPage,
  matchedSongArrangement
} from "../../components/song-autofill/lyrics";
import { db } from "../../components/database";
import { tabBarTicks, tablatureLength } from "../../components/tablature";

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
  const [accompaniment, setAccompaniment] = useState(false);
  const [playbackStart, setPlaybackStart] = useState({ index: 0, request: 0 });
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const playhead = useRef(new Animated.Value(0)).current;
  const horizontalLines = useRef(new Map<number, ScrollView>());
  const blockPositions = useRef(new Map<number, number>());
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
    viewportWidth: 0,
    restored: false,
    target: preferences.position,
    endVisible: false
  });
  const hasSong = !loading && song?.id === songId;
  const stopAccompaniment = useCallback(() => setAccompaniment(false), []);
  useEffect(() => {
    if (!focused || tuner || tools || chord || isEdit || loading)
      setAccompaniment(false);
  }, [focused, tuner, tools, chord, isEdit, loading]);
  const change = (patch: Partial<typeof preferences>) => {
    if (hasSong && deletedSong.current !== songId) updateSong(songId, patch);
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
      if (!Number.isSafeInteger(songId) || songId <= 0) {
        setSong(undefined);
        setLoading(false);
        return;
      }
      let active = true;
      const controller = new AbortController();
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
        .then(async ([found]) => {
          if (active && deletedSong.current !== songId) {
            if (!found) {
              setSong(undefined);
              return;
            }
            const saved = usePreferences.getState().songs[songId];
            const arrangement = matchedSongArrangement(
              found.title,
              found.band_name ?? ""
            );
            const imported = sourceSong(
              found.content ?? "",
              saved?.tempo,
              true,
              arrangement
            );
            setSong({ ...found, content: imported.content });
            updateSong(songId, {
              opened: Date.now(),
              ...((!saved?.tablature ||
                (!saved.tablature.chords?.length &&
                  imported.tablature?.chords?.length &&
                  JSON.stringify(saved.tablature.notes) ===
                    JSON.stringify(
                      sourceSong(found.content ?? "", saved.tempo, false)
                        .tablature?.notes
                    ))) &&
              imported.tablature
                ? { tablature: imported.tablature }
                : {})
            });
            setLoading(false);
            const provider = (
              [
                "Cifra Club",
                "E-Chords",
                "Cifras",
                "GuitareTab",
                "Akkords.pro"
              ] as const
            ).find((name) => name === saved?.contentSource?.name);
            if (
              !saved?.tablature ||
              saved.tablature.arrangementSource ||
              (!saved.tablature.sourceText &&
                (!provider || !saved.contentSource))
            )
              return;
            try {
              const options =
                !saved.tablature.sourceText && provider && saved.contentSource
                  ? await lookupChordPage(
                      found.title,
                      found.band_name ?? "",
                      provider,
                      controller.signal,
                      saved.contentSource.url
                    )
                  : [];
              const option = options.find(
                (option) => option.url === saved.contentSource?.url
              );
              const rawText = saved.tablature.sourceText ?? option?.content;
              if (!rawText || !active || deletedSong.current === songId) return;
              const legacy = sourceSong(rawText, saved.tempo, false);
              const baseline = sourceSong(rawText, saved.tempo);
              const replacement = sourceSong(
                rawText,
                saved.tempo,
                true,
                arrangement
              );
              const canonical = (text: string) =>
                createSongEditorState(text).text.replace(/\s+/g, "");
              const current = usePreferences.getState().songs[songId];
              const savedNotes = JSON.stringify(saved.tablature.notes);
              if (
                !replacement.tablature?.chords?.length ||
                current?.tablature !== saved.tablature ||
                ![legacy, baseline, replacement].some(
                  (parsed) =>
                    JSON.stringify(parsed.tablature?.notes) === savedNotes
                ) ||
                JSON.stringify(replacement.tablature) ===
                  JSON.stringify(saved.tablature) ||
                ![
                  canonical(legacy.content),
                  canonical(baseline.content),
                  canonical(replacement.content)
                ].includes(canonical(found.content ?? ""))
              )
                return;
              await new Promise<void>((resolve, reject) =>
                db.transaction(
                  (tx) => {
                    tx.executeSql(
                      "UPDATE songs SET content = ? WHERE id = ? AND content = ?",
                      [replacement.content, songId, found.content],
                      (_, result) => {
                        if (result.rowsAffected !== 1)
                          throw new Error("SongMissing");
                      }
                    );
                  },
                  reject,
                  resolve
                )
              );
              if (!active || deletedSong.current === songId) return;
              setAccompaniment(false);
              updateSong(songId, { tablature: replacement.tablature });
              setSong({ ...found, content: replacement.content });
            } catch (error) {
              if (!controller.signal.aborted)
                console.warn("Song arrangement refresh failed", error);
            }
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
        controller.abort();
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
      viewportWidth: 0,
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
        setAccompaniment(false);
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
  const display = useMemo(
    () =>
      createSongEditorState(
        transposeSong(
          timedSongContent(
            song?.content ?? "",
            preferences.accompaniment === "pattern"
              ? undefined
              : preferences.tablature
          ),
          preferences.transpose - preferences.capo
        )
      ),
    [
      song?.content,
      preferences.transpose,
      preferences.capo,
      preferences.accompaniment,
      preferences.tablature
    ]
  );
  const playbackLines = useMemo(
    () => songPlaybackLines(display.text),
    [display.text]
  );
  const playbackPosition = useCallback(
    (position: number, lineProgress?: number) => {
      const line = playbackLines[Math.floor(position)];
      if (line === undefined) {
        setActiveLine(null);
        return;
      }
      const first = playbackLines.indexOf(line);
      const last = playbackLines.lastIndexOf(line);
      playhead.setValue(
        lineProgress ??
          Math.max(0, Math.min(1, (position - first) / (last - first + 1)))
      );
      setActiveLine(line);
    },
    [playbackLines, playhead]
  );
  const startAccompaniment = useCallback(
    (index = 0) => {
      const score =
        preferences.accompaniment === "pattern"
          ? undefined
          : preferences.tablature;
      if (
        !score?.notes.length &&
        !preferences.strum &&
        !Object.values(preferences.rhythmSections).some(
          (section) => section.strum
        )
      ) {
        setTools("rhythm");
        return;
      }
      if (
        score?.notes.length &&
        (score.chords?.length
          ? index >= score.chords.length
          : index * tabBarTicks(score) >= tablatureLength(score))
      ) {
        Alert.alert(t("SongLineWithoutTabs"));
        return;
      }
      setPlaying(false);
      setVideos(false);
      playbackPosition(index);
      setPlaybackStart((previous) => ({
        index,
        request: previous.request + 1
      }));
      setAccompaniment(true);
    },
    [preferences, playbackPosition, t]
  );
  useEffect(() => {
    if (accompaniment) return;
    if (preferences.playOnLineSelect === false)
      playbackPosition(playbackStart.index);
    else setActiveLine(null);
  }, [
    accompaniment,
    preferences.playOnLineSelect,
    playbackStart.index,
    playbackPosition
  ]);
  const selectPlaybackLine = useCallback(
    (index: number) => {
      if (preferences.playOnLineSelect !== false) {
        startAccompaniment(index);
        return;
      }
      setAccompaniment(false);
      setPlaybackStart((previous) => ({ ...previous, index }));
    },
    [preferences.playOnLineSelect, startAccompaniment]
  );
  const content = useMemo(() => {
    const renderChord = (displayed: string, key: number) => {
      return (
        <Text
          key={key}
          accessibilityRole="button"
          accessibilityLabel={`${displayed}, ${t("Fingering")}`}
          onPress={(event) => {
            event.stopPropagation();
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
      const start = playbackLines.indexOf(index);
      const props: TextProps = {
        ...(start >= 0
          ? {
              accessibilityRole: "button" as const,
              accessibilityHint: t(
                preferences.playOnLineSelect === false
                  ? "SongSelectPlaybackLine"
                  : "SongPlayFromLine"
              ),
              onPress: () => selectPlaybackLine(start)
            }
          : {}),
        onLayout: paired
          ? undefined
          : ({ nativeEvent }) =>
              blockPositions.current.set(index, nativeEvent.layout.y),
        numberOfLines: paired ? 1 : undefined,
        style: [
          styles.content,
          {
            fontSize: preferences.fontSize,
            lineHeight: preferences.fontSize * 1.65
          }
        ]
      };
      const children = (
        <>
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
        </>
      );
      return index === activeLine ? (
        <PlaybackLyricLine
          key={index}
          {...props}
          progress={playhead}
          background={!paired}
          onCursor={(x) =>
            horizontalLines.current.get(index)?.scrollTo({
              x: Math.max(0, x - metrics.current.viewportWidth * 0.35),
              animated: false
            })
          }
        >
          {children}
        </PlaybackLyricLine>
      ) : (
        <Text key={index} {...props}>
          {children}
        </Text>
      );
    };
    let offset = 0,
      groupIndex = 0;
    const rows = display.text.split(/\r?\n/).map((line, index) => {
      while (
        groupIndex < display.groups.length &&
        offset > display.groups[groupIndex].end
      )
        groupIndex++;
      const group = display.groups[groupIndex];
      const pair = group && offset >= group.start ? groupIndex : -1;
      const onlyChords = group?.end !== offset && isChordLine(line);
      offset += line.length + 1;
      return { line, index, onlyChords, pair };
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
      while (
        end < rows.length &&
        rows[end].onlyChords &&
        (row.pair >= 0
          ? rows[end].pair === row.pair
          : rows[end].pair < 0 && (!virtualized || end - index < 8))
      )
        end++;
      if (rows[end]?.line.trim() && !rows[end].onlyChords) end++;
      blocks.push(rows.slice(index, end));
      index = end;
    }
    const renderBlock = (block: typeof rows) => {
      const row = block[0];
      if (!row.onlyChords) return renderLine(row.line, row.index, false);
      return (
        <ScrollView
          key={row.index}
          ref={(node) =>
            block.forEach((item) => {
              if (node) horizontalLines.current.set(item.index, node);
              else horizontalLines.current.delete(item.index);
            })
          }
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          style={[
            styles.pairedLines,
            block.some((item) => item.index === activeLine) &&
              styles.activeLines
          ]}
          onLayout={({ nativeEvent }) =>
            blockPositions.current.set(row.index, nativeEvent.layout.y)
          }
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
    display,
    preferences.fontSize,
    t,
    activeLine,
    playhead,
    playbackLines,
    preferences.playOnLineSelect,
    selectPlaybackLine
  ]);
  useEffect(() => {
    if (activeLine === null) return;
    const index = content.blocks.findIndex((block) =>
      block.some((row) => row.index === activeLine)
    );
    if (index < 0) return;
    if (list.current)
      list.current.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    else {
      const y = blockPositions.current.get(content.blocks[index][0].index);
      if (y !== undefined)
        scroll.current?.scrollTo({
          y: Math.max(0, y - metrics.current.viewport * 0.3),
          animated: true
        });
    }
  }, [activeLine, content.blocks]);
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
      metrics.current.viewportWidth = nativeEvent.layout.width;
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
  const firstChord = useMemo(
    () => songChords(song?.content ?? "")[0],
    [song?.content]
  );
  const previewChord = chord || firstChord;
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
          disabled={!hasSong}
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
          disabled={!hasSong}
          setIsEdit={(edit) => {
            if (edit && !hasSong) return;
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
              label={t("SongAccompaniment")}
              icon="music-note"
              accessibilityLabel={t(
                accompaniment ? "StopSongAccompaniment" : "SongAccompaniment"
              )}
              selected={accompaniment}
              onPress={() => {
                if (accompaniment) {
                  setAccompaniment(false);
                  return;
                }
                startAccompaniment(playbackStart.index);
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
          {accompaniment && (
            <SongPlayback
              key={playbackStart.request}
              content={song.content}
              value={preferences}
              startIndex={playbackStart.index}
              onPosition={playbackPosition}
              onStopped={stopAccompaniment}
            />
          )}
          {tools && (
            <SongTools
              initialTab={tools}
              content={song.content}
              value={preferences}
              onChange={change}
              onClose={() => setTools(false)}
              onOpenTabs={() => {
                setTools(false);
                savePosition();
                navigation.popTo("Tabs", {
                  screen: "play",
                  params: {
                    tablatureSongId: songId,
                    tablatureRequest: Date.now()
                  }
                });
              }}
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
function PlaybackLyricLine({
  progress,
  background = true,
  onCursor,
  onLayout,
  ...props
}: TextProps & {
  progress: Animated.Value;
  background?: boolean;
  onCursor: (x: number) => void;
}) {
  const lines = useRef<
    { text: string; x: number; y: number; width: number; height: number }[]
  >([]);
  const current = useRef(0);
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(24);
  const place = useCallback(
    ({ value }: { value: number }) => {
      current.current = value;
      let remaining =
        lines.current.reduce((sum, line) => sum + line.text.length, 0) *
        Math.min(0.99999, value);
      for (const line of lines.current) {
        if (remaining >= line.text.length) {
          remaining -= line.text.length;
          continue;
        }
        const left =
          line.x + (line.width * remaining) / Math.max(1, line.text.length);
        x.setValue(left);
        y.setValue(line.y);
        onCursor(left);
        return;
      }
    },
    [x, y, onCursor]
  );
  useEffect(() => {
    const id = progress.addListener(place);
    return () => progress.removeListener(id);
  }, [progress, place]);
  return (
    <View
      onLayout={onLayout}
      style={[styles.playbackLine, background && styles.activeLines]}
    >
      <Text
        {...props}
        onTextLayout={({ nativeEvent }) => {
          lines.current = nativeEvent.lines;
          setHeight(nativeEvent.lines[0]?.height ?? 24);
          place({ value: current.current });
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.playbackCursor,
          {
            height,
            transform: [{ translateX: x }, { translateY: y }]
          }
        ]}
      />
    </View>
  );
}

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
  activeLines: { backgroundColor: palette.glass.activeLine },
  playbackLine: { position: "relative" },
  playbackCursor: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 2,
    backgroundColor: palette.glass.play
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
// Navigation may reuse a route instance with a different song ID. Remount
// the editor, recording controls and scroll state rather than carrying them
// into the next song (a recording flag alone must not remount the screen).
export default function SongScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Song">>();
  return <SongDetail key={route.params?.id ?? "missing"} />;
}
