import { Skia, TextAlign, useFonts } from "@shopify/react-native-skia";
import fontFamilies from "@/../assets/fonts/index";

export const useParagraphBuilder = () => {
  const fonts = useFonts(fontFamilies);
  const centered = (
    text: string,
    fontSize: number,
    weight: number,
    color: string
  ) =>
    fonts &&
    Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fonts)
      .pushStyle({
        fontSize,
        fontFamilies: ["Roboto"],
        fontStyle: { weight },
        color: Skia.Color(color)
      })
      .addText(text)
      .build();

  return { centered };
};
