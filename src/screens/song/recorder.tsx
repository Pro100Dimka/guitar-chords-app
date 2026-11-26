import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
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
import { waitForAppActive } from "../../components/song-autofill/recognition";
import checkMicPermission from "../../components/permissions";
import { fileCanceled } from "../../components/library-files";
import palette from "../../theme/palette";

export default function SongRecorder({
  songId,
  active,
  controlsEnabled = active,
  browseOnly = false,
  onStart,
  open = false,
  onOpened
}: {
  songId: number;
  active: boolean;
  controlsEnabled?: boolean;
  browseOnly?: boolean;
  onStart: () => void;
  open?: boolean;
  onOpened?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [playing, setPlaying] = useState("");
  const playingRef = useRef("");
  const playbackRequest = useRef<AbortController | null>(null);
  const recordingRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const foreground = useRef(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive"
  );
  const listDirty = useRef(false);
  const mounted = useRef(true);
  const operation = useRef(false);
  const opening = useRef<AbortController | null>(null);
  const pendingStart = useRef<AbortController | null>(null);
  const listRequest = useRef(0);
  const stopOwnedPlayback = useCallback(() => {
    const pending = playbackRequest.current;
    pending?.abort();
    playbackRequest.current = null;
    if (pending || playingRef.current) performanceAudio.stopPlayback();
    playingRef.current = "";
    if (mounted.current) setPlaying("");
  }, []);
  const reportListError = useCallback(() => {
    if (
      mounted.current &&
      activeRef.current &&
      visibleRef.current &&
      foreground.current
    )
      Alert.alert(t("RecordingError"));
  }, [t]);
  useEffect(() => {
    listRequest.current++;
    setTakes([]);
  }, [songId]);
  const load = useCallback(async () => {
    listDirty.current = false;
    const request = ++listRequest.current;
    try {
      const files = await performanceAudio.list(songId);
      if (mounted.current && request === listRequest.current) setTakes(files);
    } catch (error) {
      if (!mounted.current || request !== listRequest.current) return;
      listDirty.current = true;
      throw error;
    }
  }, [songId]);
  useEffect(() => {
    if (!open || !active) return;
    setVisible(true);
    void load().catch(reportListError);
    onOpened?.();
  }, [open, active, load, onOpened, reportListError]);
  useEffect(() => {
    if (visible && active && foreground.current && listDirty.current)
      void load().catch(reportListError);
  }, [visible, active, load, reportListError]);
  const run = async (action: () => Promise<void>) => {
    if (operation.current || !mounted.current || !activeRef.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (
        !fileCanceled(error) &&
        mounted.current &&
        activeRef.current &&
        foreground.current &&
        !pendingStart.current?.signal.aborted
      )
        Alert.alert(t("RecordingError"), t("RecordingErrorHint"));
    } finally {
      pendingStart.current = null;
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (!playingRef.current) setPlaying("");
    const listener = performanceAudio.listen((event) => {
      if (event.state === "stopped" || event.state === "playbackInterrupted") {
        playingRef.current = "";
        setPlaying("");
        if (event.state === "playbackInterrupted") {
          playbackRequest.current?.abort();
          playbackRequest.current = null;
        }
      }
      const file = event.uri?.split(/[\\/]/).pop();
      const owner = /^song-(\d+)-/.exec(file ?? "");
      if (owner && Number(owner[1]) !== songId) return;
      if (["processing", "error", "interrupted"].includes(event.state)) {
        pendingStart.current?.abort();
        recordingRef.current = false;
        setRecording(false);
      }
      if (
        [
          "processing",
          "saved",
          "error",
          "processingFailed",
          "interrupted"
        ].includes(event.state)
      ) {
        listDirty.current = true;
        if (activeRef.current && visibleRef.current && foreground.current)
          void load().catch(reportListError);
        if (activeRef.current) {
          if (event.state === "error")
            Alert.alert(t("RecordingError"), t("RecordingErrorHint"));
          if (event.state === "interrupted")
            Alert.alert(t("RecordingInterrupted"));
          if (event.state === "processingFailed")
            Alert.alert(t("RecordingPolishFailed"));
        }
      }
    });
    const background = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (state !== "active") {
        opening.current?.abort();
        stopOwnedPlayback();
        if (recordingRef.current)
          void performanceAudio.stop().catch(() => undefined);
      } else if (activeRef.current && visibleRef.current && listDirty.current) {
        void load().catch(reportListError);
      }
    });
    return () => {
      mounted.current = false;
      opening.current?.abort();
      pendingStart.current?.abort();
      listener.remove();
      background.remove();
      stopOwnedPlayback();
      if (recordingRef.current)
        void performanceAudio.stop().catch(() => undefined);
    };
  }, [load, reportListError, songId, stopOwnedPlayback, t]);
  useEffect(() => {
    if (!active) {
      opening.current?.abort();
      pendingStart.current?.abort();
      setVisible(false);
      stopOwnedPlayback();
      if (recordingRef.current)
        void performanceAudio.stop().catch(() => undefined);
    }
  }, [active, stopOwnedPlayback]);
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
            const controller = new AbortController();
            pendingStart.current = controller;
            const granted = await checkMicPermission(true);
            if (controller.signal.aborted) return;
            if (!granted) {
              Alert.alert(t("ErrorMicAccess"), t("ConfigurePermissions"), [
                { text: t("Cancel"), style: "cancel" },
                {
                  text: t("ConfigurePermissions"),
                  onPress: () => void Linking.openSettings()
                }
              ]);
              return;
            }
            await waitForAppActive(controller.signal);
            if (
              controller.signal.aborted ||
              !mounted.current ||
              !activeRef.current ||
              AppState.currentState !== "active"
            )
              return;
            performanceAudio.stopPlayback();
            await performanceAudio.start(songId);
            recordingRef.current = true;
            if (
              controller.signal.aborted ||
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
          source={require("../../../assets/images/gold-record-button.webp")}
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
      {!browseOnly && (
        <Action
          glass
          compact
          label={recording ? `■ ${time}` : t("RecordPerformance")}
          icon={recording ? "stop" : "record-circle"}
          accessibilityLabel={t(
            recording ? "StopRecording" : "RecordPerformance"
          )}
          selected={recording}
          disabled={busy || !controlsEnabled}
          onPress={() =>
            void run(async () => {
              const request = new AbortController();
              opening.current = request;
              if (recording) {
                await performanceAudio.stop();
                recordingRef.current = false;
                setRecording(false);
              }
              await load();
              if (
                mounted.current &&
                activeRef.current &&
                !request.signal.aborted
              )
                setVisible(true);
            })
          }
        />
      )}
      {recording && <Text style={styles.elapsed}>{time}</Text>}
      {visible && active && (
        <Sheet
          musical
          scrollable={false}
          title={t(takes.length ? "MyRecordings" : "RecordPerformance")}
          onClose={() => {
            if (!busy) {
              stopOwnedPlayback();
              setVisible(false);
            }
          }}
        >
          <FlatList
            data={takes}
            keyExtractor={(take) => take.path}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            contentContainerStyle={styles.takes}
            ListFooterComponent={browseOnly ? null : recordControl}
            renderItem={({ item: take }) => (
              <View key={take.path} style={styles.card}>
                <Text style={styles.title}>
                  {new Date(take.date).toLocaleString(
                    i18n.language === "ua" ? "uk" : i18n.language
                  )}
                </Text>
                {take.interrupted && (
                  <Text style={styles.hint}>{t("RecordingInterrupted")}</Text>
                )}
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
                        if (playingRef.current === take.path) {
                          stopOwnedPlayback();
                          return;
                        }
                        const request = new AbortController();
                        playbackRequest.current = request;
                        try {
                          await performanceAudio.play(take.path);
                          if (
                            request.signal.aborted ||
                            !mounted.current ||
                            !activeRef.current ||
                            AppState.currentState !== "active"
                          ) {
                            // Native playTake starts on its serial queue before
                            // resolving. A cancelled request has already issued
                            // its stop; a late response must not stop new audio.
                            if (playbackRequest.current === request)
                              stopOwnedPlayback();
                            return;
                          }
                          playingRef.current = take.path;
                          setPlaying(take.path);
                        } catch (error) {
                          if (!request.signal.aborted) throw error;
                        } finally {
                          if (playbackRequest.current === request)
                            playbackRequest.current = null;
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
                        stopOwnedPlayback();
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
                              if (!(await performanceAudio.remove(take.path)))
                                throw new Error("RecordingDeleteFailed");
                              await load();
                            })
                        }
                      ])
                    }
                  />
                </View>
              </View>
            )}
          />
        </Sheet>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  takes: { gap: 12, padding: 16, paddingBottom: 24 },
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
