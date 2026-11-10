import React, { FC, useEffect, useState } from "react";
import checkMicPermission from "@/components/permissions";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  AppState
} from "react-native";
import palette from "@/theme/palette";
import Tuner from "./tuner";
import { useIsFocused } from "@react-navigation/native";

const RequireMicAccess: FC = () => {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const [hasPermission, setHasPermission] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState ?? "active");
  const openAppSettings = async () =>
    Platform.OS === "ios"
      ? await Linking.openURL("app-settings:")
      : await Linking.openSettings();
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refreshPermission = async (requestPermission: boolean) => {
      if (pending) return;
      pending = true;
      try {
        const granted = await checkMicPermission(requestPermission);
        if (mounted) setHasPermission(granted);
      } catch (error) {
        console.error("Microphone permission check failed:", error);
        if (mounted) setHasPermission(false);
      } finally {
        pending = false;
      }
    };
    void refreshPermission(true);
    const subscription = AppState.addEventListener("change", (state) => {
      setAppState(state);
      if (state !== "active") setHasPermission(false);
      if (state === "active") void refreshPermission(false);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  if (!isFocused || appState !== "active") return null;
  return !hasPermission ? (
    <View style={styles.container}>
      <Text style={styles.errorText}>{t`ErrorMicAccess`}</Text>
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.8}
        onPress={openAppSettings}
      >
        <Text style={styles.buttonText}>{t`ConfigurePermissions`}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <Tuner />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    backgroundColor: palette.paper.background
  },
  errorText: {
    fontSize: 18,
    color: palette.chromatic.muted,
    textAlign: "center",
    marginBottom: 20
  },
  button: {
    backgroundColor: palette.chromatic.ink,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 14
  },
  buttonText: {
    color: palette.colors.primary,
    fontSize: 16,
    fontWeight: "bold"
  }
});

export default RequireMicAccess;
