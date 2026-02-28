// src/screens/library/library-item.tsx
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { ISong } from "../../../database";
import palette from "../../theme/palette";
import { NavigationProp } from "@/router";

const LibraryItem: React.FC<{ song: ISong }> = ({ song }) => {
  const navigation = useNavigation<NavigationProp>();
  return (
    <Pressable
      style={styles.card}
      onPress={() => navigation.navigate("Song", { id: song.id.toString() })}
    >
      <Text style={styles.title}>
        {song.band_name} - {song.title}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.colors.blackOpacity,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: palette.colors.blackOpacityTiny
  },
  title: {
    color: palette.colors.text,
    fontSize: 16,
    fontWeight: "600"
  }
});

export default LibraryItem;
