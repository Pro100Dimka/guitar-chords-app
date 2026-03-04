import React from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform
} from "react-native";
import Colors from "../colors";

const RequireMicAccess = () => {
  const { t } = useTranslation();

  const openAppSettings = () =>
    Platform.OS === "ios"
      ? Linking.openURL("app-settings:")
      : Linking.openSettings();
  return (
    <View style={styles.container}>
      <Text style={styles.errorText}>{t`ErrorMicAccess`}</Text>
      <TouchableOpacity style={styles.button} onPress={openAppSettings}>
        <Text style={styles.buttonText}>{t`ConfigurePermissions`}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    backgroundColor: Colors.bgInactive
  },
  errorText: {
    fontSize: 18,
    color: Colors.secondary,
    textAlign: "center",
    marginBottom: 20
  },
  button: {
    backgroundColor: Colors.bgActive,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5
  },
  buttonText: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: "bold"
  }
});

export default RequireMicAccess;
