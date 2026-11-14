import { applyRecognitionDraft } from "../src/components/song-autofill/draft";
import type { FormValues } from "../src/screens/create-song-chords";

describe("song recognition draft", () => {
  const existing: FormValues = {
    id: 91,
    title: "Original",
    content: "[Am]Existing manual lyrics",
    cover: "base64cover",
    youtube_music: "https://youtu.be/abc",
    youtobe_lesson: "",
    fk_band: {
      id: "15",
      name: "Previous Artist",
      search_text_lower: "previous artist"
    }
  };
  it("preserves song identity, content, cover and links but resets old band id", () => {
    const next = applyRecognitionDraft(existing, " New Title ", " New Artist ");
    expect(next).toMatchObject({
      id: 91,
      title: "New Title",
      content: existing.content,
      cover: existing.cover,
      youtube_music: existing.youtube_music,
      fk_band: {
        id: "",
        name: "New Artist",
        search_text_lower: "new artist"
      }
    });
    expect(existing.fk_band.id).toBe("15");
  });
  it("uses lyrics from recognition when the draft is empty", () => {
    const next = applyRecognitionDraft(
      { ...existing, content: "" },
      "Track",
      "Artist",
      "Original example lyrics"
    );
    expect(next.content).toBe("Original example lyrics");
  });
  it("keeps manual content when recognition also provides lyrics", () => {
    expect(
      applyRecognitionDraft(existing, "Track", "Artist", "Other text").content
    ).toBe(existing.content);
  });
  it("does not accept an oversized recognition lyric", () => {
    expect(
      applyRecognitionDraft(
        { ...existing, content: "" },
        "Track",
        "Artist",
        "x".repeat(200001)
      ).content
    ).toBe("");
  });
});
