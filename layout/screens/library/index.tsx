import { fetchData, ISong } from "@/database";
import { t } from "@/locales";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View
} from "react-native";
import LibraryItem from "./library-item";

const PAGE_LIMIT = 10;

const Library = () => {
  const [songs, setSongs] = useState<ISong[]>([]);
  const [loading, setLoading] = useState(true); // для первой загрузки
  const [loadingMore, setLoadingMore] = useState(false); // для подгрузки
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadSongs = async (pageNumber: number = 0) => {
    if (!hasMore && pageNumber > 0) return;
    if (pageNumber === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await fetchData<ISong>({
        tableName: "songs",
        page: pageNumber,
        limit: PAGE_LIMIT,
        filters: "",
        fields: "songs.id, fk_band.name as band_name, title",
        join: "bands fk_band ON songs.band_id = fk_band.id"
      });
      if (pageNumber === 0) setSongs(data);
      else setSongs((prev) => [...prev, ...data]);
      setPage(pageNumber + 1);
      setHasMore(data.length === PAGE_LIMIT);
    } catch (error) {
      console.info("Error fetching songs:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };
  useEffect(() => {
    loadSongs(0); // первая загрузка
  }, []);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("Library")}</Text>
      {loading && (
        <ActivityIndicator
          size="large"
          color="#fff"
          style={{ marginTop: 20 }}
        />
      )}
      {!loading && songs.length === 0 && (
        <Text style={styles.loading}>{t("NoSongs")}</Text>
      )}
      <FlatList
        data={songs}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <LibraryItem song={item} />}
        onEndReached={() => loadSongs(page)}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ marginVertical: 12 }} />
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 16 },
  loading: { color: "#aaa", fontSize: 16, marginTop: 20 }
});

export default Library;
