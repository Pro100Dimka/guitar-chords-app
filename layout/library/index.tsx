import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View
} from "react-native";
import { COLORS } from "../../components/fields/text-field";
import { fetchData, ISong } from "../../database";
import { t } from "../../locales";
import LibraryItem from "./library-item";
import SearchBar from "./search";

const PAGE_LIMIT = 10;

const Library = () => {
  const [songs, setSongs] = useState<ISong[]>([]);
  const [loading, setLoading] = useState(true); // для первой загрузки
  const [loadingMore, setLoadingMore] = useState(false); // для подгрузки
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState("");
  const loadSongs = useCallback(
    async (pageNumber: number = 0) => {
      if (!hasMore && pageNumber > 0) return;
      if (pageNumber === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const data = await fetchData<ISong>({
          tableName: "songs s",
          join: "bands b ON s.band_id = b.id",
          page: pageNumber,
          limit: PAGE_LIMIT,
          filters:
            filters &&
            `LOWER(b.search_text_lower || ' ' || s.search_text_lower) LIKE '%${filters.toLowerCase()}%' COLLATE NOCASE `,
          fields:
            "b.search_text_lower band, s.search_text_lower title, b.name as band_name, s.id"
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
    },
    [hasMore, filters]
  );
  useFocusEffect(
    useCallback(() => {
      loadSongs(0);
    }, [loadSongs])
  );
  useEffect(() => {
    if (filters) loadSongs(0);
  }, [filters, loadSongs]);
  return (
    <View style={styles.container}>
      {songs.length > 0 && <SearchBar setFilters={setFilters} />}
      {loading && (
        <ActivityIndicator
          size="large"
          color="#fff"
          style={styles.activityIndicator}
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
            <ActivityIndicator style={styles.activityIndicatorFlat} />
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingBottom: 40 },
  activityIndicator: { marginTop: 20 },
  activityIndicatorFlat: { marginVertical: 12 },
  loading: {
    color: COLORS.accent,
    flex: 1,
    fontSize: 30,
    position: "absolute",
    width: "110%",
    backgroundColor: COLORS.blackOpacity,
    lineHeight: 1,
    fontWeight: "700",
    height: "110%",
    textAlign: "center",
    textAlignVertical: "center"
  }
});

export default Library;
