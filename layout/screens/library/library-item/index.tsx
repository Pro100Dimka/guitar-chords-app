import { ISong } from "@/database";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
const COLORS = {
  card: "rgba(20,20,20,0.55)",
  border: "rgba(255,255,255,0.15)",
  text: "#fff",
  accent: "#FF6600"
};

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
      <Text style={styles.title}>{song.title}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "600"
  }
});

export default LibraryItem;
