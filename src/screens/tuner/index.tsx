import React, { FC, useEffect, useState } from "react";
import checkMicPermission from "@/components/permissions";
import { useTranslation } from "react-i18next";
import { View, StyleSheet, Linking, Platform, AppState } from "react-native";
import Text from "../../components/styled-text";
import palette from "@/theme/palette";
import Tuner from "./tuner";
import { useIsFocused } from "@react-navigation/native";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { Action } from "../song/tools";

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
    <Tuner />
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
