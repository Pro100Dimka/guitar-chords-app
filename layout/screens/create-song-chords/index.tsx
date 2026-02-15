import TextField from "@/components/fields/text-field";
import { Formik, FormikHelpers } from "formik";
import React, { memo, useState } from "react";
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

const CreateChordSong = () => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (
    values: typeof initialValues,
    actions: FormikHelpers<typeof initialValues>
  ) => {
    setIsSubmitting(true);
    await onSubmit(values);
    setIsSubmitting(false);
    actions.setSubmitting(false);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Text style={styles.title}>{t("NewSong")}</Text>

        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema(t)}
          onSubmit={handleSubmit}
        >
          {(formik) => (
            <>
              <TextField
                label={t("SongTitle")}
                placeholder={t("EnterSongTitle")}
                formik={formik}
                name="title"
              />
              <TextField
                label={t("ChordsLyrics")}
                placeholder="Am   F   C   G"
                formik={formik}
                name="content"
                multiline
              />

              <Pressable
                style={[styles.saveButton, isSubmitting && { opacity: 0.6 }]}
                onPress={() => formik.handleSubmit()}
                disabled={isSubmitting}
              >
                <Text style={styles.saveText}>{t("SaveSong")}</Text>
              </Pressable>
            </>
          )}
        </Formik>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 10, paddingBottom: 40 },
  card: {
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
