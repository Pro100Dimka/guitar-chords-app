import { FC } from "react";
import { StyleSheet, Text, TextProps } from "react-native";
import palette from "../theme/palette";

type StyledTextProps = TextProps;
const StyledText: FC<StyledTextProps> = (props) => {
  const style = StyleSheet.flatten(props.style);
  const strong = ["600", "700", "800", "900", "bold"].includes(
    String(style?.fontWeight)
  );
  return (
    <Text
      {...props}
      style={[
        styles.base,
        props.style,
        !style?.fontFamily && (strong ? styles.strong : styles.regular)
      ]}
    />
  );
};

const styles = StyleSheet.create({
  regular: { fontFamily: palette.typography.body, fontWeight: "400" },
  strong: { fontFamily: palette.typography.strong, fontWeight: "600" },
  base: { color: palette.glass.ink }
});
export default StyledText;
