import type { FormValues } from "../../screens/create-song-chords";

export function applyRecognitionDraft(
  values: FormValues,
  title: string,
  artist: string
): FormValues {
  return {
    ...values,
    title: title.trim(),
    fk_band: {
      id: "",
      name: artist.trim(),
      search_text_lower: artist.trim().toLocaleLowerCase()
    }
  };
}
