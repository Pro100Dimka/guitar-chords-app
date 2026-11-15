import { db } from "../src/components/database";
import { getAllItems } from "../src/components/database/crud";
jest.mock("react-native-vector-icons/Ionicons", () => "Icon");
import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, TouchableOpacity } from "react-native";
import {
  StackRouter,
  StackActions,
  CommonActions
} from "@react-navigation/routers";
import { GuideArticle } from "../src/screens/guide";
import { Action } from "../src/screens/song/tools";
import SongModal from "../src/screens/song/header-modal";
import {
  finishPendingRecordingDeletions,
  requestSongDeletion
} from "../src/components/library-files";
import { deleteItem } from "../src/components/database/crud";
import { performanceAudio } from "../src/components/performance-audio";
import { usePreferences } from "../src/components/preferences";
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn(),
  deleteItem: jest.fn()
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { id: "reading" } })
}));
const mockNavigation = { popTo: jest.fn(), setParams: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const journals = new Map<string, string>();
  let deleted = false;
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({
      executeSql: (sql, args, done) => {
        if (sql.startsWith("INSERT"))
          journals.set(String(args![0]), String(args![1]));
        if (sql === "DELETE FROM songs WHERE id = ?") deleted = true;
        if (sql === "DELETE FROM settings WHERE key = ?")
          journals.delete(String(args![0]));
        done?.(
          { executeSql: jest.fn() },
          { rowsAffected: 1, insertId: 0, rows: { length: 0, item: jest.fn() } }
        );
      }
    });
    success?.();
  });
  jest
    .mocked(getAllItems)
    .mockImplementation(async (query) =>
      query.tableName === "settings"
        ? [...journals].map(([key, value]) => ({ key, value }))
        : deleted
          ? []
          : [{ id: 7 }]
    );
  jest.mocked(performanceAudio.list).mockResolvedValue([]);
  jest.mocked(performanceAudio.remove).mockResolvedValue(true);
  jest.mocked(deleteItem).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());
const pressAlert = async (text: string) => {
  await act(async () => {
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((x) => x.text === text)!.onPress!();
  });
};
test("the song menu confirms deletion and returns to the existing library route", async () => {
  let screen!: Renderer.ReactTestRenderer;
  await act(async () => {
    screen = Renderer.create(<SongModal songId={7} setIsEdit={() => {}} />);
  });
  await act(async () =>
    screen.root
      .find(
        (x) =>
          x.props.accessibilityLabel === "SongTools" &&
          typeof x.props.onPress === "function"
      )
      .props.onPress()
  );
  await act(async () =>
    screen.root.findAllByType(TouchableOpacity)[1].props.onPress()
  );
  expect(deleteItem).not.toHaveBeenCalled();
  await pressAlert("Delete");
  expect(deleteItem).toHaveBeenCalledWith({
    tableName: "songs",
    filters: "id = 7"
  });
  expect(mockNavigation.popTo).toHaveBeenCalledWith("Tabs", {
    screen: "library"
  });
  await act(async () => screen.unmount());
});
test("recordings remain accessible until the owner explicitly deletes both", async () => {
  const takes = [{ path: "song-7-123.m4a", bytes: 100, date: 123 }];
  jest.mocked(performanceAudio.list).mockResolvedValue(takes);
  usePreferences.getState().updateSong(7, { favorite: true });
  const done = jest.fn(),
    open = jest.fn();
  requestSongDeletion(7, done, open);
  await pressAlert("Delete");
  expect(deleteItem).not.toHaveBeenCalled();
  await pressAlert("MyRecordings");
  expect(open).toHaveBeenCalledTimes(1);
  expect(performanceAudio.remove).not.toHaveBeenCalled();
  requestSongDeletion(7, done, open);
  await pressAlert("Delete");
  await pressAlert("DeleteSongAndRecordings");
  expect(performanceAudio.remove).toHaveBeenCalledWith(takes[0].path);
  expect(deleteItem).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalledTimes(1);
  expect(usePreferences.getState().songs[7]).toBeUndefined();
});
test("recording read failures preserve the song and post-commit file failures retain a cleanup journal", async () => {
  jest
    .mocked(performanceAudio.list)
    .mockRejectedValueOnce(new Error("read failed"));
  requestSongDeletion(7, jest.fn(), jest.fn());
  await pressAlert("Delete");
  expect(deleteItem).not.toHaveBeenCalled();
  jest
    .mocked(performanceAudio.list)
    .mockResolvedValue([{ path: "song-7-123.m4a", bytes: 100, date: 123 }]);
  jest.mocked(performanceAudio.remove).mockResolvedValue(false);
  requestSongDeletion(7, jest.fn(), jest.fn());
  await pressAlert("Delete");
  await pressAlert("DeleteSongAndRecordings");
  expect(deleteItem).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith("RecordingCleanupPending");
});
test("repeated root returns do not accumulate Tabs or resurrect deleted Song routes", () => {
  const router = StackRouter({ initialRouteName: "Tabs" });
  const options = {
    routeNames: ["Tabs", "Song", "GuideArticle"],
    routeParamList: {},
    routeGetIdList: {}
  };
  let state = router.getInitialState(options);
  for (let i = 0; i < 3; i++) {
    state = router.getRehydratedState(
      router.getStateForAction(
        state,
        CommonActions.navigate("Song", { id: String(i) }),
        options
      )!,
      options
    );
    state = router.getRehydratedState(
      router.getStateForAction(
        state,
        StackActions.popTo("Tabs", { screen: "library" }),
        options
      )!,
      options
    );
    state = router.getRehydratedState(
      router.getStateForAction(
        state,
        CommonActions.navigate("GuideArticle", { id: "tuner" }),
        options
      )!,
      options
    );
    state = router.getRehydratedState(
      router.getStateForAction(
        state,
        StackActions.popTo("Tabs", { screen: "tuner" }),
        options
      )!,
      options
    );
    expect(state.routes.map((x) => x.name)).toEqual(["Tabs"]);
    expect(
      router.getStateForAction(state, CommonActions.goBack(), options)
    ).toBeNull();
  }
});

test("guide section links return to an existing root navigator", async () => {
  let screen!: Renderer.ReactTestRenderer;
  await act(async () => {
    screen = Renderer.create(<GuideArticle />);
  });
  await act(async () =>
    screen.root
      .findAllByType(Action)
      .find((x) => x.props.label === "GuideOpen.playing")!
      .props.onPress()
  );
  expect(mockNavigation.popTo).toHaveBeenCalledWith("Tabs", {
    screen: "library"
  });
  await act(async () => screen.unmount());
});

test("root return also works when opened without a Tabs route", () => {
  const router = StackRouter({ initialRouteName: "Song" });
  const options = {
    routeNames: ["Tabs", "Song"],
    routeParamList: {},
    routeGetIdList: {}
  };
  const state = router.getInitialState(options);
  const next = router.getStateForAction(
    state,
    StackActions.popTo("Tabs", { screen: "library" }),
    options
  )!;
  expect(next.routes.map((x) => x.name)).toEqual(["Tabs"]);
});

test("a failed database deletion never destroys any recorded take", async () => {
  const takes = [1, 2].map((i) => ({
    path: `song-7-${i}.m4a`,
    bytes: 100,
    date: i
  }));
  jest.mocked(performanceAudio.list).mockResolvedValue(takes);
  jest
    .mocked(db.transaction)
    .mockImplementation((_body, error) =>
      error?.(Object.assign(new Error("disk failure"), { code: 1 }))
    );
  requestSongDeletion(7, jest.fn(), jest.fn());
  await pressAlert("Delete");
  await pressAlert("DeleteSongAndRecordings");
  expect(performanceAudio.remove).not.toHaveBeenCalled();
});

test("post-commit cleanup retries remaining files without deleting the first take twice", async () => {
  const files = new Map(
    [1, 2].map((i) => [
      `/OLD/Documents/performances/song-7-${i}.m4a`,
      {
        path: `/OLD/Documents/performances/song-7-${i}.m4a`,
        bytes: 100,
        date: i
      }
    ])
  );
  let fail = true;
  jest
    .mocked(performanceAudio.list)
    .mockImplementation(async () => [...files.values()]);
  jest.mocked(performanceAudio.remove).mockImplementation(async (path) => {
    if (path.endsWith("-2.m4a") && fail) return false;
    return files.delete(path);
  });
  const done = jest.fn();
  requestSongDeletion(7, done, jest.fn());
  await pressAlert("Delete");
  await pressAlert("DeleteSongAndRecordings");
  expect(done).toHaveBeenCalledTimes(1);
  expect(files.size).toBe(1);
  expect(await getAllItems({ tableName: "settings" })).toEqual(
    expect.arrayContaining([
      {
        key: "recording-delete:7",
        value: JSON.stringify(["song-7-1.m4a", "song-7-2.m4a"])
      }
    ])
  );
  fail = false;
  await finishPendingRecordingDeletions();
  expect(files.size).toBe(0);
  expect(
    jest
      .mocked(performanceAudio.remove)
      .mock.calls.filter(([path]) => path.endsWith("-1.m4a"))
  ).toHaveLength(1);
});

test("an aborted deletion journal never removes recordings of a surviving song", async () => {
  jest.mocked(getAllItems).mockImplementation(async (query) =>
    query.tableName === "settings"
      ? [
          {
            key: "recording-delete:7",
            value: JSON.stringify(["song-7-1.m4a"])
          }
        ]
      : [{ id: 7 }]
  );
  await finishPendingRecordingDeletions();
  expect(performanceAudio.remove).not.toHaveBeenCalled();
});

test("failure to commit the cleanup journal leaves both song and recordings untouched", async () => {
  jest
    .mocked(performanceAudio.list)
    .mockResolvedValue([{ path: "song-7-1.m4a", bytes: 100, date: 1 }]);
  jest
    .mocked(db.transaction)
    .mockImplementation((_body, error) =>
      error?.(Object.assign(new Error("disk full"), { code: 1 }))
    );
  const done = jest.fn();
  requestSongDeletion(7, done, jest.fn());
  await pressAlert("Delete");
  await pressAlert("DeleteSongAndRecordings");
  expect(deleteItem).not.toHaveBeenCalled();
  expect(performanceAudio.remove).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

test("a second deletion waits for its own journal even while startup cleanup is running", async () => {
  const journals = new Map([
    ["recording-delete:1", JSON.stringify(["song-1-1.m4a"])]
  ]);
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  jest
    .mocked(getAllItems)
    .mockImplementation(async (query) =>
      query.tableName === "settings"
        ? [...journals].map(([key, value]) => ({ key, value }))
        : []
    );
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({
      executeSql: (_sql, args) => {
        journals.delete(String(args![0]));
      }
    });
    success?.();
  });
  const removed = new Set<string>();
  jest
    .mocked(performanceAudio.list)
    .mockImplementation(async (id) =>
      removed.has(`song-${id}-1.m4a`)
        ? []
        : [{ path: `song-${id}-1.m4a`, bytes: 100, date: 1 }]
    );
  jest.mocked(performanceAudio.remove).mockImplementation(async (path) => {
    if (path === "song-1-1.m4a")
      await new Promise<void>((resolve) => {
        release = resolve;
        started();
      });
    removed.add(path);
    return true;
  });
  const first = finishPendingRecordingDeletions();
  await firstStarted;
  journals.set("recording-delete:2", JSON.stringify(["song-2-1.m4a"]));
  const second = finishPendingRecordingDeletions();
  release();
  await Promise.all([first, second]);
  expect(performanceAudio.remove).toHaveBeenCalledWith("song-2-1.m4a");
  expect(journals.size).toBe(0);
});
