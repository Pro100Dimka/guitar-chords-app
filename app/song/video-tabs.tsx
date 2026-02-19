import extractYoutubeId from "@/components/utils/extract-youtube-id";
import { ISong } from "@/database";
import { FC, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

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
    <View style={{ flex: 1, gap: 15 }}>
      <View style={styles.tabContainer}>
        {Object.entries(tabs).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabButton, activeTab === key && styles.activeTab]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={styles.tabText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <YoutubePlayer ref={playerRef} height={250} videoId={videoId} />
      </View>
    </View>
  );
};
const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#FF6600"
  },
  tabButton: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)"
  },
  activeTab: {
    backgroundColor: "rgba(255,102,0,0.8)"
  },
  tabText: { color: "#fff", fontWeight: "700" }
});

export default VideoTabs;
