import type { FormValues } from "../../screens/create-song-chords";

export function applyRecognitionDraft(
  values: FormValues,
  title: string,
  artist: string,
  lyrics?: string,
  tempo?: number
): FormValues {
  return {
    ...values,
    ...(typeof tempo === "number" &&
    Number.isFinite(tempo) &&
    tempo >= 40 &&
    tempo <= 200
      ? { tempo: Math.round(tempo) }
      : {}),
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
