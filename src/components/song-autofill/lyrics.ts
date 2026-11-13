/**
 * FreeTune lyrics-only fallback. This does not identify audio or supply chords.
 * Never combine its text with a different arrangement's chord annotations.
 */
export interface LyricsOption {
  id: number;
  title: string;
  artist: string;
  content: string;
  source: "LRCLIB";
}
const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const matchingIdentity = (expected: string, actual: string) =>
  !!normalize(expected) && normalize(expected) === normalize(actual);

const client = "FreeTune/0.0.1 (https://github.com/Pro100Dimka/guitar-chords-app)";
type LrcResult = {
  id?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  plainLyrics?: unknown;
  syncedLyrics?: unknown;
  instrumental?: unknown;
};
export async function lookupLyrics(
  title: string,
  artist: string,
  signal?: AbortSignal
): Promise<LyricsOption[]> {
  if (!title.trim() || !artist.trim()) throw new Error("MissingIdentity");
  const params = new URLSearchParams({
    track_name: title.trim(),
    artist_name: artist.trim()
  });
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  try {
    const response = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { "Lrclib-Client": client, Accept: "application/json" },
      signal: timeout.signal
    });
    if (response.status === 429) throw new Error("RateLimited");
    if (!response.ok) throw new Error("LyricsServiceUnavailable");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("InvalidLyricsResponse");
    return payload.slice(0, 20).flatMap((item: LrcResult) => {
      if (
        !item || item.instrumental ||
        typeof item.id !== "number" ||
        typeof item.trackName !== "string" ||
        typeof item.artistName !== "string" ||
        !matchingIdentity(title, item.trackName) ||
        !matchingIdentity(artist, item.artistName)
      ) return [];
      const content =
        typeof item.plainLyrics === "string" && item.plainLyrics.trim()
          ? item.plainLyrics
          : typeof item.syncedLyrics === "string"
            ? item.syncedLyrics.replace(/^\[[0-9:.]+\\]\s*/gm, "")
            : "";
      if (!content.trim() || content.length > 200000) return [];
      return [{
        id: item.id,
        title: item.trackName,
        artist: item.artistName,
        content: content.replace(/\r\n?/g, "\n").trim(),
        source: "LRCLIB" as const
      }];
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
