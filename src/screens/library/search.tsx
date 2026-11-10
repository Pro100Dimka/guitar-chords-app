// src/screens/library/search.tsx
import Ionicons from "react-native-vector-icons/Ionicons";
import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import palette from "../../theme/palette";
import { useNavigation } from "@react-navigation/native";
import { NavigationProp } from "../../router";
import { getAllItems } from "@/components/database/crud";
import { t } from "@/locales";
import { ISong } from "@/@interfaces";

interface ISearchBarProps {
  setFilters: React.Dispatch<React.SetStateAction<string>>;
}

const SearchBar = ({ setFilters }: ISearchBarProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ISong[]>([]);
  const inputRef = useRef<TextInput>(null);
  const navigation = useNavigation<NavigationProp>();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    let active = true;
    const delay = setTimeout(async () => {
      const params = {
        tableName: "songs s",
        joins: ["LEFT JOIN bands b ON s.band_id = b.id"],
        fields: "b.search_text_lower band, s.title, b.name as band_name, s.id",
        filters:
          "LOWER(COALESCE(b.search_text_lower, '') || ' ' || s.search_text_lower) LIKE ? COLLATE NOCASE",
        parameters: [`%${query.toLowerCase()}%`],
        page: 0,
        limit: 10
      };
      try {
        const data = await getAllItems<ISong>(params);
        if (active) setResults(data);
      } catch (error) {
        if (active) setResults([]);
        console.error("Error searching songs:", error);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(delay);
    };
  }, [query]);

  const handleSelect = (item: ISong) => {
    navigation.navigate("Song", { id: item.id.toString() });
    handleDismiss();
  };

  const handleDismiss = () => {
    setResults([]);
    Keyboard.dismiss();
  };

  return (
    <>
      {results.length > 0 && (
        <Pressable onPress={handleDismiss} style={styles.overlay} />
      )}
      <View style={styles.container}>
        <View>
          <View style={styles.searchRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("createSong")}
              style={styles.button}
              onPress={() => navigation.navigate("createSong")}
            >
              <Ionicons name="add" size={22} color="white" />
            </TouchableOpacity>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder={t("SearchSongs")}
                placeholderTextColor={palette.glass.muted}
                value={query}
                onChangeText={setQuery}
                onPressIn={(e) => e.stopPropagation()}
              />

              {query.length > 0 && (
                <TouchableOpacity
                  style={styles.clearIcon}
                  onPress={() => {
                    handleDismiss();
                    setFilters("");
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={palette.glass.muted}
                  />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("SearchSongs")}
              style={styles.button}
              onPress={() => {
                handleDismiss();
                setFilters(query);
              }}
            >
              <Ionicons name="search-outline" size={22} color="white" />
            </TouchableOpacity>
          </View>

          {results.length > 0 && (
            <View style={styles.dropdown}>
              <FlatList
                data={results}
                keyExtractor={(item, i) => `${item.id}-${i}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resultItem}
                    onPress={() => handleSelect(item)}
                  >
                    <Text style={styles.resultBand}>{item.band_name}</Text>
                    <Text style={styles.resultTitle}>{item.title}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: { position: "relative", zIndex: 20, marginBottom: 8 },
  overlay: {
    position: "absolute",
    zIndex: 1,
    top: "-50%",
    left: "-50%",
    right: "-50%",
    bottom: "-50%"
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inputWrapper: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    justifyContent: "center"
  },

  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingRight: 32, // ← место под крестик
    backgroundColor: palette.glass.surface,
    color: palette.glass.ink,
    borderColor: palette.glass.edge
  },

  clearIcon: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: [{ translateY: -10 }],
    zIndex: 10
  },
  button: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.glass.play,
    borderRadius: 14
  },
  dropdown: {
    position: "absolute",
    top: 50,
    width: "100%",
    backgroundColor: palette.glass.header,
    borderRadius: 14,
    paddingVertical: 4,
    elevation: 5
  },
  resultItem: {
    gap: 6,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.edge
  },
  resultTitle: { color: palette.colors.black, fontSize: 16, fontWeight: "600" },
  resultBand: { color: palette.glass.muted, fontWeight: "600", fontSize: 14 }
});

export default SearchBar;
