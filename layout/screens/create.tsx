import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput } from "react-native";

const CreateChordSong = () => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Song Title</Text>
      <TextInput
        style={styles.titleInput}
        placeholder="Enter song title"
        value={title}
        onChangeText={setTitle}
      />

      <Text style={styles.label}>Chords / Lyrics</Text>
      <TextInput
        style={styles.contentInput}
        placeholder="Enter chords or lyrics"
        value={content}
        onChangeText={setContent}
        multiline
        textAlignVertical="top"
        autoCorrect={false}
        autoCapitalize="none"
      />

      {/* You can add a Save button here */}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16
  },
  label: {
    fontSize: 16,
    marginBottom: 6,
    fontWeight: "600"
  },
  titleInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    marginBottom: 20
  },
  contentInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    height: 200,
    fontFamily: "monospace"
  }
});

export default CreateChordSong;
