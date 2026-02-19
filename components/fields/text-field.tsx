import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

export const COLORS = {
  input: "rgba(0,0,0,0.35)",
  label: "#ddd",
  text: "#fff",
  placeholder: "#aaa"
};

interface ITextFieldProps {
  label?: string;
  value?: string; // для обычного контролируемого поля
  onChangeText?: (_: string) => void;
  placeholder?: string;
  multiline?: boolean;
  style?: {
    container?: object;
    input?: object;
  };
  // Formik props
  formik?: any;
  name?: string;
}

const TextField: React.FC<ITextFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  style = {},
  formik,
  name
}) => {
  const fieldValue = formik && name ? formik.values[name] : value;
  const handleChange =
    formik && name ? formik.handleChange(name) : onChangeText;
  const error =
    formik && name ? formik.touched[name] && !!formik.errors[name] : null;
  const helperText = formik && name ? error && formik.errors[name] : null;

  return (
    <View style={[styles.container, style?.container]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          multiline && styles.multiline,
          style?.input,
          error && styles.errorInput
        ]}
        value={fieldValue}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.placeholder}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {formik && name && helperText && (
        <Text style={styles.error}>{helperText}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { color: COLORS.label, marginBottom: 6, fontSize: 14 },
  input: {
    backgroundColor: COLORS.input,
    borderRadius: 12,
    padding: 10,
    color: COLORS.text,
    fontSize: 16,
    fontFamily: "Tahoma",
    width: "100%"
  },
  multiline: { minHeight: 150, fontFamily: "Tahoma" },
  errorInput: {
    borderColor: "red"
  },
  error: { color: "red", marginTop: 4, fontSize: 12 }
});

export default TextField;
