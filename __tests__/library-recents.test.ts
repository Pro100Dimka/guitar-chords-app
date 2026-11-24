import type { ISong } from "../src/@interfaces";
import { getAllItems } from "../src/components/database/crud";
import {
  recentSongPage,
  type RecentSongsCursor
} from "../src/screens/library/recent-songs";

jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));

const song = (id: number) => ({ id, title: `Song ${id}` }) as ISong;
const current = () => true;
afterEach(() => jest.resetAllMocks());

test("ten thousand recent songs use bounded primary-key reads and retain recent order", async () => {
  const ids = Array.from({ length: 10000 }, (_, index) => 10000 - index);
  jest
    .mocked(getAllItems)
    .mockImplementation(async (query) =>
      [...(query.ids ?? [])].reverse().map(song)
    );
  const first = await recentSongPage(
    ids,
    "",
    { offset: 0, buffered: [] },
    10,
    current
  );
  expect(first?.songs.map(({ id }) => id)).toEqual(ids.slice(0, 10));
  const second = await recentSongPage(ids, "", first!.cursor, 10, current);
  expect(second?.songs.map(({ id }) => id)).toEqual(ids.slice(10, 20));
  expect(getAllItems).toHaveBeenCalledTimes(1);
  const query = jest.mocked(getAllItems).mock.calls[0][0];
  expect(query.ids).toHaveLength(100);
  expect(query.orderBy).toBeUndefined();
  expect(query.page).toBeUndefined();
});

test("filtered recent pages scan each candidate once and skip deleted songs without gaps", async () => {
  const ids = Array.from({ length: 503 }, (_, index) => 503 - index);
  const wanted = ids.filter((id) => id % 7 === 0 && id !== 294);
  jest.mocked(getAllItems).mockImplementation(async (query) =>
    [...(query.ids ?? [])]
      .filter((id) => wanted.includes(id))
      .reverse()
      .map(song)
  );
  let cursor: RecentSongsCursor = { offset: 0, buffered: [] };
  const results: ISong[] = [];
  for (;;) {
    const page = await recentSongPage(ids, "100%_!", cursor, 10, current);
    results.push(...page!.songs);
    cursor = page!.cursor;
    if (page!.songs.length < 10) break;
  }
  expect(results.map(({ id }) => id)).toEqual(wanted);
  const queries = jest.mocked(getAllItems).mock.calls.map(([query]) => query);
  expect(queries).toHaveLength(6);
  expect(queries.flatMap((query) => query.ids ?? [])).toEqual(ids);
  expect(queries.every((query) => (query.ids?.length ?? 0) <= 100)).toBe(true);
  expect(
    queries.every((query) => query.parameters?.[0] === "%100!%!_!!%")
  ).toBe(true);
});

test("a failed later query leaves the cursor and buffered rows intact for retry", async () => {
  const ids = Array.from({ length: 201 }, (_, index) => index + 1);
  const cursor: RecentSongsCursor = { offset: 0, buffered: [song(400)] };
  jest
    .mocked(getAllItems)
    .mockResolvedValueOnce([song(1), song(2)])
    .mockRejectedValueOnce(new Error("read failed"));
  await expect(
    recentSongPage(ids, "match", cursor, 10, current)
  ).rejects.toThrow("read failed");
  expect(cursor).toEqual({ offset: 0, buffered: [song(400)] });
  jest
    .mocked(getAllItems)
    .mockResolvedValueOnce([song(1), song(2)])
    .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => song(i + 101)));
  const retry = await recentSongPage(ids, "match", cursor, 10, current);
  expect(retry?.songs.map(({ id }) => id)).toEqual([
    400, 1, 2, 101, 102, 103, 104, 105, 106, 107
  ]);
  expect(retry?.cursor.buffered.map(({ id }) => id)).toEqual([108, 109, 110]);
});

test("superseded search stops after the in-flight read without scanning the remaining library", async () => {
  const ids = Array.from({ length: 10000 }, (_, index) => index + 1);
  let finish!: (rows: ISong[]) => void;
  let active = true;
  jest.mocked(getAllItems).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const cursor: RecentSongsCursor = { offset: 0, buffered: [] };
  const reading = recentSongPage(ids, "old", cursor, 10, () => active);
  active = false;
  finish([song(1)]);
  await expect(reading).resolves.toBeNull();
  expect(getAllItems).toHaveBeenCalledTimes(1);
  expect(cursor).toEqual({ offset: 0, buffered: [] });
});

test("empty recent collections finish without touching SQLite", async () => {
  await expect(
    recentSongPage([], "", { offset: 0, buffered: [] }, 10, current)
  ).resolves.toEqual({ songs: [], cursor: { offset: 0, buffered: [] } });
  expect(getAllItems).not.toHaveBeenCalled();
});
