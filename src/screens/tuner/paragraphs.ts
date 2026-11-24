import { Skia, TextAlign, useFonts } from "@shopify/react-native-skia";
import { useCallback } from "react";
import fontFamilies from "../../../assets/fonts/index";

export const useParagraphBuilder = () => {
  const fonts = useFonts(fontFamilies);
  const centered = useCallback(
    (text: string, fontSize: number, weight: number, color: string) =>
      fonts &&
      Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fonts)
        .pushStyle({
          fontSize,
          fontFamilies: ["Roboto"],
          fontStyle: { weight },
          color: Skia.Color(color)
        })
        .addText(text)
        .build(),
    [fonts]
  );

  return { centered, fonts };
};
