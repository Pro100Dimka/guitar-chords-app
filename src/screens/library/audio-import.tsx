import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { useTranslation } from "react-i18next";
import { pick } from "@react-native-documents/picker";
import { fileCanceled } from "../../components/library-files";
import { createAudioSong } from "../../components/database/audio-analysis";
import { songAudio } from "../../components/song-audio";
import { analysisErrorKey } from "../../components/song-analysis/errors";
import Text from "../../components/styled-text";
import { Action, Sheet, styles } from "../song/tools";

export default function AudioImport({
  onImported,
  expectedSha
}: {
  onImported: (songId: number) => void;
  expectedSha?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (request.current) songAudio.cancelImport(request.current);
    };
  }, []);
  const cancel = () => {
    if (request.current) songAudio.cancelImport(request.current);
    request.current = null;
    setBusy(false);
  };
  const importFile = async () => {
    if (busy) return;
    setBusy(true);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    request.current = id;
    try {
      const [file] = await pick({
        type: [
          "audio/mpeg",
          "audio/wav",
          "audio/x-wav",
          "audio/mp4",
          "audio/x-m4a"
        ],
        allowMultiSelection: false
      });
      if (request.current !== id || !mounted.current) return;
      const metadata = await songAudio.importAudio(
        file.uri,
        file.name ?? "audio",
        id
      );
      if (request.current !== id || !mounted.current) return;
      if (expectedSha && metadata.sha256 !== expectedSha) {
        throw new Error("AudioDifferentFile");
      }
      const result = await createAudioSong(metadata);
      if (mounted.current && request.current === id) {
        if (!result.created && !expectedSha)
          Alert.alert(t("AudioAlreadyImported"));
        onImported(result.songId);
      }
    } catch (error) {
      if (
        mounted.current &&
        request.current === id &&
        !fileCanceled(error) &&
        analysisErrorKey(error) !== "AnalysisCancelled"
      ) {
        Alert.alert(t("AudioImportError"), t(analysisErrorKey(error)));
      }
    } finally {
      // Stable hash files may already be in use by an immediate retry. A SQLite
      // snapshot followed by unlink would race its commit. Native import removes
      // temporary parts; startup collects unreferenced stable files after 24 h.
      if (request.current === id) {
        request.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };
  if (!songAudio.isSupported)
    return (
      <Text style={styles.description}>{t("AudioAnalysisAndroidOnly")}</Text>
    );
  return (
    <>
      <Action
        glass
        primary
        label={t(expectedSha ? "AudioRelink" : "AddAudio")}
        disabled={busy}
        onPress={() => void importFile()}
      />
      {busy && (
        <Sheet musical title={t("AudioImporting")} onClose={cancel}>
          <View>
            <ActivityIndicator />
            <Text style={styles.description}>{t("AudioImportingHint")}</Text>
          </View>
          <Action glass label={t("Cancel")} onPress={cancel} />
        </Sheet>
      )}
    </>
  );
}
