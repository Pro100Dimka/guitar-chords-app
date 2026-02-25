import { FC, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import { COLORS } from "../../components/fields/text-field";
import extractYoutubeId from "../../components/utils/extract-youtube-id";
import { ISong } from "../../database";

const VideoTabs: FC<ISong> = (song) => {
  const { t } = useTranslation();
  const playerRef = useRef(null);
  const tabs = {
    youtobe_link_music: t("SongLink"),
    youtobe_link_chords: t("TrainingLink")
  };
  const [activeTab, setActiveTab] = useState(Object.keys(tabs)[0]);
  const rawLink = song[activeTab as keyof ISong];
  const videoId = typeof rawLink === "string" ? extractYoutubeId(rawLink) : "";
  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        {Object.entries(tabs).map(
          ([key, label]) =>
            song[key as keyof ISong] && (
              <TouchableOpacity
                key={key}
                style={[
                  styles.tabButton,
                  activeTab === key && styles.activeTab
                ]}
                onPress={() => setActiveTab(key)}
              >
                <Text style={styles.tabText}>{label}</Text>
              </TouchableOpacity>
            )
        )}
      </View>
      {videoId && (
        <View style={styles.flex}>
          <YoutubePlayer
            ref={playerRef}
            width="100%"
            height="100%"
            videoId={videoId}
          />
        </View>
      )}
    </View>
  );
};
const styles = StyleSheet.create({
  container: { flex: 1, paddingBottom: 10 },
  tabContainer: {
    margin: 16,
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.accent,
    flex: 1
  },
  tabButton: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: COLORS.blackOpacityTiny
  },
  activeTab: {
    backgroundColor: COLORS.accent
  },
  tabText: { color: COLORS.text, fontWeight: "700" },
  flex: { width: "100%", maxHeight: 225 }
});

export default VideoTabs;
