import React, { useCallback, useState } from "react";
import {
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import guitarBgSong from "../../../assets/images/guitar-background-song.jpg";
import { fetchDataById, ISong } from "../../../database";
import CreateChordSong from "../create-song-chords";
import SongModal from "./header-modal";
import VideoTabs from "./video-tabs";
import Header from "@/components/header";
import palette from "../../theme/palette";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { ScreenRouteProp } from "@/router";

const SongDetail: React.FC = () => {
  const route = useRoute<ScreenRouteProp>();
  const songId = Number(route?.params?.id);
  const [song, setSong] = useState<ISong | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const loadSong = async () => {
        try {
          const song = await fetchDataById<ISong>({
            tableName: "songs",
            data: { "songs.id": songId },
            fields:
              "songs.id, fk_band.name as band_name, fk_band.id as band_id, title, content, youtobe_link_music, youtobe_link_chords",
            join: "bands fk_band ON songs.band_id = fk_band.id"
          });
          setSong(song);
        } catch (error) {
          console.error("Error loading song:", error);
        } finally {
          setLoading(false);
        }
      };
      loadSong();
    }, [songId, isEdit])
  );
  return (
    <ImageBackground
      source={guitarBgSong}
      style={styles.background}
      resizeMode="cover"
    >
      <Header
        title={`${song?.title ? `${song.band_name} - ${song.title}` : "Song Details"}`}
        showBack
      >
        <SongModal setIsEdit={setIsEdit} songId={songId} />
      </Header>
      {loading || !song ? (
        <View style={styles.center}>
          <Text style={styles.loading}>
            {loading ? "Loading..." : "Song not found"}
          </Text>
        </View>
      ) : isEdit ? (
        <CreateChordSong song={song} setIsEdit={setIsEdit} />
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.overlay} />
          <VideoTabs {...song} />
          <Text style={styles.content}>{song.content}</Text>
        </ScrollView>
      )}
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  background: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.colors.blackOpacityTiny
  },
  container: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: {
    padding: 16,
    fontSize: 17.5,
    color: palette.colors.text,
    lineHeight: 27,
    fontFamily: "Tahoma"
  },
  loading: { color: palette.colors.gray, fontSize: 16 }
});

export default SongDetail;
