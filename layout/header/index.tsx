import StyledText from "@/components/styled-text";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

const Header = () => {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <StyledText style={{ fontSize: 24, fontWeight: "bold" }}>
        {t`headerTitle`}
      </StyledText>
    </View>
  );
};
export default Header;
