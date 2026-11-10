import React from "react";
import Renderer, { act } from "react-test-renderer";
import { FlatList, TextInput } from "react-native";
import Library from "../src/screens/library";
import SearchBar from "../src/screens/library/search";
import { getAllItems } from "../src/components/database/crud";

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
  expect(screen.root.findByType(FlatList).props.data).toEqual([]);
  await act(async () => screen.root.findByType(FlatList).props.onEndReached());
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

test("suggestions join bands and bind apostrophes as data", async () => {
  jest.useFakeTimers();
  jest.mocked(getAllItems).mockResolvedValue([]);
  await act(async () => {
    screen = Renderer.create(<SearchBar setFilters={jest.fn()} />);
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
