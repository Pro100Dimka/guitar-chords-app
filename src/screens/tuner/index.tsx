import React, { FC, useEffect, useState } from "react";
import checkMicPermission from "@/components/permissions";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform
} from "react-native";
import palette from "@/theme/palette";
import Tuner from "./tuner";
import { useIsFocused } from "@react-navigation/native";

const RequireMicAccess: FC = () => {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const [hasPermission, setHasPermission] = useState(false);
  const openAppSettings = async () =>
    Platform.OS === "ios"
      ? await Linking.openURL("app-settings:")
      : await Linking.openSettings();
  useEffect(() => {
    checkMicPermission().then((hasPermission) => {
      setHasPermission(hasPermission);
      if (!hasPermission) {
        console.warn("Микрофон запрещён");
      }
    });
  }, []);

  if (!isFocused) return null;
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
    backgroundColor: palette.colors.bgInactive
  },
  errorText: {
    fontSize: 18,
    color: palette.colors.secondary,
    textAlign: "center",
    marginBottom: 20
  },
  button: {
    backgroundColor: palette.colors.bgActive,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5
  },
  buttonText: {
    color: palette.colors.primary,
    fontSize: 16,
    fontWeight: "bold"
  }
});

export default RequireMicAccess;
