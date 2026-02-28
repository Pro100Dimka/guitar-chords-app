import { FC } from "react";
import { StyleSheet, Text, TextProps } from "react-native";
import palette from "../theme/palette";

type StyledTextProps = TextProps;
const StyledText: FC<StyledTextProps> = (props) => (
  <Text {...props} style={[styles.base, props.style]} />
);

const styles = StyleSheet.create({
  base: { color: palette.primary.main }
});
export default StyledText;
