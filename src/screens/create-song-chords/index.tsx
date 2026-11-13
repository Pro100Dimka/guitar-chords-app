// src/screens/create-song-chords/index.tsx
import { useFocusEffect, useRoute, RouteProp } from "@react-navigation/native";
import { Formik, FormikHelpers, FormikProps } from "formik";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Text from "../../components/styled-text";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import TextField from "../../components/fields/text-field";
import initialValues from "./formik/initial-values";
import onSubmit from "./formik/on-sabmit";
import { validationSchema } from "./formik/validation-schema";
import { useNavigation } from "@react-navigation/native";
import { NavigationProp, RootStackParamList } from "@/router";
import palette from "@/theme/palette";
import { ISong } from "@/@interfaces";
import { usePreferences } from "../../components/preferences";

import { Action } from "../song/tools";
import { lookupLyrics } from "../../components/song-autofill/lyrics";
import { applyRecognitionDraft } from "../../components/song-autofill/draft";
import {
  cancelRecognition,
  recognizeAudioFile,
  recognizeMicrophone
} from "../../components/song-autofill/recognition";
import {
  fileCanceled,
  importedSong,
  readLibraryFile,
  readSongCover
} from "../../components/library-files";

// интерфейс для формы
export interface FormValues {
  id: number;
  title: string;
  cover: string;
  content: string;
  youtube_music: string;
  youtobe_lesson: string;
  fk_band: { id: string; name: string; search_text_lower: string };
}
interface ICreateChordSongProps {
  song?: ISong;
  setIsEdit?: (_: boolean) => void;
}

const CreateChordSong: React.FC<ICreateChordSongProps> = memo(
  ({ song, setIsEdit }: ICreateChordSongProps) => {
    const route = useRoute<RouteProp<RootStackParamList, "createSong">>();
    const example = !song && route.params?.example;
    const { t } = useTranslation();
    const [extras, setExtras] = useState(false);
    const [importing, setImporting] = useState(false);
    const [coverBusy, setCoverBusy] = useState(false);
    const [lyricsBusy, setLyricsBusy] = useState(false);
    const [lyricsMessage, setLyricsMessage] = useState("");
    const [lyricsPreview, setLyricsPreview] = useState<number | null>(null);
    const [lyricsOptions, setLyricsOptions] = useState<
      Awaited<ReturnType<typeof lookupLyrics>>
    >([]);
    const lyricsController = useRef<AbortController | null>(null);
    const currentForm = useRef<FormikProps<FormValues>>(null);
    const lyricsSnapshot = useRef("");
    const lyricsGeneration = useRef(0);

    const [recognitionStatus, setRecognitionStatus] = useState("");
    const [recognitionBusy, setRecognitionBusy] = useState(false);
    const recognitionGeneration = useRef(0);
    const initialRecognition = useRef(false);
    const cancelAudio = useCallback(() => {
      recognitionGeneration.current++;
      void cancelRecognition();
      setRecognitionBusy(false);
    }, []);
    const startRecognition = useCallback(
      async (mode: "mic" | "file") => {
        const form = currentForm.current;
        if (!form) return;
        const snapshot = JSON.stringify(form.values);
        const generation = ++recognitionGeneration.current;
        cancelLyrics();
        setLyricsOptions([]);
        setRecognitionBusy(true);
        setRecognitionStatus(
          t(mode === "mic" ? "AutofillListening" : "AutofillIdentifying")
        );
        try {
          const found =
            mode === "mic"
              ? await recognizeMicrophone()
              : await recognizeAudioFile();
          if (generation !== recognitionGeneration.current) return;
          if (snapshot !== JSON.stringify(currentForm.current?.values)) {
            setRecognitionStatus(t("AutofillFormChanged"));
            return;
          }
          if (!found) {
            setRecognitionStatus(t("AutofillNoAudioMatch"));
            return;
          }
          setRecognitionStatus(
            t("AutofillRecognized", {
              artist: found.artist,
              title: found.title
            })
          );
          const next = applyRecognitionDraft(
            form.values,
            found.title,
            found.artist
          );
          await form.setValues(next);
          if (generation !== recognitionGeneration.current) return;
          setRecognitionStatus(t("AutofillSearching"));
          const lookupController = new AbortController();
          lyricsController.current = lookupController;
          const options = await lookupLyrics(
            found.title,
            found.artist,
            lookupController.signal
          );
          if (generation !== recognitionGeneration.current) return;
          if (
            JSON.stringify(currentForm.current?.values) !== JSON.stringify(next)
          ) {
            setRecognitionStatus(t("AutofillFormChanged"));
            return;
          }
          lyricsSnapshot.current = JSON.stringify(next);
          setLyricsOptions(options);
          setLyricsMessage(
            options.length ? t("AutofillLyricsOnly") : t("AutofillNoMatch")
          );
          setRecognitionStatus(
            t("AutofillRecognized", {
              artist: found.artist,
              title: found.title
            })
          );
        } catch (error) {
          if (generation !== recognitionGeneration.current) return;
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes("OPERATION_CANCELED") ||
            message.includes("Cancelled")
          ) {
            setRecognitionStatus(t("AutofillSearchCancelled"));
          } else if (message.includes("PermissionDenied")) {
            setRecognitionStatus(t("AutofillMicDenied"));
          } else {
            setRecognitionStatus(t("AutofillRecognitionError"));
          }
        } finally {
          if (generation === recognitionGeneration.current) {
            setRecognitionBusy(false);
            lyricsController.current = null;
          }
        }
      },
      [t]
    );
    const askRecognition = useCallback(
      (mode: "mic" | "file") => {
        const values = currentForm.current?.values;
        const proceed = () => void startRecognition(mode);
        if (values && (values.title.trim() || values.fk_band.name.trim())) {
          Alert.alert(t("AutofillReplaceTitle"), t("AutofillReplaceIdentity"), [
            { text: t("Cancel"), style: "cancel" },
            { text: t("AutofillReplace"), onPress: proceed }
          ]);
        } else proceed();
      },
      [startRecognition, t]
    );
    useEffect(
      () => () => {
        recognitionGeneration.current++;
        void cancelRecognition();
      },
      []
    );
    useEffect(() => {
      if (route.params?.recognize !== "mic" || initialRecognition.current)
        return;
      initialRecognition.current = true;
      const timer = setTimeout(() => askRecognition("mic"), 250);
      return () => clearTimeout(timer);
    }, [route.params?.recognize, askRecognition]);

    const cancelLyrics = () => {
      lyricsGeneration.current++;
      lyricsController.current?.abort();
      lyricsController.current = null;
      setLyricsBusy(false);
    };
    useEffect(
      () => () => {
        lyricsGeneration.current++;
        lyricsController.current?.abort();
      },
      []
    );
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const form = useRef<View>(null);
    const scroll = useRef<ScrollView>(null);
    const editingLyrics = useRef(false);
    const [formTop, setFormTop] = useState(0);
    const [viewport, setViewport] = useState(400);
    useEffect(() => {
      const listener = Keyboard.addListener("keyboardDidShow", () => {
        if (editingLyrics.current)
          scroll.current?.scrollToEnd({ animated: true });
      });
      return () => listener.remove();
    }, []);
    const navigation = useNavigation<NavigationProp>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [initialValuesState, setInitialValuesState] =
      useState<FormValues>(initialValues);
    useFocusEffect(
      useCallback(() => {
        cancelLyrics();
        setLyricsOptions([]);
        setLyricsPreview(null);
        if (song && song.id) {
          const { band_name, band_id, ...songProps } = song;
          setInitialValuesState({
            ...initialValues,
            ...songProps,
            cover: usePreferences.getState().songs[song.id]?.cover ?? "",
            fk_band: {
              name: band_name ?? "",
              id: band_id?.toString() ?? "",
              search_text_lower: (band_name ?? "").toLowerCase()
            }
          });
        } else {
          setInitialValuesState(
            example
              ? {
                  ...initialValues,
                  title: t("ExampleTitle"),
                  content: t("ExampleLyrics")
                }
              : initialValues
          );
        }
      }, [song, example, t])
    );
    const handleSubmit = async (
      values: FormValues,
      actions: FormikHelpers<FormValues>
    ) => {
      setIsSubmitting(true);
      await onSubmit(actions, values, navigation, setIsEdit);
      setIsSubmitting(false);
      actions.setSubmitting(false);
    };

    return (
      <View
        ref={form}
        style={styles.flex}
        onLayout={() => form.current?.measureInWindow((_, y) => setFormTop(y))}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={formTop}
        >
          <Formik
            innerRef={currentForm}
            initialValues={initialValuesState}
            enableReinitialize
            validationSchema={validationSchema(t)}
            onSubmit={handleSubmit}
          >
            {(formik) => (
              <View style={styles.flex}>
                <ScrollView
                  ref={scroll}
                  style={styles.flex}
                  contentContainerStyle={styles.container}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  showsVerticalScrollIndicator={false}
                  onLayout={({ nativeEvent }) =>
                    setViewport(nativeEvent.layout.height)
                  }
                >
                  <View style={styles.identity}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("ChangeSongCover")}
                      accessibilityState={{
                        disabled: coverBusy || isSubmitting,
                        busy: coverBusy
                      }}
                      disabled={coverBusy || isSubmitting}
                      style={[styles.cover, width < 360 && styles.coverNarrow]}
                      onPress={() => {
                        const changeCover = async (rotate = false) => {
                          setCoverBusy(true);
                          try {
                            await formik.setFieldValue(
                              "cover",
                              await readSongCover(
                                rotate ? formik.values.cover : undefined
                              )
                            );
                          } catch (error) {
                            if (!fileCanceled(error))
                              Alert.alert(t("CoverError"), t("CoverErrorHint"));
                          } finally {
                            setCoverBusy(false);
                          }
                        };
                        if (!formik.values.cover) {
                          void changeCover();
                          return;
                        }
                        Alert.alert(t("ChangeSongCover"), undefined, [
                          {
                            text: t("ChangeSongCover"),
                            onPress: () => void changeCover()
                          },
                          {
                            text: t("RotateCover"),
                            onPress: () => void changeCover(true)
                          },
                          {
                            text: t("ResetCover"),
                            onPress: () =>
                              void formik.setFieldValue("cover", "")
                          },
                          { text: t("Cancel"), style: "cancel" }
                        ]);
                      }}
                    >
                      <Image
                        source={
                          formik.values.cover
                            ? { uri: formik.values.cover }
                            : require("../../../assets/images/screen-background/gold-splash.png")
                        }
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                      />
                      <View style={styles.coverEdit} pointerEvents="none">
                        {coverBusy ? (
                          <ActivityIndicator
                            size="small"
                            color={palette.gold.ink}
                          />
                        ) : (
                          <MaterialCommunityIcons
                            name="pencil"
                            size={18}
                            color={palette.gold.ink}
                          />
                        )}
                      </View>
                    </Pressable>
                    <View style={styles.identityFields}>
                      <TextField
                        label={t("Band")}
                        placeholder={t("Band")}
                        value={formik.values.fk_band.name}
                        onChangeText={(name) =>
                          void formik.setFieldValue("fk_band", {
                            id: "",
                            name,
                            search_text_lower: name.trim().toLowerCase()
                          })
                        }
                        style={{ container: styles.identityField }}
                      />
                      <TextField
                        label={t("SongTitle")}
                        placeholder={t("SongTitle")}
                        formik={formik}
                        name="title"
                        style={{ container: styles.identityField }}
                      />
                    </View>
                  </View>
                  <View style={styles.details}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: extras }}
                      style={styles.detailsToggle}
                      onPress={() => setExtras(!extras)}
                    >
                      <Text style={styles.detailsTitle}>
                        {t("OptionalSongDetails")}
                      </Text>
                      <MaterialCommunityIcons
                        name={extras ? "chevron-up" : "chevron-down"}
                        size={22}
                        color={palette.glass.accent}
                      />
                    </Pressable>
                    {extras && (
                      <View style={styles.row}>
                        <TextField
                          label={`${t("SongLink")} · YouTube`}
                          placeholder="https://youtu.be/…"
                          formik={formik}
                          name="youtube_music"
                        />
                        <TextField
                          label={`${t("TrainingLink")} · YouTube`}
                          placeholder="https://youtu.be/…"
                          formik={formik}
                          name="youtobe_lesson"
                        />
                      </View>
                    )}
                  </View>
                  <View style={styles.importButton}>
                    <Action
                      glass
                      label={t("AutofillRecognizeMic")}
                      disabled={recognitionBusy || isSubmitting}
                      onPress={() => askRecognition("mic")}
                    />
                    <Action
                      glass
                      label={t("AutofillRecognizeFile")}
                      disabled={recognitionBusy || isSubmitting}
                      onPress={() => askRecognition("file")}
                    />
                    {recognitionBusy && (
                      <Action
                        glass
                        label={t("AutofillCancelSearch")}
                        onPress={() => {
                          cancelAudio();
                          cancelLyrics();
                          setRecognitionStatus(t("AutofillSearchCancelled"));
                        }}
                      />
                    )}
                    {!!recognitionStatus && (
                      <Text style={styles.lyricsMessage}>
                        {recognitionStatus}
                      </Text>
                    )}
                  </View>
                  <View style={styles.importButton}>
                    <Action
                      glass
                      label={t(importing ? "FileLoading" : "ImportSong")}
                      disabled={importing || isSubmitting}
                      onPress={async () => {
                        const importFile = async () => {
                          setImporting(true);
                          try {
                            const file = await readLibraryFile("song");
                            const imported = importedSong(file.text, file.name);
                            await formik.setValues({
                              ...formik.values,
                              ...imported
                            });
                            Alert.alert(
                              t("ImportReview"),
                              t("ImportReviewHint")
                            );
                          } catch (error) {
                            if (!fileCanceled(error))
                              Alert.alert(
                                t("ImportFailed"),
                                t(
                                  error instanceof Error &&
                                    [
                                      "FileFormatError",
                                      "FileTooLarge",
                                      "FileEncodingError"
                                    ].includes(error.message)
                                    ? error.message
                                    : "FileReadError"
                                )
                              );
                          } finally {
                            setImporting(false);
                          }
                        };
                        if (formik.values.content.trim())
                          Alert.alert(
                            t("ReplaceDraft"),
                            t("ReplaceDraftHint"),
                            [
                              { text: t("Cancel"), style: "cancel" },
                              {
                                text: t("ImportSong"),
                                onPress: () => void importFile()
                              }
                            ]
                          );
                        else await importFile();
                      }}
                    />
                  </View>
                  <View style={styles.importButton}>
                    <Action
                      glass
                      label={
                        lyricsBusy
                          ? t("AutofillCancelSearch")
                          : t("AutofillFindLyrics")
                      }
                      disabled={importing || isSubmitting}
                      onPress={async () => {
                        if (lyricsBusy) {
                          cancelLyrics();
                          setLyricsMessage(t("AutofillSearchCancelled"));
                          return;
                        }
                        const title = formik.values.title.trim();
                        const artist = formik.values.fk_band.name.trim();
                        if (!title || !artist) {
                          Alert.alert(t("AutofillIdentityRequired"));
                          return;
                        }
                        cancelLyrics();
                        const controller = new AbortController();
                        lyricsController.current = controller;
                        const generation = ++lyricsGeneration.current;
                        setLyricsPreview(null);
                        const oldValues = JSON.stringify(formik.values);
                        lyricsSnapshot.current = oldValues;
                        setLyricsBusy(true);
                        setLyricsOptions([]);
                        setLyricsMessage(t("AutofillSearching"));
                        try {
                          const results = await lookupLyrics(
                            title,
                            artist,
                            controller.signal
                          );
                          if (generation !== lyricsGeneration.current) return;
                          if (
                            oldValues !==
                            JSON.stringify(currentForm.current?.values)
                          ) {
                            setLyricsMessage(t("AutofillFormChanged"));
                            return;
                          }
                          setLyricsOptions(results);
                          setLyricsMessage(
                            results.length
                              ? t("AutofillLyricsOnly")
                              : t("AutofillNoMatch")
                          );
                        } catch (error) {
                          if (generation === lyricsGeneration.current)
                            setLyricsMessage(
                              error instanceof Error &&
                                error.message === "RateLimited"
                                ? t("AutofillRateLimited")
                                : t("AutofillUnavailable")
                            );
                        } finally {
                          if (generation === lyricsGeneration.current) {
                            setLyricsBusy(false);
                            lyricsController.current = null;
                          }
                        }
                      }}
                    />
                    {!!lyricsMessage && (
                      <Text style={styles.lyricsMessage}>{lyricsMessage}</Text>
                    )}
                    {lyricsOptions.map((option) => (
                      <View key={option.id} style={styles.lyricsCandidate}>
                        <Text style={styles.lyricsMessage}>
                          {t("AutofillAlbum")}:{" "}
                          {option.album || t("AutofillUnknownAlbum")} ·{" "}
                          {t("AutofillDuration")}:{" "}
                          {option.duration === null
                            ? "—"
                            : `${Math.floor(option.duration / 60)}:${String(Math.floor(option.duration % 60)).padStart(2, "0")}`}
                        </Text>
                        <Action
                          glass
                          label={
                            option.title + " · " + option.artist + " · LRCLIB"
                          }
                          onPress={() => {
                            const apply = () => {
                              if (
                                JSON.stringify(currentForm.current?.values) !==
                                lyricsSnapshot.current
                              ) {
                                Alert.alert(t("AutofillFormChanged"));
                                setLyricsOptions([]);
                                return;
                              }
                              void formik.setFieldValue(
                                "content",
                                option.content
                              );
                              setLyricsOptions([]);
                            };
                            if (formik.values.content.trim()) {
                              Alert.alert(
                                t("AutofillReplaceTitle"),
                                t("AutofillReplaceHint"),
                                [
                                  { text: t("Cancel"), style: "cancel" },
                                  { text: t("AutofillReplace"), onPress: apply }
                                ]
                              );
                            } else apply();
                          }}
                        />
                        <Action
                          glass
                          compact
                          label={
                            lyricsPreview === option.id
                              ? t("AutofillHidePreview")
                              : t("AutofillPreview")
                          }
                          onPress={() =>
                            setLyricsPreview(
                              lyricsPreview === option.id ? null : option.id
                            )
                          }
                        />
                        {lyricsPreview === option.id && (
                          <Text style={styles.lyricsPreview}>
                            {option.content}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                  <TextField
                    label={t("ChordsLyrics")}
                    placeholder={t("PasteSongHint")}
                    formik={formik}
                    name="content"
                    style={{
                      input: {
                        minHeight: 56,
                        height: Math.max(56, Math.min(260, viewport - 70)),
                        textAlignVertical: "top"
                      }
                    }}
                    onFocus={() => {
                      editingLyrics.current = true;
                      scroll.current?.scrollToEnd({ animated: true });
                    }}
                    onBlur={() => {
                      editingLyrics.current = false;
                    }}
                    multiline
                  />
                </ScrollView>
                <View
                  style={[
                    styles.saveButton,
                    { paddingBottom: Math.max(insets.bottom, 12) }
                  ]}
                >
                  <Action
                    primary
                    label={t("SaveSong")}
                    onPress={() => formik.handleSubmit()}
                    disabled={isSubmitting || importing || coverBusy}
                  />
                </View>
              </View>
            )}
          </Formik>
        </KeyboardAvoidingView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20
  },
  identityFields: { flex: 1, minWidth: 0, gap: 12 },
  identityField: { marginBottom: 0 },
  coverNarrow: { width: 88 },
  cover: {
    width: 112,
    height: 148,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  coverEdit: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.glass.accent,
    borderWidth: 1,
    borderColor: palette.gold.top
  },
  importButton: { marginBottom: 16, gap: 8 },
  lyricsMessage: { color: palette.glass.muted, fontSize: 13 },
  lyricsCandidate: { gap: 6, marginVertical: 6 },
  lyricsPreview: { color: palette.glass.ink, fontSize: 14, lineHeight: 21 },
  details: {
    marginBottom: 16,
    backgroundColor: palette.glass.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  detailsToggle: {
    minHeight: 52,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  detailsTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: palette.glass.ink
  },
  row: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 4,
    borderTopWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  flex: { flex: 1, display: "flex", flexDirection: "column" },
  container: {
    padding: 20,
    paddingBottom: 12,
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
  },
  saveButton: {
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: palette.glass.edge,
    backgroundColor: palette.glass.control,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
  }
});
export default CreateChordSong;
