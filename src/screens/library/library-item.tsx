import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import palette from "../../theme/palette";
import { NavigationProp } from "@/router";
import { ISong } from "@/@interfaces";
import { usePreferences } from "@/components/preferences";
const LibraryItem: React.FC<{ song: ISong }> = ({ song }) => {
  const navigation = useNavigation<NavigationProp>();
  const favorite = usePreferences((state) => state.songs[song.id]?.favorite);
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => navigation.navigate("Song", { id: song.id.toString() })}
    >
      <View style={styles.words}>
        <Text numberOfLines={2} style={styles.title}>
          {song.title}
        </Text>
        <Text numberOfLines={1} style={styles.artist}>
          {song.band_name}
        </Text>
      </View>
      <Text style={styles.star}>{favorite ? "★" : "›"}</Text>
    </Pressable>
  );
};
const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  words: { flex: 1, gap: 6 },
  artist: { color: palette.glass.muted, fontSize: 14 },
  star: { color: palette.glass.accent, fontSize: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: palette.glass.surface,
    borderRadius: 20,
    padding: 18,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  title: { color: palette.glass.ink, fontSize: 17, fontWeight: "600" }
});
export default LibraryItem;
