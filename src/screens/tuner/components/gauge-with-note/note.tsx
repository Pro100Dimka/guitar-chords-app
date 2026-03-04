import { Group, RoundedRect, Paragraph } from "@shopify/react-native-skia";
import { FC } from "react";
import Colors from "../../colors";
import { IGaugeTextProps, ITextItem } from "@/@interfaces";
import { useParagraphBuilder } from "../../paragraphs";
import { ParagraphProps } from "@/@types";

const { primary, secondary } = Colors;
export const [wdth, hght, nfnt] = [80, 90, 54];

const GaugeNote: FC<IGaugeTextProps> = (props) => {
  const { currentString, pitch, gaugeDeviation = 0, gaugeColor, width } = props;
  const centerX = width / 2 - wdth / 2;
  const { centered } = useParagraphBuilder();
  const { freq, note } = currentString ?? {};
  const getParagraphs = (): ITextItem[] => {
    const diff =
      freq && gaugeDeviation && `${Math.abs(pitch! - freq).toFixed(1)}Hz`;
    const items: ParagraphProps[] = [
      [
        [note?.name ?? "-", nfnt, 600, primary],
        [0, centerX, wdth]
      ],
      [
        [`${freq?.toFixed(1) ?? "-"}Hz`, 14, 500, primary],
        [hght - 20, centerX, wdth]
      ],
      diff && [
        [`${gaugeDeviation > 0 ? "+" : "-"}${diff}`, 12, 100, gaugeColor],
        [hght - 20, centerX + (pitch! >= freq! ? wdth + 10 : -wdth), wdth]
      ]
    ].filter((item): item is ParagraphProps => Boolean(item));
    return items.map(([p, [y, x, w]]) => ({ p, y, x, w }) as ITextItem);
  };

  return (
    <Group transform={[{ translateY: 15 }]}>
      <RoundedRect
        x={centerX}
        width={wdth}
        y={0}
        r={10}
        height={hght}
        color={secondary}
      />
      {getParagraphs().map(({ p, y, x = centerX, w = wdth }, i) => (
        <Paragraph key={i} x={x} y={y} width={w} paragraph={centered(...p)} />
      ))}
    </Group>
  );
};
export default GaugeNote;
