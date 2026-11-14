import { Group } from "@shopify/react-native-skia";
import { FC } from "react";
import { SharedValue } from "react-native-reanimated";
import CurrentNote from "./current-note";
import { INote, IString } from "@/@interfaces";

const NoteIndicator: FC<{
  note: SharedValue<INote | null>;
  fill: SharedValue<number>;
  rms: SharedValue<number>;
  currString: IString | null;
  width: number;
  height: number;
  availableHeight?: number;
  onReady?: () => void;
}> = ({
  note,
  fill,
  rms,
  currString,
  width,
  height,
  availableHeight,
  onReady
}) => {
  return (
    <Group>
      <CurrentNote
        fill={fill}
        rms={rms}
        width={width}
        height={height}
        availableHeight={availableHeight}
        onReady={onReady}
        note={note}
        name={currString?.name}
      />
    </Group>
  );
};
export default NoteIndicator;
