import { songFieldLimits } from "@/@interfaces";
import * as Yup from "yup";

export const validationSchema = (t: typeof import("i18next").t) =>
  Yup.object().shape({
    title: Yup.string()
      .max(songFieldLimits.title, t("FileTooLarge"))
      .trim()
      .required(t`FieldRequired`),
    content: Yup.string()
      .max(songFieldLimits.content, t("FileTooLarge"))
      .trim()
      .required(t`FieldRequired`),
    fk_band: Yup.object({
      name: Yup.string().max(songFieldLimits.band_name, t("FileTooLarge"))
    }),
    youtube_music: Yup.string()
      .max(songFieldLimits.youtube_music, t("FileTooLarge"))
      .url(t`InvalidUrl`)
      .nullable(),
    youtobe_lesson: Yup.string()
      .max(songFieldLimits.youtobe_lesson, t("FileTooLarge"))
      .url(t`InvalidUrl`)
      .nullable()
  });
