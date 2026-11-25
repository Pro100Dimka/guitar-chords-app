import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions
} from "react-native";
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute
} from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import LinearGradient from "react-native-linear-gradient";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import Text from "../../components/styled-text";
import palette from "../../theme/palette";
import type { NavigationProp, RootStackParamList } from "../../router";
import type { FormValues } from "../create-song-chords";
import {
  cancelRecognition,
  recognizeAudioFile,
  recognizeMicrophone,
  recognizePlayback,
  requestQuickSettingsTile,
  RecognizedSong
} from "../../components/song-autofill/recognition";
import { Action, Sheet } from "../song/tools";
import {
  preferredSongContent,
  LyricsOption,
  lookupSongContent,
  lookupSongTempo,
  hasSongChordsAsync
} from "../../components/song-autofill/lyrics";
import {
  fileCanceled,
  importedSong,
  readLibraryFile,
  readRemoteSongCover
} from "../../components/library-files";
import initialValues from "../create-song-chords/formik/initial-values";
import { applyRecognitionDraft } from "../../components/song-autofill/draft";

export default function RecognizeSong() {
  const { params } = useRoute<RouteProp<RootStackParamList, "recognizeSong">>();
  const mode =
    params?.mode && ["mic", "playback", "file", "text"].includes(params.mode)
      ? params.mode
      : "mic";
  const autoStart =
    params?.autoStart === true && ["mic", "playback"].includes(params.mode);
  const launchRequest = `${mode}:${params?.requestId ?? "initial"}`;
  const handledLaunch = useRef<string | undefined>(undefined);
  const launch = useRef({ autoStart, launchRequest });
  launch.current = { autoStart, launchRequest };
  const focused = useRef(false);
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const size = Math.min(220, width - 100, height < 500 ? 140 : 220);
  const [versions, setVersions] = useState<LyricsOption[]>([]);
  const [availableVersions, setAvailableVersions] = useState<LyricsOption[]>(
    []
  );
  const versionResolver = useRef<((option?: LyricsOption) => void) | undefined>(
    undefined
  );
  const [stopping, setStopping] = useState(false);
  const cancellation = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [found, setFound] = useState<RecognizedSong | null>(null);
  const [retrySong, setRetrySong] = useState<RecognizedSong | null>(null);
  const [tileMessage, setTileMessage] = useState("");
  const [draft, setDraft] = useState<FormValues | null>(null);
  const draftReady = useRef(false);
  const [lyricsNotice, setLyricsNotice] = useState<
    | "AddSongLyricsNotice"
    | "AddSongNoLyrics"
    | "AddSongLyricsUnavailable"
    | "AddSongChordsNotice"
  >("AddSongNoLyrics");
  const generation = useRef(0);
  const running = useRef(false);
  const awaitingMicStart = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const stop = useCallback(() => {
    if (cancellation.current) return cancellation.current;
    versionResolver.current?.();
    versionResolver.current = undefined;
    setVersions([]);
    generation.current++;
    awaitingMicStart.current = false;
    running.current = true;
    controller.current?.abort();
    if (mounted.current) {
      if (!draftReady.current) setFound(null);
      setBusy(true);
      setStopping(true);
      setMessage(t("AutofillStopping"));
    }
    const complete = cancelRecognition()
      .catch(() => undefined)
      .finally(() => {
        cancellation.current = null;
        running.current = false;
        if (mounted.current) {
          setBusy(false);
          setStopping(false);
          setMessage(t("AutofillSearchCancelled"));
        }
      });
    cancellation.current = complete;
    return complete;
  }, [t]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!busy || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [busy, pulse, reduceMotion]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (
        state === "background" &&
        mode === "mic" &&
        running.current &&
        !awaitingMicStart.current
      ) {
        stop();
      }
    });
    return () => subscription.remove();
  }, [mode, stop, t]);
  const start = useCallback(
    async (identified?: RecognizedSong) => {
      if (running.current) return;
      running.current = true;
      const request = ++generation.current;
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setFound(null);
      setRetrySong(null);
      setAvailableVersions([]);
      setDraft(null);
      draftReady.current = false;
      setLyricsNotice("AddSongNoLyrics");
      setMessage(
        t(
          identified
            ? "AddSongPreparing"
            : {
                mic: "AutofillListening",
                playback: "AutofillListeningPlayback",
                file: "AutofillIdentifying",
                text: "FileLoading"
              }[mode]
        )
      );
      try {
        if (mode === "text") {
          const file = await readLibraryFile("song", abort.signal);
          const imported = importedSong(file.text, file.name);
          if (request === generation.current)
            navigation.replace("createSong", {
              draft: { ...initialValues, ...imported }
            });
          return;
        }
        awaitingMicStart.current = !identified && mode === "mic";
        const result =
          identified ??
          (await (mode === "mic"
            ? recognizeMicrophone(abort.signal, () => {
                awaitingMicStart.current = false;
              })
            : mode === "playback"
              ? recognizePlayback(abort.signal)
              : recognizeAudioFile(abort.signal)));
        if (request !== generation.current) return;
        if (!result) {
          setMessage(t("AutofillNoAudioMatch"));
          return;
        }
        setFound(result);
        setMessage(t("AddSongPreparing"));
        let next = applyRecognitionDraft(
          initialValues,
          result.title,
          result.artist,
          result.lyrics,
          result.tempo
        );
        if (next.content && result.url?.startsWith("https://www.shazam.com/")) {
          next = {
            ...next,
            contentSource: {
              name: "Shazam",
              url: result.url,
              credit: result.lyricsCredit
            }
          };
        }
        setLyricsNotice(
          next.content ? "AddSongLyricsNotice" : "AddSongLyricsUnavailable"
        );
        const [lyrics, cover, tempo] = await Promise.all([
          lookupSongContent(result.title, result.artist, abort.signal).then(
            (options) => ({ options, failed: false }),
            () => ({ options: [], failed: true })
          ),
          readRemoteSongCover(result.cover ?? "", abort.signal).catch(() => ""),
          result.tempo !== undefined
            ? Promise.resolve(result.tempo)
            : lookupSongTempo(
                result.title,
                result.artist,
                result.url ?? "",
                abort.signal
              ).catch(() => undefined)
        ]);
        if (request !== generation.current) return;
        const playable: LyricsOption[] = [];
        for (const option of lyrics.options) {
          if (
            option.hasChords &&
            (await hasSongChordsAsync(option.content, abort.signal, true))
          )
            playable.push({ ...option, hasChords: true });
        }
        if (request !== generation.current) return;
        const candidates = preferredSongContent(
          playable,
          result.album,
          result.duration
        );
        setAvailableVersions(candidates);
        if (!candidates.length) {
          setFound(null);
          setDraft(null);
          setRetrySong(result);
          setMessage(
            t(lyrics.failed ? "AddSongLyricsUnavailable" : "AddSongNoLyrics")
          );
          return;
        }
        const selected =
          candidates.length > 1
            ? await new Promise<LyricsOption | undefined>((resolve) => {
                versionResolver.current = resolve;
                setVersions(candidates);
              })
            : candidates[0];
        if (request !== generation.current) return;
        if (!selected) {
          setFound(null);
          setDraft(null);
          setMessage(t("AutofillSearchCancelled"));
          return;
        }
        next = {
          ...next,
          cover,
          ...(tempo !== undefined ? { tempo } : {}),
          capo: selected?.capo,
          rhythm: selected?.rhythm,
          sourceTuning: selected?.tuning,
          content: selected?.content ?? next.content,
          contentSource: selected
            ? selected.url
              ? { name: selected.source, url: selected.url }
              : undefined
            : next.contentSource
        };
        const notice = selected?.hasChords
          ? "AddSongChordsNotice"
          : next.content
            ? "AddSongLyricsNotice"
            : lyrics.failed
              ? "AddSongLyricsUnavailable"
              : "AddSongNoLyrics";
        setLyricsNotice(notice);
        draftReady.current = true;
        setDraft(next);
        setMessage(t("AddSongTapResult"));
        if (mode === "file")
          navigation.replace("createSong", {
            draft: next,
            notice
          });
      } catch (error) {
        if (request !== generation.current) return;
        if (!draftReady.current) setFound(null);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const categories: Record<string, string> = {
          AudioTooShort: "AutofillAudioTooShort",
          FileUnavailable: "AutofillFileUnavailable",
          FileReadTimeout: "AutofillFileReadTimeout",
          NoAudioTrack: "AutofillNoAudioTrack",
          UnsupportedPcmFormat: "AutofillUnsupportedAudio",
          UnsupportedAudio: "AutofillUnsupportedAudio",
          AudioDecodeFailed: "AutofillUnsupportedAudio",
          NetworkError: "AutofillNetworkError",
          ServiceUnavailable: "AutofillServiceUnavailable",
          Busy: "AutofillBusy",
          MicrophonePermissionDenied: "AutofillMicDenied",
          AudioDeviceUnavailable: "AutofillAudioDeviceError",
          MicrophoneReadFailed: "AutofillAudioDeviceError",
          PlaybackCaptureUnavailable: "AutofillPlaybackUnavailable",
          PlaybackCaptureCancelled: "AutofillSearchCancelled",
          PlaybackCaptureTimeout: "AutofillPlaybackTimeout",
          PlaybackAudioUnavailable: "AutofillPlaybackNoAudio",
          PlaybackCaptureFailed: "AutofillPlaybackFailed"
        };
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "";
        const category =
          categories[code] ??
          categories[
            Object.keys(categories).find((key) => errorMessage.includes(key)) ??
              ""
          ];
        const key =
          category ??
          [
            {
              matches:
                fileCanceled(error) || errorMessage.includes("Cancelled"),
              key: "AutofillSearchCancelled"
            },
            {
              matches: errorMessage.includes("RateLimited"),
              key: "AutofillRecognitionRateLimited"
            },
            {
              matches: errorMessage.includes("PermissionDenied"),
              key: "AutofillMicDenied"
            },
            {
              matches: [
                "FileFormatError",
                "FileTooLarge",
                "FileEncodingError"
              ].includes(errorMessage),
              key: errorMessage
            }
          ].find((item) => item.matches)?.key ??
          (mode === "text" ? "FileReadError" : "AutofillRecognitionError");
        setMessage(t(key));
      } finally {
        if (request === generation.current) {
          awaitingMicStart.current = false;
          running.current = false;
          setBusy(false);
        }
      }
    },
    [mode, navigation, t]
  );
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      let activeFocus = true;
      const pending = launch.current;
      const shouldStart =
        mode === "file" ||
        mode === "text" ||
        (pending.autoStart && handledLaunch.current !== pending.launchRequest);
      if (shouldStart) {
        handledLaunch.current = pending.launchRequest;
        void (cancellation.current ?? Promise.resolve()).then(() => {
          if (activeFocus) void start();
        });
      }
      return () => {
        activeFocus = false;
        focused.current = false;
        void stop();
      };
    }, [mode, start, stop])
  );
  useEffect(() => {
    if (
      !autoStart ||
      !focused.current ||
      handledLaunch.current === launchRequest
    )
      return;
    handledLaunch.current = launchRequest;
    if (!running.current) void start();
  }, [autoStart, launchRequest, start]);
  const icon = {
    mic: "microphone",
    playback: "cellphone-sound",
    file: "file-music-outline",
    text: "file-document-outline"
  }[mode];
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!found && (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {t(
              mode === "playback"
                ? "AddSongPlaybackTitle"
                : mode === "mic"
                  ? "AddSongListenTitle"
                  : "AddSongFileTitle"
            )}
          </Text>
          <View style={[styles.orbit, { width: size + 54, height: size + 54 }]}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                {
                  opacity: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.15, 0.65]
                  }),
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.12]
                      })
                    }
                  ]
                }
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                busy ? "AutofillCancelSearch" : "AddSongStart"
              )}
              accessibilityState={{ busy }}
              disabled={stopping}
              onPress={() => {
                if (cancellation.current) return;
                if (busy) {
                  stop();
                } else void start();
              }}
              style={({ pressed }) => [
                styles.disc,
                { width: size, height: size, borderRadius: size / 2 },
                pressed && styles.pressed
              ]}
            >
              <LinearGradient
                colors={palette.finish.goldColors}
                locations={palette.finish.locations}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.innerDisc}>
                <MaterialCommunityIcons
                  name={busy ? "stop" : icon}
                  size={size * 0.3}
                  color={palette.glass.accent}
                />
              </View>
            </Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {message || t("AddSongStart")}
          </Text>
          {mode === "playback" && (
            <Text style={styles.hint}>
              {t(
                Platform.OS === "ios"
                  ? "AddSongPlaybackIOSHint"
                  : "AddSongPlaybackAndroidHint"
              )}
            </Text>
          )}
          {!!retrySong && !busy && (
            <>
              <Text style={styles.hint}>
                {t("AutofillRecognized", {
                  artist: retrySong.artist,
                  title: retrySong.title
                })}
              </Text>
              <Action
                label={t("AddSongRetryChords")}
                icon="refresh"
                onPress={() => void start(retrySong)}
              />
            </>
          )}
          {mode === "playback" && !busy && (
            <>
              {Platform.OS === "android" && Number(Platform.Version) >= 33 ? (
                <Action
                  label={t("AddSongQuickTile")}
                  icon="view-grid-plus-outline"
                  onPress={() => {
                    void requestQuickSettingsTile().then(
                      (added) =>
                        setTileMessage(
                          t(
                            added
                              ? "AddSongQuickTileAdded"
                              : "AddSongQuickTileHint"
                          )
                        ),
                      () => setTileMessage(t("AddSongQuickTileHint"))
                    );
                  }}
                />
              ) : (
                <Text style={styles.hint}>
                  {t(
                    Platform.OS === "ios"
                      ? "AddSongControlCenterHint"
                      : "AddSongQuickTileHint"
                  )}
                </Text>
              )}
              {!!tileMessage && <Text style={styles.hint}>{tileMessage}</Text>}
            </>
          )}
        </>
      )}
      {found && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("AddSongEditResult")}
          disabled={!draft || stopping}
          onPress={() => {
            if (!draft) return;
            void stop();
            navigation.navigate("createSong", { draft, notice: lyricsNotice });
          }}
          style={({ pressed }) => [styles.result, pressed && styles.pressed]}
        >
          <Image
            source={
              found.cover
                ? { uri: found.cover }
                : require("../../../assets/images/screen-background/gold-splash.webp")
            }
            style={styles.cover}
          />
          <View style={styles.words}>
            <Text style={styles.songTitle}>{found.title}</Text>
            <Text style={styles.artist}>{found.artist}</Text>
            {!!found.album && (
              <Text style={styles.metadata}>{found.album}</Text>
            )}
            {!!found.genre && (
              <Text style={styles.metadata}>{found.genre}</Text>
            )}
            <Text style={styles.source}>Shazam</Text>
          </View>
          <View style={styles.resultFooter}>
            {busy ? (
              <ActivityIndicator color={palette.glass.accent} />
            ) : (
              <MaterialCommunityIcons
                name="pencil-outline"
                size={21}
                color={palette.glass.accent}
              />
            )}
            <Text style={styles.status}>
              {t(busy ? "AddSongPreparing" : "Edit")}
            </Text>
          </View>
          {!busy && !!draft && (
            <Text style={styles.hint}>{t(lyricsNotice)}</Text>
          )}
        </Pressable>
      )}
      {!!found && busy && (
        <Action
          label={t("Cancel")}
          icon="close"
          disabled={stopping}
          onPress={() => void stop()}
        />
      )}
      {!!found && !busy && availableVersions.length > 1 && (
        <Action
          label={t("ChooseLyricsVersion")}
          onPress={() => setVersions(availableVersions)}
        />
      )}
      {!!versions.length && (
        <Sheet
          title={t("ChooseLyricsVersion")}
          onClose={() => {
            versionResolver.current?.();
            setVersions([]);
          }}
        >
          {versions.map((option, index) => (
            <Action
              key={`${option.source}:${option.url ?? option.id}:${option.album}`}
              label={`${option.album || option.title} · ${option.source}${option.duration ? ` · ${Math.round(option.duration)} s` : ""} · ${index + 1}`}
              onPress={() => {
                if (versionResolver.current) versionResolver.current(option);
                else
                  setDraft(
                    (previous) =>
                      previous && {
                        ...previous,
                        content: option.content,
                        capo: option.capo,
                        rhythm: option.rhythm,
                        sourceTuning: option.tuning,
                        contentSource: option.url
                          ? { name: option.source, url: option.url }
                          : undefined
                      }
                  );
                versionResolver.current = undefined;
                setVersions([]);
              }}
            />
          ))}
        </Sheet>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center"
  },
  title: {
    color: palette.glass.ink,
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center"
  },
  hint: {
    color: palette.glass.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 420
  },
  orbit: { alignItems: "center", justifyContent: "center", marginVertical: 16 },
  halo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 180,
    borderWidth: 1,
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.cell
  },
  disc: {
    overflow: "hidden",
    padding: 5,
    borderWidth: 1,
    borderColor: palette.gold.rimLight,
    elevation: 12,
    shadowColor: palette.gold.glow,
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 }
  },
  innerDisc: {
    flex: 1,
    borderRadius: 150,
    backgroundColor: palette.recorder.body,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: palette.gold.rimShade
  },
  status: {
    color: palette.glass.ink,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center"
  },
  result: {
    alignItems: "center",
    gap: 20,
    padding: 24,
    width: "100%",
    backgroundColor: palette.glass.card,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 22
  },
  cover: {
    width: 160,
    height: 160,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  words: { width: "100%", alignItems: "center", gap: 8 },
  resultFooter: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  songTitle: {
    color: palette.glass.ink,
    fontSize: 25,
    lineHeight: 34,
    fontWeight: "600",
    textAlign: "center"
  },
  artist: { color: palette.glass.muted, fontSize: 18, textAlign: "center" },
  metadata: { color: palette.glass.muted, fontSize: 13, textAlign: "center" },
  source: { color: palette.glass.accent, fontSize: 11 },
  pressed: { opacity: 0.75 }
});
