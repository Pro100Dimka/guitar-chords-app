import * as Yup from "yup";

export const validationSchema = (t: typeof import("i18next").t) =>
  Yup.object().shape({
    title: Yup.string().required(t`FieldRequired`),
    content: Yup.string().required(t`FieldRequired`)
  });
