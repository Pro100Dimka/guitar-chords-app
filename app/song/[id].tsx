import { fetchSongs, ISong } from "@/database";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Header from "../header";

const SongDetail: React.FC = () => {
  const params = useLocalSearchParams();
  const songId = Number(params.id);
  const [song, setSong] = useState<ISong | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSong = async () => {
      try {
        const allSongs = (await fetchSongs()) as ISong[];
        setSong(allSongs.find((s: ISong) => s.id === songId));
      } catch (error) {
        console.info("Error loading song:", error);
      } finally {
        setLoading(false);
      }
    };
    loadSong();
  }, [songId]);

  return (
    <>
      <Header title={song?.title || "Song Details"} showBack />
      {loading || !song ? (
        <View style={styles.center}>
          <Text style={styles.loading}>
            {loading ? "Loading..." : "Song not found"}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.content}>{song.content}</Text>
        </ScrollView>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 16 },
  content: {
    fontSize: 16,
    color: "#fff",
    lineHeight: 24,
    fontFamily: "monospace"
  },
  loading: { color: "#aaa", fontSize: 16 }
});

export default SongDetail;
