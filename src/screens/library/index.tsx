import { requestSongDeletion } from "../../components/library-files";
// src/screens/library/index.tsx
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  FlatList,
  ScrollView,
  Platform,
  Pressable,
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
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { Sheet, Action } from "../song/tools";
import { NavigationProp } from "@/router";

const PAGE_LIMIT = 10;

const Library: React.FC = () => {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp>();
  const [adding, setAdding] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [selectedSong, setSelectedSong] = useState<ISong | null>(null);
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
  const saved = usePreferences((state) =>
    collection === "AllSongs" ? null : state.songs
  );
  const selection = useMemo(() => {
    if (collection === "AllSongs") return "";
    return Object.entries(saved ?? {})
      .filter(([, song]) =>
        collection === "Favorites" ? song.favorite : song.opened > 0
      )
      .sort((a, b) => b[1].opened - a[1].opened)
      .map(([id]) => Number(id))
      .filter(Number.isSafeInteger)
      .join(",");
  }, [saved, collection]);
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
              "LOWER(COALESCE(b.search_text_lower, '') || ' ' || s.search_text_lower) LIKE ? ESCAPE '!' COLLATE NOCASE",
            collection !== "AllSongs" &&
              `s.id IN (${
                selection
                  ? selection
                      .split(",")
                      .map(() => "?")
                      .join(",")
                  : "NULL"
              })`
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
          parameters: [
            ...(filters
              ? [`%${filters.toLowerCase().replace(/[!%_]/g, "!$&")}%`]
              : []),
            ...(collection !== "AllSongs" && selection
              ? selection.split(",").map(Number)
              : [])
          ],
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
  const latestLoadSongs = useRef(loadSongs);
  latestLoadSongs.current = loadSongs;
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
      <SearchBar
        setFilters={setFilters}
        onAdd={() => setAdding(true)}
        onFilter={() => setFiltering(true)}
        filtered={collection !== "AllSongs"}
      />
      {filtering && (
        <Sheet
          compact
          title={t("LibraryFilter")}
          onClose={() => setFiltering(false)}
        >
          {["AllSongs", "RecentSongs", "Favorites"].map((key) => (
            <Action
              key={key}
              label={t(key)}
              selected={collection === key}
              onPress={() => {
                setCollection(key);
                setFiltering(false);
              }}
            />
          ))}
        </Sheet>
      )}
      {selectedSong && (
        <Sheet
          compact
          title={selectedSong.title}
          onClose={() => setSelectedSong(null)}
        >
          <Action
            label={t(
              usePreferences.getState().songs[selectedSong.id]?.favorite
                ? "FavoritesRemove"
                : "FavoritesAdd"
            )}
            onPress={() => {
              const state = usePreferences.getState();
              state.updateSong(selectedSong.id, {
                favorite: !state.songs[selectedSong.id]?.favorite
              });
              setSelectedSong(null);
            }}
          />
          <Action
            label={t("Delete")}
            onPress={() => {
              const song = selectedSong;
              setSelectedSong(null);
              requestSongDeletion(
                song.id,
                () => {
                  void latestLoadSongs.current(0);
                },
                () =>
                  navigation.navigate("Song", {
                    id: String(song.id),
                    recordings: true
                  })
              );
            }}
          />
        </Sheet>
      )}
      {adding && (
        <Sheet
          compact
          title={t("AddSongTitle")}
          onClose={() => setAdding(false)}
        >
          {[
            {
              label: "AddSongManual",
              hint: "AddSongManualHint",
              icon: "pencil-outline",
              onPress: () => navigation.navigate("createSong")
            },
            ...(Platform.OS === "android"
              ? [
                  {
                    label: "AutofillRecognizeMic",
                    hint: "AddSongMicHint",
                    icon: "microphone",
                    onPress: () =>
                      navigation.navigate("recognizeSong", { mode: "mic" })
                  },
                  {
                    label: "AutofillRecognizeFile",
                    hint: "AddSongFileHint",
                    icon: "file-music-outline",
                    onPress: () =>
                      navigation.navigate("recognizeSong", { mode: "file" })
                  }
                ]
              : []),
            {
              label: "ImportSong",
              hint: "AddSongTextHint",
              icon: "file-document-outline",
              onPress: () =>
                navigation.navigate("recognizeSong", { mode: "text" })
            }
          ].map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.addOption,
                pressed && { opacity: 0.7 }
              ]}
              onPress={() => {
                setAdding(false);
                item.onPress();
              }}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={26}
                color={palette.glass.accent}
              />
              <View style={styles.optionWords}>
                <Text style={styles.optionTitle}>{t(item.label)}</Text>
                <Text style={styles.optionHint}>{t(item.hint)}</Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={palette.glass.muted}
              />
            </Pressable>
          ))}
        </Sheet>
      )}
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
            source={require("../../../assets/images/gold-folder.webp")}
            style={[styles.glow, height < 650 && styles.compactGlow]}
          />
          <Text style={styles.noSongsText}>{t("NoSongs")}</Text>
        </ScrollView>
      )}
      {songs.length > 0 && (
        <FlatList
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          style={styles.list}
          renderItem={({ item }) => (
            <LibraryItem
              song={item}
              onLongPress={() => setSelectedSong(item)}
            />
          )}
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
  addOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  optionWords: { flex: 1, gap: 5 },
  optionTitle: { color: palette.glass.ink, fontSize: 17, fontWeight: "600" },
  optionHint: { color: palette.glass.muted, fontSize: 13, lineHeight: 19 },
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
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 14
  },
  list: { flex: 1 },
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
