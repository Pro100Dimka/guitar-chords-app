import { songFieldLimits } from "@/@interfaces";
import type { FormValues } from "..";
import * as Yup from "yup";

export const validationSchema = (
  t: typeof import("i18next").t,
  original?: FormValues
) => {
  const previous = original?.id ? original : undefined;
  const field = (key: keyof typeof songFieldLimits, oldValue?: string) =>
    Yup.string().test(
      "max",
      t("FileTooLarge"),
      (value, context) =>
        !value ||
        value.length <= songFieldLimits[key] ||
        (!!previous &&
          context.originalValue === oldValue &&
          value.length <= 400000)
    );
  const url = (key: "youtube_music" | "youtobe_lesson") =>
    field(key, previous?.[key] ?? "")
      .nullable()
      .test(
        "url",
        t("InvalidUrl"),
        (value) =>
          !value ||
          (!!previous && value === previous[key]) ||
          Yup.string().url().isValidSync(value)
      );
  return Yup.object()
    .shape({
      title: field("title", previous?.title)
        .trim()
        .required(t("FieldRequired")),
      content: field("content", previous?.content)
        .trim()
        .required(t("FieldRequired")),
      fk_band: Yup.object({ name: field("band_name", previous?.fk_band.name) }),
      youtube_music: url("youtube_music"),
      youtobe_lesson: url("youtobe_lesson")
    })
    .test("compatibility-budget", t("FileTooLarge"), (value, context) => {
      const fields = { ...value, band_name: value.fk_band?.name };
      const size = Object.keys(songFieldLimits).reduce(
        (total, key) =>
          total + (fields[key as keyof typeof songFieldLimits]?.length ?? 0),
        0
      );
      return (
        size <= 400000 ||
        context.createError({ path: "title", message: t("FileTooLarge") })
      );
    });
};
