import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, Linking, TouchableOpacity } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import VideoTabs from "../src/screens/song/video-tabs";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: String })
}));
jest.mock("react-native-youtube-iframe", () => "YoutubePlayer");

const song = {
  id: 1,
  title: "Song",
  content: "Am",
  youtube_music: "https://youtu.be/dQw4w9WgXcQ",
  youtobe_lesson: "https://youtu.be/AbCdEfGhI12"
};
let screen: Renderer.ReactTestRenderer;
const button = (label: string) =>
  screen.root.findAllByType(TouchableOpacity).find((node) =>
    JSON.stringify(node.props.children).includes(`"${label}"`)
  )!;

async function show(width: number) {
  await act(async () => {
    screen = Renderer.create(<VideoTabs {...song} />);
  });
  await act(async () => {
    screen.root.findAll((node) => typeof node.props.onLayout === "function")[0]
      .props.onLayout({ nativeEvent: { layout: { width } } });
  });
}
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});

test.each([240, 280, 320, 390])(
  "embedded video respects the minimum viewport on a %s-point stage",
  async (width) => {
    await show(width);
    const player = screen.root.findByType(YoutubePlayer);
    expect(player.props.width).toBe(width);
    expect(player.props.height).toBeGreaterThanOrEqual(200);
  }
);

test("a narrow video area offers an external link instead of an invalid embed", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await show(180);
  expect(screen.root.findAllByType(YoutubePlayer)).toHaveLength(0);
  expect(JSON.stringify(screen.toJSON())).toContain("VideoUnavailable");
  await act(async () => button("VideoOpenYouTube").props.onPress());
  expect(open).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test.each(["player", "webview"])(
  "video %s failure can be retried and does not affect the other tab",
  async (source) => {
    await show(320);
    const player = screen.root.findByType(YoutubePlayer);
    const fail = source === "player" ? player.props.onError : player.props.webViewProps.onError;
    await act(async () => fail("embed_not_allowed"));
    expect(screen.root.findAllByType(YoutubePlayer)).toHaveLength(0);
    await act(async () => button("Retry").props.onPress());
    expect(screen.root.findByType(YoutubePlayer).props.videoId).toBe("dQw4w9WgXcQ");
    await act(async () => fail("late callback"));
    expect(screen.root.findAllByType(YoutubePlayer)).toHaveLength(1);
    await act(async () => button("TrainingLink").props.onPress());
    expect(screen.root.findByType(YoutubePlayer).props.videoId).toBe("AbCdEfGhI12");
    await act(async () => fail("late callback from previous video"));
    expect(screen.root.findAllByType(YoutubePlayer)).toHaveLength(1);
  }
);

test("external video link errors are reported", async () => {
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await show(180);
  await act(async () => button("VideoOpenYouTube").props.onPress());
  expect(alert).toHaveBeenCalledWith("LinkOpenError");
});
