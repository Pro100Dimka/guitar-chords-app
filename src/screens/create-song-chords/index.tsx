import {
  chordsAboveLyrics,
  transposeSong,
  songContentFromEditor
} from "../song/chords";
// src/screens/create-song-chords/index.tsx
import {
  useFocusEffect,
  useRoute,
  RouteProp,
  usePreventRemove,
  NavigationAction
} from "@react-navigation/native";
import { Formik, FormikHelpers, useFormikContext } from "formik";
import React, { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ActivityIndicator,
  Image,
  Keyboard,
  Linking,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets
} from "react-native-safe-area-context";
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
import { usePreferences, SongPreferences } from "../../components/preferences";

import { Action } from "../song/tools";
import { fileCanceled, readSongCover } from "../../components/library-files";

// интерфейс для формы
export interface FormValues {
  id: number;
  title: string;
  cover: string;
  capo?: number;
  tempo?: number;
  sourceTuning?: string;
  contentSource?: SongPreferences["contentSource"];
  content: string;
  youtube_music: string;
  youtobe_lesson: string;
  fk_band: { id: string; name: string; search_text_lower: string };
}
interface ICreateChordSongProps {
  song?: ISong;
  setIsEdit?: (_: boolean) => void;
  exitAllowed?: { current: boolean };
}

export function SongEditorGuard({
  allowLeave,
  pendingExit,
  busy = false
}: {
  allowLeave: { current: boolean };
  pendingExit: { current: NavigationAction | null };
  busy?: boolean;
}) {
  const formik = useFormikContext<FormValues>();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const changed =
    formik.dirty ||
    (!formik.values.id &&
      [
        formik.values.title,
        formik.values.content,
        formik.values.cover,
        formik.values.fk_band.name
      ].some((value) => !!value.trim()));
  usePreventRemove(
    (changed || busy) && !allowLeave.current,
    ({ data: { action } }) => {
      if (allowLeave.current) {
        navigation.dispatch(action);
        return;
      }
      if (formik.isSubmitting || busy) return;
      Alert.alert(t("UnsavedSong"), undefined, [
        { text: t("StayInEditor"), style: "cancel" },
        {
          text: t("DiscardChanges"),
          style: "destructive",
          onPress: () => {
            pendingExit.current = null;
            allowLeave.current = true;
            navigation.dispatch(action);
          }
        },
        {
          text: t("SaveSong"),
          onPress: () => {
            pendingExit.current = action;
            const clear = () => {
              if (pendingExit.current === action) pendingExit.current = null;
            };
            void formik.submitForm().then(clear, clear);
          }
        }
      ]);
    }
  );
  return null;
}

const CreateChordSong: React.FC<ICreateChordSongProps> = memo(
  ({ song, setIsEdit, exitAllowed }: ICreateChordSongProps) => {
    const route = useRoute<RouteProp<RootStackParamList, "createSong">>();
    const example = !song && route.params?.example;
    const { t } = useTranslation();
    const [extras, setExtras] = useState(false);
    const [coverBusy, setCoverBusy] = useState(false);
    const coverPending = useRef(false);
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const form = useRef<View>(null);
    const lyricsInput = useRef<TextInput>(null);
    const [editingLyrics, setEditingLyrics] = useState(false);
    const [lyricsDraft, setLyricsDraft] = useState("");
    const [formTop, setFormTop] = useState(0);
    const navigation = useNavigation<NavigationProp>();
    const localExitAllowed = useRef(false);
    const allowLeave = exitAllowed ?? localExitAllowed;
    const pendingExit = useRef<NavigationAction | null>(null);
    const [initialValuesState, setInitialValuesState] =
      useState<FormValues>(initialValues);
    useFocusEffect(
      useCallback(() => {
        if (song && song.id) {
          const { band_name, band_id, ...songProps } = song;
          setInitialValuesState({
            ...initialValues,
            ...songProps,
            content: transposeSong(songProps.content ?? "", 0),
            youtube_music: songProps.youtube_music ?? "",
            youtobe_lesson: songProps.youtobe_lesson ?? "",
            tempo: usePreferences.getState().songs[song.id]?.tempo,
            sourceTuning:
              usePreferences.getState().songs[song.id]?.sourceTuning,
            cover: usePreferences.getState().songs[song.id]?.cover ?? "",
            contentSource:
              usePreferences.getState().songs[song.id]?.contentSource,
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
                  content: transposeSong(t("ExampleLyrics"), 0)
                }
              : {
                  ...initialValues,
                  ...route.params?.draft,
                  content: transposeSong(route.params?.draft?.content ?? "", 0)
                }
          );
        }
      }, [song, example, route.params?.draft, t])
    );
    const handleSubmit = async (
      values: FormValues,
      actions: FormikHelpers<FormValues>
    ) => {
      if (coverPending.current) {
        actions.setSubmitting(false);
        return;
      }
      const finish = (fallback: () => void) => {
        allowLeave.current = true;
        const action = pendingExit.current;
        pendingExit.current = null;
        if (action) navigation.dispatch(action);
        else fallback();
      };
      try {
        await onSubmit(
          actions,
          { ...values, content: transposeSong(values.content, 0) },
          { replace: (...args) => finish(() => navigation.replace(...args)) },
          () => finish(() => setIsEdit?.(false))
        );
      } finally {
        actions.setSubmitting(false);
      }
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
            initialValues={initialValuesState}
            enableReinitialize
            validationSchema={validationSchema(t)}
            onSubmit={handleSubmit}
          >
            {(formik) => (
              <View style={styles.flex}>
                <SongEditorGuard
                  allowLeave={allowLeave}
                  pendingExit={pendingExit}
                  busy={coverBusy}
                />
                <ScrollView
                  style={styles.flex}
                  contentContainerStyle={styles.container}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.identity}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("ChangeSongCover")}
                      accessibilityState={{
                        disabled: coverBusy || formik.isSubmitting,
                        busy: coverBusy
                      }}
                      disabled={coverBusy || formik.isSubmitting}
                      style={[styles.cover, width < 360 && styles.coverNarrow]}
                      onPress={() => {
                        const changeCover = async (rotate = false) => {
                          coverPending.current = true;
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
                            coverPending.current = false;
                            setCoverBusy(false);
                          }
                        };
                        if (!formik.values.cover) {
                          void changeCover();
                          return;
                        }
                        Alert.alert(
                          t("ChangeSongCover"),
                          undefined,
                          [
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
                            ...(Platform.OS === "ios"
                              ? [
                                  {
                                    text: t("Cancel"),
                                    style: "cancel" as const
                                  }
                                ]
                              : [])
                          ],
                          { cancelable: true }
                        );
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
                        formik={formik}
                        name="fk_band.name"
                        editable={!formik.isSubmitting}
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
                  {!song && route.params?.notice && (
                    <Text style={styles.importNotice}>
                      {t(route.params.notice)}
                    </Text>
                  )}
                  {!!formik.values.sourceTuning && (
                    <Text style={styles.importNotice}>
                      {t("Tuning")}: {formik.values.sourceTuning}
                    </Text>
                  )}
                  <View style={styles.lyricsHeading}>
                    <Text style={styles.lyricsLabel}>{t("ChordsLyrics")}</Text>
                    {formik.values.contentSource && (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={t("SongContentSource")}
                        style={styles.sourceButton}
                        onPress={() => {
                          const url = formik.values.contentSource?.url;
                          if (url)
                            void Linking.openURL(url).catch(() =>
                              Alert.alert(t("Error"))
                            );
                        }}
                      >
                        <MaterialCommunityIcons
                          name="link-variant"
                          size={20}
                          color={palette.glass.muted}
                        />
                      </Pressable>
                    )}
                    <Action
                      compact
                      icon="arrow-expand"
                      label={t("EditLyrics")}
                      onPress={() => {
                        Keyboard.dismiss();
                        setLyricsDraft(
                          chordsAboveLyrics(formik.values.content)
                        );
                        setEditingLyrics(true);
                      }}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("EditLyrics")}
                    onPress={() => {
                      Keyboard.dismiss();
                      setLyricsDraft(chordsAboveLyrics(formik.values.content));
                      setEditingLyrics(true);
                    }}
                    style={styles.lyricsPreview}
                  >
                    <Text
                      numberOfLines={6}
                      style={[
                        styles.lyricsText,
                        !formik.values.content && styles.lyricsPlaceholder
                      ]}
                    >
                      {chordsAboveLyrics(formik.values.content) ||
                        t("PasteSongHint")}
                    </Text>
                  </Pressable>
                  {!!formik.touched.content && !!formik.errors.content && (
                    <Text style={styles.fieldError}>
                      {formik.errors.content}
                    </Text>
                  )}
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
                    disabled={formik.isSubmitting || coverBusy}
                  />
                </View>
                {editingLyrics && (
                  <Modal
                    statusBarTranslucent
                    navigationBarTranslucent
                    supportedOrientations={["portrait", "landscape"]}
                    animationType="slide"
                    onRequestClose={() => setEditingLyrics(false)}
                    onShow={() => {
                      setTimeout(() => {
                        lyricsInput.current?.focus();
                        lyricsInput.current?.setNativeProps({
                          selection: { start: 0, end: 0 }
                        });
                      }, 100);
                    }}
                  >
                    <SafeAreaView style={styles.editor}>
                      <KeyboardAvoidingView
                        style={styles.flex}
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                      >
                        <View
                          style={[
                            styles.editorHeader,
                            width > height && styles.editorHeaderCompact
                          ]}
                        >
                          <Text style={styles.editorTitle}>
                            {t("ChordsLyrics")}
                          </Text>
                          <Action
                            compact
                            icon="arrow-collapse"
                            label={t("CollapseEditor")}
                            onPress={() => {
                              Keyboard.dismiss();
                              setEditingLyrics(false);
                            }}
                          />
                        </View>
                        <TextInput
                          ref={lyricsInput}
                          multiline
                          disableFullscreenUI
                          accessibilityLabel={t("ChordsLyrics")}
                          value={lyricsDraft}
                          editable={!formik.isSubmitting}
                          onChangeText={(text) => {
                            if (!formik.isSubmitting) {
                              setLyricsDraft(text);
                              void formik.setFieldValue(
                                "content",
                                songContentFromEditor(
                                  formik.values.content,
                                  text
                                )
                              );
                            }
                          }}
                          onBlur={() => formik.setFieldTouched("content")}
                          placeholder={t("PasteSongHint")}
                          placeholderTextColor={palette.glass.muted}
                          selectionColor={palette.glass.accent}
                          autoCorrect={false}
                          autoCapitalize="none"
                          keyboardAppearance="dark"
                          textAlignVertical="top"
                          style={[
                            styles.lyricsText,
                            styles.editorInput,
                            width > height && styles.editorInputCompact
                          ]}
                        />
                      </KeyboardAvoidingView>
                    </SafeAreaView>
                  </Modal>
                )}
              </View>
            )}
          </Formik>
        </KeyboardAvoidingView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  editor: { flex: 1, backgroundColor: palette.glass.control },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  editorTitle: {
    flex: 1,
    color: palette.glass.ink,
    fontSize: 18,
    fontWeight: "600"
  },
  editorHeaderCompact: { paddingVertical: 4 },
  editorInputCompact: { paddingVertical: 4 },
  editorInput: { flex: 1, minHeight: 0, padding: 20, color: palette.glass.ink },
  lyricsHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8
  },
  lyricsLabel: { flex: 1, color: palette.glass.muted, fontSize: 14 },
  lyricsPreview: {
    minHeight: 180,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    backgroundColor: palette.glass.surface
  },
  lyricsText: {
    color: palette.glass.ink,
    fontSize: 16,
    lineHeight: 26,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace"
  },
  lyricsPlaceholder: { color: palette.glass.muted },
  fieldError: { color: palette.error.main, marginTop: 8, fontSize: 13 },
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
  sourceButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  importNotice: {
    color: palette.glass.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16
  },
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
