import React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Text from "../styled-text";
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
        accessibilityLabel={label ?? placeholder}
        selectionColor={palette.glass.accent}
        keyboardAppearance="dark"
        style={[
          styles.input,
          multiline && styles.multiline,
          style?.input,
          error && styles.errorInput
        ]}
        value={fieldValue}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={palette.glass.muted}
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
  label: { color: palette.glass.muted, marginBottom: 6, fontSize: 14 },
  input: {
    fontFamily: palette.typography.body,
    minHeight: 48,
    backgroundColor: palette.glass.control,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    padding: 14,
    color: palette.glass.ink,
    fontSize: 16,

    width: "100%"
  },
  multiline: { minHeight: 220 },
  errorInput: { borderColor: palette.colors.red },
  error: { color: palette.colors.red, marginTop: 4, fontSize: 12 }
});

export default TextField;
