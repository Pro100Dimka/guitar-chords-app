import Ionicons from "react-native-vector-icons/Ionicons";
import LinearGradient from "react-native-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import palette from "../../theme/palette";

const SearchBar = ({
  setFilters,
  onAdd,
  onFilter,
  filtered
}: {
  setFilters: React.Dispatch<React.SetStateAction<string>>;
  onAdd: () => void;
  onFilter: () => void;
  filtered: boolean;
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const input = useRef<TextInput>(null);
  useEffect(() => {
    const timer = setTimeout(() => setFilters(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query, setFilters]);
  return (
    <View style={styles.row}>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={palette.glass.muted} />
        <TextInput
          ref={input}
          accessibilityLabel={t("SearchSongs")}
          placeholder={t("SearchSongs")}
          placeholderTextColor={palette.glass.muted}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => {
            setFilters(query.trim());
            Keyboard.dismiss();
          }}
        />
        {!!query && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ClearSearch")}
            hitSlop={6}
            onPress={() => {
              setQuery("");
              setFilters("");
              input.current?.focus();
            }}
          >
            <Ionicons name="close" size={20} color={palette.glass.muted} />
          </Pressable>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("LibraryFilter")}
        accessibilityState={{ selected: filtered }}
        onPress={onFilter}
        style={[styles.button, filtered && styles.filtered]}
      >
        <Ionicons
          name="options-outline"
          size={21}
          color={palette.glass.accent}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("createSong")}
        onPress={onAdd}
        style={[styles.button, styles.add]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={palette.finish.goldColors}
          locations={palette.finish.locations}
          style={StyleSheet.absoluteFillObject}
        />
        <Ionicons name="add" size={24} color={palette.gold.ink} />
      </Pressable>
    </View>
  );
};
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  search: {
    flex: 1,
    minWidth: 0,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: palette.glass.control,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 46,
    paddingVertical: 8,
    paddingHorizontal: 0,
    fontSize: 14,
    fontFamily: palette.typography.body,
    color: palette.glass.ink
  },
  button: {
    width: 46,
    height: 46,
    borderRadius: 13,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.glass.control,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  filtered: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.cell
  },
  add: { backgroundColor: palette.gold.center, borderColor: palette.gold.top }
});
export default SearchBar;
