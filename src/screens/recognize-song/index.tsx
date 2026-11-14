import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Image,
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
  RecognizedSong
} from "../../components/song-autofill/recognition";
import { Action, Sheet } from "../song/tools";
import {
  preferredSongContent,
  LyricsOption,
  lookupSongContent
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
  const {
    params: { mode }
  } = useRoute<RouteProp<RootStackParamList, "recognizeSong">>();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const size = Math.min(220, width - 100, height < 500 ? 140 : 220);
  const [versions, setVersions] = useState<LyricsOption[]>([]);
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
  const [draft, setDraft] = useState<FormValues | null>(null);
  const [lyricsNotice, setLyricsNotice] = useState<
    | "AddSongLyricsNotice"
    | "AddSongNoLyrics"
    | "AddSongLyricsUnavailable"
    | "AddSongChordsNotice"
  >("AddSongNoLyrics");
  const generation = useRef(0);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const stop = useCallback(() => {
    if (cancellation.current) return cancellation.current;
    versionResolver.current?.();
    versionResolver.current = undefined;
    setVersions([]);
    generation.current++;
    running.current = true;
    controller.current?.abort();
    if (mounted.current) {
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
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
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
      if (state === "background" && mode === "mic" && running.current) {
        stop();
      }
    });
    return () => subscription.remove();
  }, [mode, stop, t]);
  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const request = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFound(null);
    setDraft(null);
    setLyricsNotice("AddSongNoLyrics");
    setMessage(
      t(
        {
          mic: "AutofillListening",
          file: "AutofillIdentifying",
          text: "FileLoading"
        }[mode]
      )
    );
    try {
      if (mode === "text") {
        const file = await readLibraryFile("song");
        const imported = importedSong(file.text, file.name);
        if (request === generation.current)
          navigation.replace("createSong", {
            draft: { ...initialValues, ...imported }
          });
        return;
      }
      const result = await (mode === "mic"
        ? recognizeMicrophone(abort.signal)
        : recognizeAudioFile(abort.signal));
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
      setDraft(next);
      setLyricsNotice(
        next.content ? "AddSongLyricsNotice" : "AddSongLyricsUnavailable"
      );
      const [lyrics, cover] = await Promise.all([
        lookupSongContent(result.title, result.artist, abort.signal).then(
          (options) => ({ options, failed: false }),
          () => ({ options: [], failed: true })
        ),
        readRemoteSongCover(result.cover ?? "", abort.signal).catch(() => "")
      ]);
      if (request !== generation.current) return;
      const candidates = preferredSongContent(lyrics.options, result.album);
      const selected =
        candidates.length > 1
          ? await new Promise<LyricsOption | undefined>((resolve) => {
              versionResolver.current = resolve;
              setVersions(candidates);
            })
          : candidates[0];
      if (request !== generation.current) return;
      next = {
        ...next,
        cover,
        capo: selected?.capo,
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
      setDraft(next);
      setMessage(t("AddSongTapResult"));
      if (mode === "file")
        navigation.replace("createSong", {
          draft: next,
          notice
        });
    } catch (error) {
      if (request !== generation.current) return;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const categories: Record<string, string> = {
        AudioTooShort: "AutofillAudioTooShort",
        FileUnavailable: "AutofillFileUnavailable",
        NoAudioTrack: "AutofillNoAudioTrack",
        UnsupportedPcmFormat: "AutofillUnsupportedAudio",
        UnsupportedAudio: "AutofillUnsupportedAudio",
        AudioDecodeFailed: "AutofillUnsupportedAudio",
        NetworkError: "AutofillNetworkError",
        ServiceUnavailable: "AutofillServiceUnavailable",
        Busy: "AutofillBusy",
        MicrophonePermissionDenied: "AutofillMicDenied",
        AudioDeviceUnavailable: "AutofillAudioDeviceError",
        MicrophoneReadFailed: "AutofillAudioDeviceError"
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
            matches: fileCanceled(error) || errorMessage.includes("Cancelled"),
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
        running.current = false;
        setBusy(false);
      }
    }
  }, [mode, navigation, t]);
  useFocusEffect(
    useCallback(() => {
      if (mode !== "mic") void start();
      return () => {
        void stop();
      };
    }, [mode, start, stop])
  );
  const icon = {
    mic: "microphone",
    file: "file-music-outline",
    text: "file-document-outline"
  }[mode];
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!found && (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {t(mode === "mic" ? "AddSongListenTitle" : "AddSongFileTitle")}
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
        </>
      )}
      {found && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("AddSongEditResult")}
          disabled={!draft || busy}
          onPress={() =>
            draft &&
            navigation.replace("createSong", {
              draft,
              notice: lyricsNotice
            })
          }
          style={({ pressed }) => [styles.result, pressed && styles.pressed]}
        >
          <Image
            source={
              found.cover
                ? { uri: found.cover }
                : require("../../../assets/images/screen-background/gold-splash.png")
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
      {!!versions.length && (
        <Sheet
          title={t("ChooseLyricsVersion")}
          onClose={() => {
            versionResolver.current?.();
            setVersions([]);
          }}
        >
          {versions.map((option) => (
            <Action
              key={`${option.source}:${option.id}:${option.album}`}
              label={`${option.album || option.title} · ${option.source}${option.duration ? ` · ${Math.round(option.duration)} s` : ""}`}
              onPress={() => {
                versionResolver.current?.(option);
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
