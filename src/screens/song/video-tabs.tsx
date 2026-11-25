import { FC, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Linking,
  StyleSheet,
  TouchableOpacity,
  View
} from "react-native";
import Text from "../../components/styled-text";
import YoutubePlayer from "react-native-youtube-iframe";
import extractYoutubeId from "../../components/utils/extract-youtube-id";
import palette from "../../theme/palette";
import { ISong } from "@/@interfaces";
function VideoFrame({ videoId, width }: { videoId: string; width: number }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const attempt = useRef(0);
  const generation = attempt.current;
  const unavailable = () => {
    if (attempt.current === generation) setFailed(true);
  };
  if (failed || width < 200)
    return (
      <View style={styles.failure}>
        <Text accessibilityRole="alert" style={styles.tabText}>
          {t("VideoUnavailable")}
        </Text>
        <TouchableOpacity
          accessibilityRole="link"
          style={styles.fallbackButton}
          onPress={() =>
            void Linking.openURL(
              `https://www.youtube.com/watch?v=${videoId}`
            ).catch(() => Alert.alert(t("LinkOpenError")))
          }
        >
          <Text style={styles.tabText}>{t("VideoOpenYouTube")}</Text>
        </TouchableOpacity>
        {failed && width >= 200 && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.fallbackButton}
            onPress={() => {
              attempt.current++;
              setFailed(false);
            }}
          >
            <Text style={styles.tabText}>{t("Retry")}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  return (
    <View style={styles.player}>
      <YoutubePlayer
        width={width}
        height={Math.max(200, (width * 9) / 16)}
        videoId={videoId}
        onError={unavailable}
        webViewProps={{ onError: unavailable, onHttpError: unavailable }}
      />
    </View>
  );
}

const VideoTabs: FC<ISong> = (song) => {
  const { t } = useTranslation();
  const tabs = (
    [
      { key: "youtube_music", label: t("SongLink") },
      { key: "youtobe_lesson", label: t("TrainingLink") }
    ] as const
  ).filter(({ key }) => song[key]);
  const [activeTab, setActiveTab] = useState("youtube_music");
  const [width, setWidth] = useState(0);
  const selected = tabs.find(({ key }) => key === activeTab) ?? tabs[0];
  if (!selected) return null;
  const videoId = extractYoutubeId(song[selected.key] ?? "");
  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
    >
      <View style={styles.tabContainer}>
        {tabs.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: selected.key === key }}
            style={[styles.tabButton, selected.key === key && styles.activeTab]}
            onPress={() => setActiveTab(key)}
          >
            <Text
              style={[
                styles.tabText,
                selected.key === key && styles.activeText
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {!videoId && <Text style={styles.tabText}>{t("InvalidUrl")}</Text>}
      {!!videoId && width > 0 && (
        <VideoFrame key={videoId} videoId={videoId} width={width} />
      )}
    </View>
  );
};
const styles = StyleSheet.create({
  container: { paddingBottom: 10, gap: 12 },
  tabContainer: {
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: palette.glass.header
  },
  activeTab: { backgroundColor: palette.glass.selected },
  activeText: { color: palette.gold.ink },
  tabText: { color: palette.glass.ink, fontWeight: "600" },
  failure: { gap: 10, alignItems: "stretch" },
  fallbackButton: {
    minHeight: 44,
    padding: 12,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: palette.glass.header
  },
  player: { borderRadius: 16, overflow: "hidden" }
});
export default VideoTabs;
