import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Image,
  Pressable,
  StyleSheet,
  View
} from "react-native";
import Text from "../../components/styled-text";
import { useTranslation } from "react-i18next";
import { saveDocuments } from "@react-native-documents/picker";
import { Action, Sheet } from "./tools";
import { performanceAudio, Take } from "../../components/performance-audio";
import checkMicPermission from "../../components/permissions";
import { fileCanceled } from "../../components/library-files";
import palette from "../../theme/palette";

export default function SongRecorder({
  songId,
  active,
  onStart
}: {
  songId: number;
  active: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [playing, setPlaying] = useState("");
  const recordingRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const mounted = useRef(true);
  const operation = useRef(false);
  const load = useCallback(async () => {
    const files = await performanceAudio.list(songId);
    if (mounted.current) setTakes(files);
  }, [songId]);
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!fileCanceled(error) && mounted.current)
        Alert.alert(t("RecordingError"), t("RecordingErrorHint"));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    const listener = performanceAudio.listen((event) => {
      if (event.state === "stopped") setPlaying("");
      if (["processing", "error"].includes(event.state)) {
        recordingRef.current = false;
        setRecording(false);
      }
      if (
        ["processing", "saved", "error", "processingFailed"].includes(
          event.state
        )
      ) {
        void load().catch(() => Alert.alert(t("RecordingError")));
        if (event.state === "error")
          Alert.alert(t("RecordingError"), t("RecordingErrorHint"));
        if (event.state === "processingFailed")
          Alert.alert(t("RecordingPolishFailed"));
      }
    });
    const background = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        performanceAudio.stopPlayback();
        if (recordingRef.current)
          void performanceAudio.stop().catch(() => undefined);
      }
    });
    return () => {
      mounted.current = false;
      listener.remove();
      background.remove();
      performanceAudio.stopPlayback();
      if (recordingRef.current)
        void performanceAudio.stop().catch(() => undefined);
    };
  }, [load, t]);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      performanceAudio.stopPlayback();
      if (recordingRef.current)
        void performanceAudio.stop().catch(() => undefined);
    }
  }, [active]);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      500
    );
    return () => clearInterval(timer);
  }, [recording]);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const recordControl = (
    <View style={[styles.recordStage, takes.length > 0 && styles.compactStage]}>
      {!takes.length && (
        <View pointerEvents="none" style={styles.wave}>
          {Array.from({ length: 39 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.waveBar,
                { height: 8 + Math.abs(Math.sin(index * 1.9)) * 54 }
              ]}
            />
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("StartRecording")}
        disabled={busy}
        style={[styles.recordRing, takes.length > 0 && styles.compactRing]}
        onPress={() =>
          void run(async () => {
            if (!(await checkMicPermission(true))) {
              Alert.alert(t("ErrorMicAccess"), t("ConfigurePermissions"), [
                { text: t("Cancel"), style: "cancel" },
                {
                  text: t("ConfigurePermissions"),
                  onPress: () => void Linking.openSettings()
                }
              ]);
              return;
            }
            if (!mounted.current || AppState.currentState !== "active") return;
            performanceAudio.stopPlayback();
            await performanceAudio.start(songId);
            recordingRef.current = true;
            if (
              !mounted.current ||
              !activeRef.current ||
              AppState.currentState !== "active"
            ) {
              await performanceAudio.stop();
              recordingRef.current = false;
              return;
            }
            setRecording(true);
            setVisible(false);
            onStart();
          })
        }
      >
        <Image
          source={require("../../../assets/images/gold-record-button.png")}
          style={styles.recordImage}
        />
      </Pressable>
      <Text style={styles.recordCaption}>
        {t(busy ? "FileLoading" : "StartRecording")}
      </Text>
    </View>
  );
  return (
    <View>
      <Action
        glass
        compact
        label={recording ? `■ ${time}` : t("RecordPerformance")}
        icon={recording ? "stop" : "record-circle"}
        accessibilityLabel={t(
          recording ? "StopRecording" : "RecordPerformance"
        )}
        selected={recording}
        disabled={busy || !active}
        onPress={() =>
          void run(async () => {
            if (recording) {
              await performanceAudio.stop();
              recordingRef.current = false;
              setRecording(false);
            }
            await load();
            setVisible(true);
          })
        }
      />
      {recording && <Text style={styles.elapsed}>{time}</Text>}
      {visible && (
        <Sheet
          musical
          title={t(takes.length ? "MyRecordings" : "RecordPerformance")}
          onClose={() => {
            if (!busy) {
              performanceAudio.stopPlayback();
              setVisible(false);
            }
          }}
        >
          <Text style={styles.hint}>{t("RecordingLocalHint")}</Text>
          {!takes.length && recordControl}
          {takes.map((take) => (
            <View key={take.path} style={styles.card}>
              <Text style={styles.title}>
                {new Date(take.date).toLocaleString()}
              </Text>
              {take.processing && (
                <Text style={styles.hint}>{t("RecordingProcessing")}</Text>
              )}
              <View style={styles.row}>
                <Action
                  glass
                  label={playing === take.path ? "■" : "▶"}
                  icon={playing === take.path ? "stop" : "play"}
                  accessibilityLabel={t(
                    playing === take.path ? "StopPlayback" : "ListenTake"
                  )}
                  selected={playing === take.path}
                  disabled={busy || take.processing}
                  onPress={() =>
                    void run(async () => {
                      if (playing === take.path)
                        performanceAudio.stopPlayback();
                      else {
                        await performanceAudio.play(take.path);
                        setPlaying(take.path);
                      }
                    })
                  }
                />
                <Action
                  glass
                  label="↗"
                  icon="export-variant"
                  accessibilityLabel={t("SaveRecordingFile")}
                  disabled={busy || take.processing}
                  onPress={() =>
                    void run(async () => {
                      performanceAudio.stopPlayback();
                      const result = await saveDocuments({
                        sourceUris: [encodeURI(`file://${take.path}`)],
                        mimeType: "audio/mp4",
                        fileName: take.path.split(/[\\/]/).pop(),
                        copy: true
                      });
                      if (result.some((file) => file.error))
                        throw new Error("Save failed");
                    })
                  }
                />
                <Action
                  glass
                  label="×"
                  icon="trash-can-outline"
                  accessibilityLabel={t("DeleteTake")}
                  disabled={busy || take.processing}
                  onPress={() =>
                    Alert.alert(t("DeleteTake"), t("DeleteTakeHint"), [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("DeleteTake"),
                        style: "destructive",
                        onPress: () =>
                          void run(async () => {
                            await performanceAudio.remove(take.path);
                            await load();
                          })
                      }
                    ])
                  }
                />
              </View>
            </View>
          ))}
          {!!takes.length && recordControl}
          <Text style={styles.hint}>{t("RecordPerformanceHint")}</Text>
        </Sheet>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  elapsed: {
    color: palette.glass.ink,
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
    fontVariant: ["tabular-nums"]
  },
  recordImage: { width: "100%", height: "100%" },
  wave: {
    position: "absolute",
    top: 83,
    left: 0,
    right: 0,
    height: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: palette.gold.top,
    shadowColor: palette.gold.glow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 }
  },
  compactStage: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 12
  },
  compactRing: { width: 52, height: 52 },
  recordStage: { alignItems: "center", gap: 20, paddingVertical: 18 },
  recordRing: { width: 210, height: 210 },
  recordCaption: { color: palette.glass.ink, fontSize: 16 },
  hint: { fontSize: 14, lineHeight: 21, color: palette.glass.muted },
  card: {
    padding: 12,
    gap: 10,
    borderRadius: 18,
    backgroundColor: palette.glass.card,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  title: { fontSize: 16, color: palette.glass.ink, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
