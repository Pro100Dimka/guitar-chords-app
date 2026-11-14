import type { FormValues } from "../../screens/create-song-chords";

export function applyRecognitionDraft(
  values: FormValues,
  title: string,
  artist: string,
  lyrics?: string
): FormValues {
  return {
    ...values,
    content: values.content.trim()
      ? values.content
      : typeof lyrics === "string" && lyrics.length <= 200000
        ? lyrics.trim()
        : "",
    title: title.trim(),
    fk_band: {
      id: "",
      name: artist.trim(),
      search_text_lower: artist.trim().toLocaleLowerCase()
    }
  };
}
