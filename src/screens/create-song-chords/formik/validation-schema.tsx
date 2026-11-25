import { songFieldLimits } from "@/@interfaces";
import type { FormValues } from "..";
import * as Yup from "yup";
import extractYoutubeId from "../../../components/utils/extract-youtube-id";

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
          !!extractYoutubeId(value)
      );
  const requiredField = (key: "title" | "content") =>
    field(key, previous?.[key])
      .required(t("FieldRequired"))
      .test("nonblank", t("FieldRequired"), (value) => !!value.trim());
  return Yup.object()
    .shape({
      title: requiredField("title"),
      content: requiredField("content"),
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
