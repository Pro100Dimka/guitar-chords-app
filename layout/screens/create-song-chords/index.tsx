import SearchableSelect from "@/components/fields/api-select";
import TextField from "@/components/fields/text-field";
import { ISong } from "@/database";
import { Formik, FormikHelpers } from "formik";
import React, { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import initialValues from "./formik/initial-values";
import onSubmit from "./formik/on-sabmit";
import { validationSchema } from "./formik/validation-schema";

const COLORS = {
  card: "rgba(20,20,20,0.55)",
  border: "rgba(255,255,255,0.15)",
  text: "#fff",
  accent: "#FF6600"
};

// интерфейс для формы
interface FormValues {
  id: number;
  title: string;
  content: string;
  youtobe_link_music: string;
  youtobe_link_chords: string;
  fk_band: { id: string; name: string };
}

const CreateChordSong: React.FC<{
  song?: ISong;
  setIsEdit: (_: boolean) => void;
}> = ({ song, setIsEdit }) => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [initialValuesState, setInitialValuesState] =
    useState<FormValues>(initialValues);
  useEffect(() => {
    if (song && song.id) {
      const { band_name, band_id, ...songProps } = song;
      setInitialValuesState({
        ...initialValues,
        ...songProps,
        fk_band: { name: band_name ?? "", id: band_id?.toString() ?? "" }
      });
    } else {
      setInitialValuesState(initialValues);
    }
  }, [song]);

  const handleSubmit = async (
    values: FormValues,
    actions: FormikHelpers<FormValues>
  ) => {
    setIsSubmitting(true);
    await onSubmit(values, setIsEdit);
    setIsSubmitting(false);
    actions.setSubmitting(false);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Text style={styles.title}>{t("NewSong")}</Text>
        <Formik
          initialValues={initialValuesState}
          enableReinitialize
          validationSchema={validationSchema(t)}
          onSubmit={handleSubmit}
        >
          {(formik) => (
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#aaa", marginBottom: 10 }}>
                {t("EnterSongTitle")}
              </Text>
              <View style={styles.row}>
                <SearchableSelect
                  hasCreateBtn
                  labelKey="name"
                  valueKey="id"
                  placeholder={t("Band")}
                  tableName="bands"
                  name="fk_band"
                  formik={formik}
                  style={{ container: { flex: 0.6 } }}
                />
                <Text style={{ color: "#aaa", marginTop: 10 }}>-</Text>
                <TextField
                  placeholder={t("SongTitle")}
                  formik={formik}
                  style={{ container: { flex: 1 } }}
                  name="title"
                />
              </View>
              <View style={styles.row}>
                <TextField
                  placeholder={`${t("SongLink")} (YouTube)`}
                  formik={formik}
                  style={{ container: { flex: 1 } }}
                  name="youtobe_link_music"
                />
                <TextField
                  placeholder={`${t("TrainingLink")} (YouTube)`}
                  formik={formik}
                  style={{ container: { flex: 1 } }}
                  name="youtobe_link_chords"
                />
              </View>
              <TextField
                label={t("ChordsLyrics")}
                placeholder="Am   F   C   G"
                formik={formik}
                name="content"
                style={{
                  container: { flex: 1 },
                  input: { flex: 1 }
                }}
                multiline
              />
              <Pressable
                style={[styles.saveButton, isSubmitting && { opacity: 0.6 }]}
                onPress={() => formik.handleSubmit()}
                disabled={isSubmitting}
              >
                <Text style={styles.saveText}>{t("SaveSong")}</Text>
              </Pressable>
            </View>
          )}
        </Formik>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 5,
    alignItems: "flex-start"
  },
  container: { padding: 10, paddingBottom: 40, flexGrow: 1 },
  card: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 20
  },
  saveButton: {
    marginTop: 20,
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center"
  },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 16 }
});

export default memo(CreateChordSong);
