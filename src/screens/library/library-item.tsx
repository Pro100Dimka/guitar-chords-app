import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Text from "../../components/styled-text";
import palette from "../../theme/palette";
import { NavigationProp } from "@/router";
import { ISong } from "@/@interfaces";
import { usePreferences } from "@/components/preferences";
import { useTranslation } from "react-i18next";
const LibraryItem: React.FC<{ song: ISong; onLongPress?: () => void }> = ({
  song,
  onLongPress
}) => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const favorite = usePreferences((state) => state.songs[song.id]?.favorite);
  const cover = usePreferences((state) => state.songs[song.id]?.cover);
  const hasTablature = usePreferences(
    (state) => !!state.songs[song.id]?.tablature?.notes.length
  );
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => navigation.navigate("Song", { id: song.id.toString() })}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <Image
        source={
          cover
            ? { uri: cover }
            : [
                require("../../../assets/images/screen-background/gold-splash.webp"),
                require("../../../assets/images/screen-background/song.webp"),
                require("../../../assets/images/screen-background/background.webp")
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
      {hasTablature && (
        <Text style={styles.tabBadge} accessibilityLabel={t("TabTitle")}>
          TAB
        </Text>
      )}
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
  tabBadge: {
    color: palette.glass.accent,
    fontSize: 11,
    fontWeight: "700",
    borderColor: palette.glass.edge,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 3
  },
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
