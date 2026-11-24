import React from "react";
import Renderer, { act } from "react-test-renderer";
import { FlatList, Platform, TextInput } from "react-native";
import Library from "../src/screens/library";
import SearchBar from "../src/screens/library/search";
import { Action } from "../src/screens/song/tools";
import { getAllItems } from "../src/components/database/crud";
import { requestSongDeletion } from "../src/components/library-files";
import {
  defaultSongPreferences,
  usePreferences
} from "../src/components/preferences";

jest.mock("../src/components/library-files", () => ({
  requestSongDeletion: jest.fn()
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
}));

jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("../src/screens/library/library-item", () => () => null);
jest.mock("react-native-vector-icons/Ionicons", () => "Icon");
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));

let screen: Renderer.ReactTestRenderer;
const songs = Array.from({ length: 10 }, (_, id) => ({
  id,
  title: `Song ${id}`
}));

test.each(["Favorites", "RecentSongs"])(
  "large %s collections work with a 999-parameter SQLite limit",
  async (collection) => {
    const previous = usePreferences.getState().songs;
    usePreferences.setState({
      songs: Object.fromEntries(
        Array.from({ length: 1001 }, (_, index) => [
          index + 1,
          { ...defaultSongPreferences, favorite: true, opened: index + 1 }
        ])
      )
    });
    const selected = [{ id: 1001, title: "Selected song" }];
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.mocked(getAllItems).mockImplementation(async (query) => {
      if ((query.parameters?.length ?? 0) > 999)
        throw new Error("too many SQL variables");
      return selected;
    });
    try {
      await act(async () => {
        screen = Renderer.create(<Library />);
      });
      await act(async () => screen.root.findByType(SearchBar).props.onFilter());
      await act(async () =>
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === collection)!
          .props.onPress()
      );
      expect(screen.root.findByType(FlatList).props.data).toEqual(selected);
      expect(
        jest.mocked(getAllItems).mock.calls.at(-1)![0].parameters?.length ?? 0
      ).toBeLessThan(999);
      if (collection === "RecentSongs") {
        const queries = jest
          .mocked(getAllItems)
          .mock.calls.map(([query]) => query)
          .filter((query) => query.ids);
        expect(queries.every((query) => query.ids!.length <= 100)).toBe(true);
        expect(queries.every((query) => query.orderBy === undefined)).toBe(
          true
        );
      }
    } finally {
      usePreferences.setState({ songs: previous });
    }
  }
);

test("iPhone offers microphone and audio-file recognition in the add menu", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  jest.mocked(getAllItems).mockResolvedValue(songs);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () => screen.root.findByType(SearchBar).props.onAdd());
  expect(
    screen.root.findAll(
      (node) => node.props.accessibilityLabel === "AutofillRecognizeMic"
    ).length
  ).toBeGreaterThan(0);
  expect(
    screen.root.findAll(
      (node) => node.props.accessibilityLabel === "AutofillRecognizeFile"
    ).length
  ).toBeGreaterThan(0);
});

test("legacy recent preference aliases retain the first position without duplicate rows", async () => {
  const previous = usePreferences.getState().songs;
  usePreferences.setState({
    songs: {
      1: { ...defaultSongPreferences, opened: 5 },
      "01": { ...defaultSongPreferences, opened: 9 },
      2: { ...defaultSongPreferences, opened: 7 }
    }
  });
  jest
    .mocked(getAllItems)
    .mockImplementation(async (query) =>
      [...new Set(query.ids ?? [])]
        .sort((a, b) => b - a)
        .map((id) => ({ id, title: `Song ${id}` }))
    );
  try {
    await act(async () => {
      screen = Renderer.create(<Library />);
    });
    await act(async () => screen.root.findByType(SearchBar).props.onFilter());
    await act(async () =>
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RecentSongs")!
        .props.onPress()
    );
    expect(
      screen.root
        .findByType(FlatList)
        .props.data.map(({ id }: { id: number }) => id)
    ).toEqual([1, 2]);
  } finally {
    usePreferences.setState({ songs: previous });
  }
});

test("deletion completion refreshes the current search instead of its captured filter", async () => {
  jest.mocked(getAllItems).mockResolvedValue(songs);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  const list = screen.root.findByType(FlatList);
  const row = list.props.renderItem({ item: songs[0] });
  await act(async () => row.props.onLongPress(songs[0]));
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Delete")!
      .props.onPress()
  );
  const deleted = jest.mocked(requestSongDeletion).mock.calls[0][1];
  await act(async () =>
    screen.root.findByType(SearchBar).props.setFilters("match")
  );
  await act(async () => deleted());
  expect(getAllItems).toHaveBeenLastCalledWith(
    expect.objectContaining({ parameters: ["%match%"] })
  );
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.resetAllMocks();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("failed new filter retries page zero without mixing old results", async () => {
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest
    .mocked(getAllItems)
    .mockResolvedValueOnce(songs)
    .mockRejectedValueOnce(new Error("read failed"))
    .mockResolvedValueOnce([{ id: 99, title: "New result" }]);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () =>
    screen.root.findByType(SearchBar).props.setFilters("new-filter")
  );
  expect(screen.root.findAllByType(FlatList)).toHaveLength(0);
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((node) => node.props.label === "Retry")!
      .props.onPress()
  );
  expect(getAllItems).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 0, parameters: ["%new-filter%"] })
  );
  expect(screen.root.findByType(FlatList).props.data).toEqual([
    { id: 99, title: "New result" }
  ]);
});

test("last page stays appended without reloading page zero", async () => {
  jest
    .mocked(getAllItems)
    .mockResolvedValueOnce(songs)
    .mockResolvedValueOnce([{ id: 10, title: "Last" }])
    .mockResolvedValue(songs);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () => screen.root.findByType(FlatList).props.onEndReached());
  expect(getAllItems).toHaveBeenCalledTimes(2);
  expect(screen.root.findByType(FlatList).props.data).toHaveLength(11);
});

test("empty search keeps the search bar and starts only one request", async () => {
  jest.mocked(getAllItems).mockResolvedValueOnce(songs).mockResolvedValue([]);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () =>
    screen.root.findByType(SearchBar).props.setFilters("missing")
  );
  expect(getAllItems).toHaveBeenCalledTimes(2);
  expect(screen.root.findAllByType(SearchBar)).toHaveLength(1);
});

test("live search joins bands and binds apostrophes as data", async () => {
  jest.useFakeTimers();
  jest.mocked(getAllItems).mockResolvedValue([]);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () =>
    screen.root.findByType(TextInput).props.onChangeText("It's")
  );
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(getAllItems).toHaveBeenCalledWith(
    expect.objectContaining({
      joins: ["LEFT JOIN bands b ON s.band_id = b.id"],
      parameters: ["%it's%"]
    })
  );
});

test("repeated end events share one pending page request", async () => {
  let finish!: (rows: typeof songs) => void;
  jest
    .mocked(getAllItems)
    .mockResolvedValueOnce(songs)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () => {
    const loadMore = screen.root.findByType(FlatList).props.onEndReached;
    loadMore();
    loadMore();
  });
  expect(getAllItems).toHaveBeenCalledTimes(2);
  await act(async () => finish([{ id: 10, title: "Last" }]));
  expect(screen.root.findByType(FlatList).props.data).toHaveLength(11);
});

test("old search results cannot replace a newer search", async () => {
  let finishOld!: (rows: typeof songs) => void;
  const newest = [{ id: 20, title: "Newest" }];
  jest
    .mocked(getAllItems)
    .mockResolvedValueOnce(songs)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    )
    .mockResolvedValueOnce(newest);
  await act(async () => {
    screen = Renderer.create(<Library />);
  });
  await act(async () =>
    screen.root.findByType(SearchBar).props.setFilters("old")
  );
  await act(async () =>
    screen.root.findByType(SearchBar).props.setFilters("new")
  );
  await act(async () => finishOld(songs));
  expect(screen.root.findByType(FlatList).props.data).toEqual(newest);
});

test.each(["%", "_", "A_B", "100%", "a!b", "a\\b"])(
  "library search treats %s as literal text on actual SQLite",
  async (value) => {
    jest.mocked(getAllItems).mockResolvedValue([]);
    await act(async () => {
      screen = Renderer.create(<Library />);
    });
    await act(async () =>
      screen.root.findByType(SearchBar).props.setFilters(value)
    );
    const query = jest.mocked(getAllItems).mock.calls.at(-1)![0];
    const titles = ["A_B", "AXB", "100% Love", "100 Days", "a!b", "a\\b"];
    const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE songs(id INTEGER,title TEXT,search_text_lower TEXT,band_id INTEGER);CREATE TABLE bands(id INTEGER,search_text_lower TEXT)');const titles=${JSON.stringify(titles)};titles.forEach((title,id)=>db.prepare('INSERT INTO songs VALUES (?,?,?,NULL)').run(id,title,title.toLowerCase()));const rows=db.prepare('SELECT s.title FROM songs s LEFT JOIN bands b ON s.band_id=b.id WHERE '+${JSON.stringify(query.filters)}).all(...${JSON.stringify(query.parameters)});process.stdout.write(JSON.stringify(rows.map(row=>row.title)));`;
    const results = JSON.parse(
      require("node:child_process").execFileSync(
        require("node:process").execPath,
        ["-e", script],
        { encoding: "utf8", timeout: 4000 }
      )
    );
    expect(results).toEqual(
      titles.filter((title) =>
        title.toLowerCase().includes(value.toLowerCase())
      )
    );
  }
);
