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
import { requestSongDeletion } from "../src/components/library-files";
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
  expect(deleteItem).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledTimes(1);
  expect(usePreferences.getState().songs[7]).toBeUndefined();
});
test("recording read or deletion failures preserve the song", async () => {
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
