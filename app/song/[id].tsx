import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { fetchSongs } from "@/database";

const SongDetail = () => {
  const params = useLocalSearchParams<{ id: string }>();
  const songId = Number(params.id);

  const [song, setSong] = useState<{ id: number; title: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSong = async () => {
      try {
        const allSongs = await fetchSongs() as { id: number; title: string; content: string }[];
        const selectedSong = allSongs.find((s) => s.id === songId) || null;
        setSong(selectedSong);
      } catch (error) {
        console.log("Error loading song:", error);
      } finally {
        setLoading(false);
      }
    };
    loadSong();
  }, [songId]);

  if (loading) return <View style={styles.center}><Text style={styles.loading}>Loading...</Text></View>;
  if (!song) return <View style={styles.center}><Text style={styles.loading}>Song not found</Text></View>;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{song.title}</Text>
      <Text style={styles.content}>{song.content}</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 16 },
  content: { fontSize: 16, color: "#fff", lineHeight: 24, fontFamily: "monospace" },
  loading: { color: "#aaa", fontSize: 16 }
});

export default SongDetail;
