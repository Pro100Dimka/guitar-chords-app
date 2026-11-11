import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Text from "../../components/styled-text";
import YoutubePlayer from "react-native-youtube-iframe";
import extractYoutubeId from "../../components/utils/extract-youtube-id";
import palette from "../../theme/palette";
import { ISong } from "@/@interfaces";
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
      {!!videoId && width > 0 && (
        <View style={styles.player}>
          <YoutubePlayer
            width={width}
            height={(width * 9) / 16}
            videoId={videoId}
          />
        </View>
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
  player: { borderRadius: 16, overflow: "hidden" }
});
export default VideoTabs;
