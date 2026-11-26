import React, { FC, useContext, useEffect, useState } from "react";
import checkMicPermission from "@/components/permissions";
import { useTranslation } from "react-i18next";
import {
  Alert,
  View,
  StyleSheet,
  Linking,
  Platform,
  AppState
} from "react-native";
import Text from "../../components/styled-text";
import palette from "@/theme/palette";
import Tuner from "./tuner";
import { useIsFocused } from "@react-navigation/native";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { Action } from "../song/tools";
import { TunerReadyContext } from "../../components/startup";

const RequireMicAccess: FC = () => {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const reportReady = useContext(TunerReadyContext);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState ?? "active");
  const openAppSettings = async () => {
    try {
      if (Platform.OS === "ios") await Linking.openURL("app-settings:");
      else await Linking.openSettings();
    } catch {
      Alert.alert(t("LinkOpenError"));
    }
  };
  useEffect(() => {
    let mounted = true;
    let pending = false;
    let queued = false;
    setCanRecord(false);
    const refreshPermission = async (request: boolean) => {
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      try {
        const granted = await checkMicPermission(request);
        if (mounted && !queued) {
          setHasPermission(granted);
          setCanRecord(granted);
        }
      } catch (error) {
        console.error("Microphone permission check failed:", error);
        if (mounted && !queued) {
          setHasPermission(false);
          setCanRecord(false);
        }
      } finally {
        pending = false;
        if (mounted && queued) {
          queued = false;
          void refreshPermission(false);
        }
      }
    };
    void refreshPermission(isFocused && AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      setAppState(state);
      setCanRecord(false);
      if (state === "active") {
        void refreshPermission(false);
      }
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [isFocused]);

  if (hasPermission === null) return null;
  if (!hasPermission && (!isFocused || appState !== "active")) return null;
  return !hasPermission ? (
    <View style={styles.container} onLayout={reportReady}>
      <MaterialCommunityIcons
        name="microphone-outline"
        size={64}
        color={palette.glass.accent}
      />
      <Text style={styles.errorText}>{t`ErrorMicAccess`}</Text>
      <Action
        primary
        label={t("ConfigurePermissions")}
        onPress={openAppSettings}
      />
    </View>
  ) : (
    <Tuner active={isFocused && appState === "active" && canRecord} />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 24,
    backgroundColor: palette.colors.transparent
  },
  errorText: {
    fontSize: 18,
    color: palette.chromatic.muted,
    textAlign: "center",
    lineHeight: 27,
    maxWidth: 360
  }
});

export default RequireMicAccess;
