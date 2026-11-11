import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Text from "../../components/styled-text";
import palette from "../../theme/palette";
import { NavigationProp } from "@/router";
import { ISong } from "@/@interfaces";
import { usePreferences } from "@/components/preferences";
const LibraryItem: React.FC<{ song: ISong }> = ({ song }) => {
  const navigation = useNavigation<NavigationProp>();
  const favorite = usePreferences((state) => state.songs[song.id]?.favorite);
  const cover = usePreferences((state) => state.songs[song.id]?.cover);
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => navigation.navigate("Song", { id: song.id.toString() })}
    >
      <Image
        source={
          cover
            ? { uri: cover }
            : [
                require("../../../assets/images/screen-background/gold-splash.png"),
                require("../../../assets/images/screen-background/song.jpg"),
                require("../../../assets/images/screen-background/background.jpg")
              ][song.id % 3]
        }
        style={styles.cover}
      />
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
  cover: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  pressed: { opacity: 0.75 },
  words: { flex: 1, gap: 6 },
  artist: { color: palette.glass.muted, fontSize: 14 },
  star: { color: palette.glass.accent, fontSize: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: palette.colors.transparent,
    borderRadius: 0,
    paddingVertical: 16,
    marginVertical: 0,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  title: {
    color: palette.glass.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600"
  }
});
export default LibraryItem;
