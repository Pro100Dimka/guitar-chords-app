import type { SQLTransaction } from "react-native-sqlite-2";
import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import { Formik, FormikProps } from "formik";
import Editor, { FormValues } from "../src/screens/create-song-chords";
import initialValues from "../src/screens/create-song-chords/formik/initial-values";
import { db } from "../src/components/database";
jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/locales", () => ({ t: String }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: {} }),
  useNavigation: () => mockNavigation,
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
  useFocusEffect: (cb: () => void) => require("react").useEffect(cb, [cb])
}));
const mockNavigation = { dispatch: jest.fn(), replace: jest.fn() };
const mockPreventRemove = jest.fn();
let screen: Renderer.ReactTestRenderer;
let fail = false;
let values!: FormikProps<FormValues>;
beforeEach(async () => {
  jest.clearAllMocks();
  fail = false;
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    const tx: SQLTransaction = {
      executeSql: (_sql, _args, done) => {
        done?.(tx, {
          insertId: 91,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
    else success?.();
  });
  await act(async () => {
    screen = Renderer.create(<Editor />);
  });
});
afterEach(async () => {
  await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
async function change() {
  const input = screen.root.findAll(
    (node) => node.props.formik && node.props.name === "title"
  )[0];
  values = input.props.formik;
  await act(async () => {
    await values.setValues({
      ...initialValues,
      title: "Draft",
      content: "Am\nWords"
    });
  });
  values = screen.root.findAll(
    (node) => node.props.formik && node.props.name === "title"
  )[0].props.formik;
}
const trigger = (action: unknown) =>
  mockPreventRemove.mock.calls.at(-1)![1]({ data: { action } });
const press = async (label: string) => {
  await act(async () =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === label)!
      .onPress?.()
  );
};
test.each(["GO_BACK", "POP", "POP_TO_TOP"])(
  "changed form blocks %s until discard",
  async (type) => {
    await change();
    expect(mockPreventRemove.mock.calls.at(-1)![0]).toBe(true);
    const action = { type };
    await act(async () => trigger(action));
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    await press("StayInEditor");
    expect(values.values.title).toBe("Draft");
    await act(async () => trigger(action));
    await press("DiscardChanges");
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
  }
);
test("save-and-leave waits for successful persistence; failure preserves the edited text", async () => {
  await change();
  const action = { type: "GO_BACK" };
  fail = true;
  await act(async () => trigger(action));
  await press("SaveSong");
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(values.values.content).toBe("Am\nWords");
  fail = false;
  await act(async () => trigger(action));
  await press("SaveSong");
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
});
