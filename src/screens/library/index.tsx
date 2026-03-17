// src/screens/library/index.tsx
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { t } from "../../locales";
import LibraryItem from "./library-item";
import SearchBar from "./search";
import palette from "../../theme/palette";
import { ISong } from "@/@interfaces";
import { getAllItems } from "@/components/database/crud";
import { NavigationProp } from "@/router";

const PAGE_LIMIT = 10;

const Library: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
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
        const data = await getAllItems({
          tableName: "songs s",
          joins: ["LEFT JOIN bands b ON s.band_id = b.id"],
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
        <View style={styles.noSongsContainer}>
          <Text style={styles.noSongsText}>{t("NoSongs")}</Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate("createSong")}
          >
            <Text style={styles.createButtonText}>{t`createSong`}</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={songs}
        keyExtractor={(item, i) => `${item.id}-${i}`}
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
    color: palette.colors.accent,
    backgroundColor: palette.colors.blackOpacity,
    flex: 1,
    fontSize: 30,
    textAlign: "center",
    position: "absolute",
    paddingTop: "80%",
    width: "110%",
    fontWeight: "700",
    height: "110%"
  },
  noSongsContainer: {
    color: palette.colors.accent,
    backgroundColor: palette.colors.blackOpacity,
    flex: 1,
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center"
  },
  noSongsText: {
    color: palette.colors.accent,
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 16
  },
  createButton: {
    backgroundColor: palette.colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    zIndex: 999
  },
  createButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600"
  }
});

export default Library;
