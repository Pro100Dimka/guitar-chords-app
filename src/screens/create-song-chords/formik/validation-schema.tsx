import * as Yup from "yup";

export const validationSchema = (t: typeof import("i18next").t) =>
  Yup.object().shape({
    title: Yup.string()
      .trim()
      .required(t`FieldRequired`),
    content: Yup.string()
      .trim()
      .required(t`FieldRequired`),
    youtube_music: Yup.string()
      .url(t`InvalidUrl`)
      .nullable(),
    youtobe_lesson: Yup.string()
      .url(t`InvalidUrl`)
      .nullable()
  });
