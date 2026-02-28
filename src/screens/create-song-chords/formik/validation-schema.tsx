import * as Yup from "yup";

export const validationSchema = (t: typeof import("i18next").t) =>
  Yup.object().shape({
    title: Yup.string().required(t`FieldRequired`),
    fk_band: Yup.object()
      .shape({
        id: Yup.number().required(t`FieldRequired`),
        name: Yup.string().required(t`FieldRequired`)
      })
      .required(t`FieldRequired`),
    content: Yup.string().required(t`FieldRequired`),
    youtobe_link_music: Yup.string()
      .url(t`InvalidUrl`)
      .nullable(),
    youtobe_link_chords: Yup.string()
      .url(t`InvalidUrl`)
      .nullable()
  });
