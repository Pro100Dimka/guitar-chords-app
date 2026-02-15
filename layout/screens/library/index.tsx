import { fetchSongs, ISong } from "@/database";
import { t } from "@/locales";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import LibraryItem from "./library-item";

const Library = () => {
  const [songs, setSongs] = useState<ISong[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSongs = async () => {
      try {
        const data = (await fetchSongs()) as {
          id: number;
          title: string;
          content: string;
        }[];
        setSongs(data || []);
      } catch (error) {
        console.info("Error fetching songs:", error);
      } finally {
        setLoading(false);
      }
    };
    loadSongs();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("Library")}</Text>
      {loading ? (
        <Text style={styles.loading}>{t("Loading")}...</Text>
      ) : songs.length === 0 ? (
        <Text style={styles.loading}>{t("NoSongs")}</Text>
      ) : (
        songs.map((song) => <LibraryItem key={song.id} song={song} />)
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 16 },
  loading: { color: "#aaa", fontSize: 16, marginTop: 20 }
});

export default Library;
