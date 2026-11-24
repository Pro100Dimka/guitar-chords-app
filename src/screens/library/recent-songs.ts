import { ISong } from "../../@interfaces";
import { getAllItems } from "../../components/database/crud";

export const libraryQuery = (search: string) => ({
  tableName: "songs s",
  joins: ["LEFT JOIN bands b ON s.band_id = b.id"],
  filters: search
    ? "LOWER(COALESCE(b.search_text_lower, '') || ' ' || s.search_text_lower) LIKE ? ESCAPE '!' COLLATE NOCASE"
    : "",
  parameters: search
    ? [`%${search.toLowerCase().replace(/[!%_]/g, "!$&")}%`]
    : [],
  fields: "b.search_text_lower band, s.title, b.name as band_name, s.id"
});

export interface RecentSongsCursor {
  offset: number;
  buffered: ISong[];
}

// The preference store already orders recent IDs. Read a bounded slice using
// the primary key instead of evaluating a library-sized CASE for every row.
// Retain extra matches so later pages never scan the same IDs again.
export async function recentSongPage(
  ids: readonly number[],
  search: string,
  cursor: RecentSongsCursor,
  limit: number,
  current: () => boolean
) {
  let offset = cursor.offset;
  const songs = cursor.buffered.slice(0, limit);
  const buffered = cursor.buffered.slice(limit);
  const query = libraryQuery(search);
  while (songs.length < limit && offset < ids.length) {
    if (!current()) return null;
    const candidates = ids.slice(offset, offset + 100);
    const rows = await getAllItems<ISong>({
      ...query,
      ids: candidates
    });
    if (!current()) return null;
    const found = new Map(rows.map((song) => [song.id, song]));
    for (const id of candidates) {
      const song = found.get(id);
      if (song) (songs.length < limit ? songs : buffered).push(song);
    }
    offset += candidates.length;
  }
  // Publish the cursor only with a complete page. A failed query can be
  // retried without dropping buffered rows or skipping partially read IDs.
  return { songs, cursor: { offset, buffered } };
}
