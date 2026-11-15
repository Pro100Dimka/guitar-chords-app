import { getIn } from "formik";
import React from "react";
import { StyleSheet, TextInput, TextInputProps, View } from "react-native";
import Text from "../styled-text";
import palette from "../../theme/palette";

interface ITextFieldProps extends Pick<
  TextInputProps,
  "onFocus" | "onBlur" | "editable"
> {
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
  onFocus,
  onBlur,
  editable = true,
  placeholder,
  multiline = false,
  style = {},
  formik,
  name
}) => {
  const fieldValue = formik && name ? getIn(formik.values, name) : value;
  const handleChange =
    onChangeText ?? (formik && name ? formik.handleChange(name) : undefined);
  const error =
    formik && name
      ? getIn(formik.touched, name) && !!getIn(formik.errors, name)
      : null;
  const helperText =
    formik && name ? error && getIn(formik.errors, name) : null;
  const enabled = editable && !formik?.isSubmitting;

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
        editable={enabled}
        onChangeText={(text) => {
          if (enabled) handleChange?.(text);
        }}
        placeholder={placeholder}
        placeholderTextColor={palette.glass.muted}
        multiline={multiline}
        onFocus={onFocus}
        onBlur={
          onBlur ?? (formik && name ? formik.handleBlur(name) : undefined)
        }
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
