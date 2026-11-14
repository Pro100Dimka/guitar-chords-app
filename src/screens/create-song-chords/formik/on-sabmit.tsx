import { songFieldLimits } from "@/@interfaces";
import { NavigationProp } from "@/router";
import { t } from "../../../locales";
import { Alert } from "react-native";
import {
  createItem,
  getAllItems,
  updateItem
} from "@/components/database/crud";
import { FormikHelpers } from "formik";
import { FormValues } from "..";
import { usePreferences } from "../../../components/preferences";

const onSabmit = async (
  _actions: FormikHelpers<FormValues>,
  {
    fk_band,
    id,
    cover,
    contentSource,
    capo,
    sourceTuning,
    ...values
  }: FormValues,
  navigation: Pick<NavigationProp, "replace">,
  setIsEdit?: (_: boolean) => void
) => {
  try {
    const fields = { ...values, band_name: fk_band?.name ?? "" };
    if (
      Object.entries(songFieldLimits).some(
        ([key, limit]) =>
          fields[key as keyof typeof songFieldLimits].length > limit
      )
    )
      throw new Error("FileTooLarge");
    const performer = fk_band?.name.trim() ?? "";
    let bandId: string | number | null = performer ? fk_band.id || null : null;
    if (performer && !bandId) {
      const [existing] = await getAllItems<{ id: number }>({
        tableName: "bands",
        filters: "search_text_lower = ?",
        parameters: [performer.toLowerCase()],
        limit: 1
      });
      bandId =
        existing?.id ??
        (
          await createItem({
            tableName: "bands",
            data: {
              name: performer,
              search_text_lower: performer.toLowerCase()
            }
          })
        ).insertId;
    }
    if (id) {
      await updateItem({
        tableName: "songs",
        data: {
          ...values,
          band_id: bandId,
          search_text_lower: (values?.title || "")?.toLowerCase()
        },
        filters: `id = ${id}`
      });
      usePreferences.getState().updateSong(id, {
        cover,
        contentSource,
        ...(capo !== undefined ? { capo, transpose: 0 } : {}),
        ...(sourceTuning ? { sourceTuning } : {})
      });
      Alert.alert(t`ElementChanged`);
      if (setIsEdit) setIsEdit(false);
      return;
    }
    const { insertId } = await createItem({
      tableName: "songs",
      data: {
        ...values,
        search_text_lower: (values?.title || "").toLowerCase(),
        band_id: bandId
      }
    });
    usePreferences.getState().updateSong(insertId, {
      cover,
      contentSource,
      ...(capo !== undefined ? { capo, transpose: 0 } : {}),
      ...(sourceTuning ? { sourceTuning } : {})
    });
    Alert.alert(t`ElementAdded`);
    navigation.replace("Song", { id: insertId.toString() });
  } catch (err) {
    console.error(err);
    Alert.alert(t`ErrorSavingSong`);
  }
};

export default onSabmit;
