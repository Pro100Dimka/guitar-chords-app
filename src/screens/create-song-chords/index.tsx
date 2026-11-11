// src/screens/create-song-chords/index.tsx
import { useFocusEffect, useRoute, RouteProp } from "@react-navigation/native";
import { Formik, FormikHelpers } from "formik";
import React, { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Text from "../../components/styled-text";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import SearchableSelect from "../../components/fields/api-select";
import TextField from "../../components/fields/text-field";
import initialValues from "./formik/initial-values";
import onSubmit from "./formik/on-sabmit";
import { validationSchema } from "./formik/validation-schema";
import { useNavigation } from "@react-navigation/native";
import { NavigationProp, RootStackParamList } from "@/router";
import palette from "@/theme/palette";
import { ISong } from "@/@interfaces";

import { Action } from "../song/tools";
import {
  fileCanceled,
  importedSong,
  readLibraryFile
} from "../../components/library-files";

// интерфейс для формы
export interface FormValues {
  id: number;
  title: string;
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
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Formik
            initialValues={initialValuesState}
            enableReinitialize
            validationSchema={validationSchema(t)}
            onSubmit={handleSubmit}
          >
            {(formik) => (
              <View style={styles.flex}>
                <Text style={styles.titleLabel}>{t("QuickSongHint")}</Text>
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
                          Alert.alert(t("ImportReview"), t("ImportReviewHint"));
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
                        Alert.alert(t("ReplaceDraft"), t("ReplaceDraftHint"), [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("ImportSong"),
                            onPress: () => void importFile()
                          }
                        ]);
                      else await importFile();
                    }}
                  />
                </View>
                <TextField
                  placeholder={t("SongTitle")}
                  formik={formik}
                  name="title"
                />
                <TextField
                  label={t("ChordsLyrics")}
                  placeholder={t("PasteSongHint")}
                  formik={formik}
                  name="content"
                  style={{
                    input: { minHeight: 220, textAlignVertical: "top" }
                  }}
                  multiline
                />
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
                      <SearchableSelect
                        hasCreateBtn
                        labelKey="name"
                        valueKey="id"
                        placeholder={t("Band")}
                        tableName="bands"
                        name="fk_band"
                        formik={formik}
                      />
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
                <View style={styles.saveButton}>
                  <Action
                    primary
                    label={t("SaveSong")}
                    onPress={() => formik.handleSubmit()}
                    disabled={isSubmitting || importing}
                  />
                </View>
              </View>
            )}
          </Formik>
        </View>
      </ScrollView>
    );
  }
);

const styles = StyleSheet.create({
  importButton: { marginBottom: 16 },
  details: {
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
    paddingBottom: 40,
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
  },
  card: {
    flex: 1,
    backgroundColor: palette.colors.transparent,
    borderRadius: 20,
    padding: 0,
    borderWidth: 0
  },
  titleLabel: {
    color: palette.glass.muted,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 16
  },
  saveButton: { marginTop: 20 }
});
export default CreateChordSong;
