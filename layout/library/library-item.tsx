import { COLORS } from "@/components/fields/text-field";
import { ISong } from "@/database";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

const LibraryItem = ({ song }: { song: ISong }) => {
  const router = useRouter();

  return (
    <Pressable
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: "/song/[id]",
          params: { id: song.id }
        })
      }
    >
      <Text style={styles.title}>
        {song.band_name} - {song.title}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.blackOpacity,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.blackOpacityTiny
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "600"
  }
});

export default LibraryItem;
