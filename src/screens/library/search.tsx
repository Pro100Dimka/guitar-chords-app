// src/screens/library/search.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import { fetchData, IFetchDataParams } from "../../../database";
import palette from "../../theme/palette";

interface ISearchBarProps {
  setFilters: React.Dispatch<React.SetStateAction<string>>;
}

const SearchBar = ({ setFilters }: ISearchBarProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const inputRef = useRef<TextInput>(null);
  const router = useRouter();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const delay = setTimeout(async () => {
      const params: IFetchDataParams = {
        tableName: "songs s",
        join: "bands b ON s.band_id = b.id",
        fields:
          "b.search_text_lower band, s.search_text_lower title, b.name as band_name, s.id",
        filters: ` LOWER(b.search_text_lower || ' ' || s.search_text_lower) LIKE '%${query.toLowerCase()}%' COLLATE NOCASE `,
        page: 0,
        limit: 10
      };
      const data = await fetchData<any>(params);
      setResults(data);
    }, 300);

    return () => clearTimeout(delay);
  }, [query]);

  const handleSelect = (item: any) => {
    router.push({
      pathname: "/song/[id]",
      params: { id: item.id }
    });
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
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View style={styles.searchRow}>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Search songs..."
                placeholderTextColor={palette.colors.gray}
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
                    color={palette.colors.gray}
                  />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.button}
              onPress={() => setFilters(query)}
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
        </Pressable>
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
  searchRow: { flexDirection: "row", alignItems: "center" },
  inputWrapper: {
    flex: 1,
    position: "relative",
    justifyContent: "center"
  },

  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingRight: 32, // ← место под крестик
    backgroundColor: palette.colors.grayOpacity,
    color: palette.colors.white,
    borderColor: palette.colors.grayOpacityTiny
  },

  clearIcon: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: [{ translateY: -10 }],
    zIndex: 10
  },
  button: {
    marginLeft: 8,
    backgroundColor: palette.colors.accent,
    padding: 10,
    borderRadius: 8
  },
  dropdown: {
    position: "absolute",
    top: 50,
    width: "100%",
    backgroundColor: palette.colors.white,
    borderRadius: 8,
    paddingVertical: 4,
    elevation: 5
  },
  resultItem: {
    gap: 6,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.colors.grayOpacityTiny
  },
  resultTitle: { color: palette.colors.black, fontSize: 16, fontWeight: "600" },
  resultBand: { color: palette.colors.accent, fontWeight: "600", fontSize: 14 }
});

export default SearchBar;
