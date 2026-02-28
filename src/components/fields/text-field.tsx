import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import palette from "../../theme/palette";

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
        placeholderTextColor={palette.colors.placeholder}
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
  label: { color: palette.colors.label, marginBottom: 6, fontSize: 14 },
  input: {
    backgroundColor: palette.colors.input,
    borderRadius: 12,
    padding: 10,
    color: palette.colors.text,
    fontSize: 16,
    fontFamily: "Tahoma",
    width: "100%"
  },
  multiline: { minHeight: 150, fontFamily: "Tahoma" },
  errorInput: { borderColor: palette.colors.red },
  error: { color: palette.colors.red, marginTop: 4, fontSize: 12 }
});

export default TextField;
