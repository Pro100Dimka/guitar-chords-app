// src/screens/library/index.tsx
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  FlatList,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import Text from "../../components/styled-text";
import { useTranslation } from "react-i18next";
import LibraryItem from "./library-item";
import SearchBar from "./search";
import palette from "../../theme/palette";
import { ISong } from "@/@interfaces";
import { getAllItems } from "@/components/database/crud";
import { usePreferences } from "@/components/preferences";
import { Action } from "../song/tools";
import { NavigationProp } from "@/router";

const PAGE_LIMIT = 10;

const Library: React.FC = () => {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp>();
  const [songs, setSongs] = useState<ISong[]>([]);
  const [loading, setLoading] = useState(true); // для первой загрузки
  const [loadingMore, setLoadingMore] = useState(false); // для подгрузки
  const [loadError, setLoadError] = useState(false);
  const pagination = useRef({
    page: 0,
    hasMore: true,
    pending: false,
    requestId: 0
  });
  const [filters, setFilters] = useState("");
  const [collection, setCollection] = useState("AllSongs");
  const saved = usePreferences((state) => state.songs);
  const ids = Object.entries(saved)
    .filter(([, song]) =>
      collection === "Favorites" ? song.favorite : song.opened > 0
    )
    .sort((a, b) => b[1].opened - a[1].opened)
    .map(([id]) => Number(id))
    .filter(Number.isSafeInteger);
  const selection = collection === "AllSongs" ? "" : ids.join(",");
  const loadSongs = useCallback(
    async (pageNumber: number = 0) => {
      if (
        pageNumber > 0 &&
        (!pagination.current.hasMore || pagination.current.pending)
      )
        return;
      const requestId = ++pagination.current.requestId;
      pagination.current.pending = true;
      setLoadError(false);
      if (pageNumber === 0) {
        pagination.current.page = 0;
        pagination.current.hasMore = true;
        setSongs([]);
        setLoading(true);
      } else setLoadingMore(true);
      try {
        const data = await getAllItems<ISong>({
          tableName: "songs s",
          joins: ["LEFT JOIN bands b ON s.band_id = b.id"],
          page: pageNumber,
          limit: PAGE_LIMIT,
          filters: [
            filters &&
              "LOWER(COALESCE(b.search_text_lower, '') || ' ' || s.search_text_lower) LIKE ? COLLATE NOCASE",
            collection !== "AllSongs" && `s.id IN (${selection || "NULL"})`
          ]
            .filter(Boolean)
            .join(" AND "),
          orderBy:
            collection === "RecentSongs" && selection
              ? `CASE s.id ${selection
                  .split(",")
                  .map((id, index) => `WHEN ${id} THEN ${index}`)
                  .join(" ")} END`
              : "s.title COLLATE NOCASE, s.id",
          parameters: filters ? [`%${filters.toLowerCase()}%`] : [],
          fields: "b.search_text_lower band, s.title, b.name as band_name, s.id"
        });

        if (requestId !== pagination.current.requestId) return;
        if (pageNumber === 0) setSongs(data);
        else setSongs((prev) => [...prev, ...data]);
        pagination.current.page = pageNumber + 1;
        pagination.current.hasMore = data.length === PAGE_LIMIT;
      } catch (error) {
        console.info("Error fetching songs:", error);
        if (requestId === pagination.current.requestId) setLoadError(true);
      } finally {
        if (requestId === pagination.current.requestId) {
          pagination.current.pending = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filters, collection, selection]
  );
  useFocusEffect(
    useCallback(() => {
      loadSongs(0);
      return () => {
        pagination.current.requestId++;
        pagination.current.pending = false;
      };
    }, [loadSongs])
  );

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("library")}
      </Text>
      <View style={styles.collections}>
        <Action glass label={t("AutofillRecognize")} onPress={() => navigation.navigate("createSong", { recognize: "mic" })} />
      </View>
      <SearchBar setFilters={setFilters} />
      <View style={styles.collections}>
        {["AllSongs", "RecentSongs", "Favorites"].map((key) => (
          <Action
            glass
            compact
            key={key}
            label={t(key)}
            selected={collection === key}
            onPress={() => setCollection(key)}
          />
        ))}
      </View>
      {loading && (
        <ActivityIndicator
          size="large"
          color={palette.colors.white}
          style={styles.activityIndicator}
        />
      )}
      {!loading && loadError && (
        <View style={styles.collections}>
          <Text style={styles.errorText}>{t("LibraryLoadError")}</Text>
          <Action
            glass
            label={t("Retry")}
            onPress={() => void loadSongs(pagination.current.page)}
          />
        </View>
      )}
      {!loading && !loadError && songs.length === 0 && (
        <ScrollView contentContainerStyle={styles.noSongsContainer}>
          <Image
            source={require("../../../assets/images/gold-folder.png")}
            style={[styles.glow, height < 650 && styles.compactGlow]}
          />
          <Text style={styles.noSongsText}>{t("NoSongs")}</Text>
          {!filters && collection === "AllSongs" && (
            <>
              <Text style={styles.errorText}>{t("EmptyLibraryHint")}</Text>
              <Action
                glass
                label={t("TryExample")}
                onPress={() =>
                  navigation.navigate("createSong", { example: true })
                }
              />
            </>
          )}
          <Action
            primary
            label={`+ ${t("createSong")}`}
            onPress={() => navigation.navigate("createSong")}
          />
        </ScrollView>
      )}
      {songs.length > 0 && (
        <FlatList
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          renderItem={({ item }) => <LibraryItem song={item} />}
          onEndReached={() => {
            if (!loadError && !pagination.current.pending)
              loadSongs(pagination.current.page);
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.activityIndicatorFlat} />
            ) : null
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  glow: {
    width: 132,
    height: 132
  },
  compactGlow: { width: 64, height: 64 },
  container: {
    flex: 1,
    padding: 20,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center"
  },
  heading: {
    color: palette.glass.ink,
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 20
  },
  listContent: { paddingBottom: 24 },
  errorText: {
    color: palette.glass.muted,
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center"
  },
  collections: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 8,
    paddingVertical: 4,
    borderRadius: 18,
    backgroundColor: palette.colors.transparent
  },
  activityIndicator: { marginTop: 20 },
  activityIndicatorFlat: { marginVertical: 12 },
  noSongsContainer: {
    padding: 8,
    borderRadius: 24,
    gap: 10,
    backgroundColor: palette.colors.transparent,
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center"
  },
  noSongsText: {
    color: palette.glass.ink,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 0
  }
});

export default Library;
