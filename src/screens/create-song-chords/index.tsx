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
    const [extras, setExtras] = useState(false);
    const [importing, setImporting] = useState(false);
    const [coverBusy, setCoverBusy] = useState(false);
    const [lyricsBusy, setLyricsBusy] = useState(false);
    const [lyricsMessage, setLyricsMessage] = useState("");
    const [lyricsOptions, setLyricsOptions] = useState<Awaited<ReturnType<typeof lookupLyrics>>>([]);
    const lyricsController = useRef<AbortController | null>(null);
    const currentForm = useRef<FormikProps<FormValues>>(null);
    const lyricsGeneration = useRef(0);
    const cancelLyrics = () => {
      lyricsGeneration.current++;
      lyricsController.current?.abort();
      lyricsController.current = null;
      setLyricsBusy(false);
    };
    useEffect(() => () => {
      lyricsGeneration.current++;
      lyricsController.current?.abort();
    }, []);
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
    const { t } = useTranslation();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [initialValuesState, setInitialValuesState] =
      useState<FormValues>(initialValues);
    useFocusEffect(
      useCallback(() => {
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
                    <Action glass label={lyricsBusy ? "Отменить поиск" : "Найти текст (LRCLIB)"}
                      disabled={importing || isSubmitting}
                      onPress={async () => {
                        if (lyricsBusy) {
                          cancelLyrics();
                          setLyricsMessage("Поиск отменён");
                          return;
                        }
                        const title = formik.values.title.trim();
                        const artist = formik.values.fk_band.name.trim();
                        if (!title || !artist) {
                          Alert.alert("Укажи название и исполнителя");
                          return;
                        }
                        cancelLyrics();
                        const controller = new AbortController();
                        lyricsController.current = controller;
                        const generation = ++lyricsGeneration.current;
                        const oldValues = JSON.stringify(formik.values);
                        setLyricsBusy(true);
                        setLyricsOptions([]);
                        setLyricsMessage("Ищу текст…");
                        try {
                          const results = await lookupLyrics(title, artist, controller.signal);
                          if (generation !== lyricsGeneration.current) return;
                          if (oldValues !== JSON.stringify(currentForm.current?.values)) {
                            setLyricsMessage("Поля изменились. Запусти поиск заново.");
                            return;
                          }
                          setLyricsOptions(results);
                          setLyricsMessage(results.length
                            ? "LRCLIB: найден только текст без аккордов. Выбери вариант."
                            : "Совпадений не найдено.");
                        } catch (error) {
                          if (generation === lyricsGeneration.current)
                            setLyricsMessage(error instanceof Error && error.message === "RateLimited"
                              ? "Лимит запросов LRCLIB. Повтори позже."
                              : "Не удалось найти текст.");
                        } finally {
                          if (generation === lyricsGeneration.current) {
                            setLyricsBusy(false);
                            lyricsController.current = null;
                          }
                        }
                      }} />
                    {!!lyricsMessage && <Text style={styles.lyricsMessage}>{lyricsMessage}</Text>}
                    {lyricsOptions.map((option) => (
                      <Action key={option.id} glass
                        label={option.title + " · " + option.artist + " · LRCLIB"}
                        onPress={() => {
                          const apply = () => {
                            void formik.setFieldValue("content", option.content);
                            setLyricsOptions([]);
                          };
                          if (formik.values.content.trim()) {
                            Alert.alert("Заменить текст?", "Существующие аккорды также будут заменены.", [
                              { text: t("Cancel"), style: "cancel" },
                              { text: "Заменить", onPress: apply }
                            ]);
                          } else apply();
                        }} />
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
