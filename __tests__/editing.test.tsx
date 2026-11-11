import React from "react";
import Renderer, { act } from "react-test-renderer";
import { TextInput, TouchableOpacity, FlatList, Text } from "react-native";
import Select from "../src/components/fields/api-select";
import Song from "../src/screens/song";
import Editor from "../src/screens/create-song-chords";
import Menu from "../src/screens/song/header-modal";
import * as crud from "../src/components/database/crud";
jest.mock("../src/screens/tuner", () => () => null);
jest.mock("../src/screens/tuner/MicrophoneStream", () => ({
  setKeepAwake: jest.fn()
}));
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn()
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
  useRoute: () => ({ params: { id: "1" } }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback])
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("../src/screens/create-song-chords", () => () => null);
jest.mock("../src/screens/song/header-modal", () => () => null);
jest.mock("../src/screens/song/video-tabs", () => () => null);
jest.mock(
  "../src/components/header",
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children
);
let screen: Renderer.ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.resetAllMocks();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function openSelect(onSelect: jest.Mock) {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  await act(async () => {
    screen = Renderer.create(
      React.createElement(Select, {
        tableName: "bands",
        labelKey: "name",
        valueKey: "id",
        hasCreateBtn: true,
        value: { id: "", name: "", search_text_lower: "" },
        onSelect
      })
    );
  });
  await act(async () =>
    screen!.root.findAllByType(TouchableOpacity)[0].props.onPress()
  );
}
test("creating a performer selects the persisted record", async () => {
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { id: 7, name: "Audit band", search_text_lower: "audit band" }
    ]);
  jest.mocked(crud.createItem).mockResolvedValue({
    insertId: 7,
    rowsAffected: 1,
    rows: { length: 0, item: jest.fn() }
  });
  const selected = jest.fn();
  await openSelect(selected);
  await act(async () =>
    screen!.root.findByType(TextInput).props.onChangeText("Audit band")
  );
  await act(async () => jest.advanceTimersByTime(400));
  const create = screen!.root
    .findAllByType(TouchableOpacity)
    .find((button) => button.props.onPress.name === "handleCreate");
  expect(create).toBeDefined();
  await act(async () => create!.props.onPress());
  expect(selected).toHaveBeenCalledWith({
    id: 7,
    name: "Audit band",
    search_text_lower: "audit band"
  });
});
test("performer suggestions ignore obsolete responses", async () => {
  let finishOld!: (rows: { id: number; name: string }[]) => void;
  jest
    .mocked(crud.getAllItems)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    )
    .mockResolvedValueOnce([{ id: 2, name: "New" }]);
  await openSelect(jest.fn());
  await act(async () =>
    screen!.root.findByType(TextInput).props.onChangeText("Old")
  );
  await act(async () => jest.advanceTimersByTime(400));
  await act(async () =>
    screen!.root.findByType(TextInput).props.onChangeText("New")
  );
  await act(async () => jest.advanceTimersByTime(400));
  expect(screen!.root.findByType(FlatList).props.data[0].name).toBe("New");
  await act(async () => finishOld([{ id: 1, name: "Old" }]));
  expect(screen!.root.findByType(FlatList).props.data[0].name).toBe("New");
});
test("closing the song editor reloads the persisted content", async () => {
  jest
    .mocked(crud.getAllItems)
    .mockResolvedValueOnce([
      {
        id: 1,
        title: "Title",
        content: "Old content",
        band_name: "Band",
        band_id: 3
      }
    ])
    .mockResolvedValueOnce([
      {
        id: 1,
        title: "Title",
        content: "New content",
        band_name: "Band",
        band_id: 3
      }
    ]);
  jest.mocked(crud.updateItem).mockResolvedValue(undefined);
  await act(async () => {
    screen = Renderer.create(React.createElement(Song));
  });
  await act(async () => screen!.root.findByType(Menu).props.setIsEdit(true));
  const endEdit = screen!.root.findByType(Editor).props.setIsEdit;
  await act(async () => endEdit(false));
  expect(crud.getAllItems).toHaveBeenCalledTimes(2);
  expect(
    screen!.root
      .findAllByType(Text)
      .some(
        (node) =>
          React.Children.toArray(node.props.children).join("") === "New content"
      )
  ).toBe(true);
});
