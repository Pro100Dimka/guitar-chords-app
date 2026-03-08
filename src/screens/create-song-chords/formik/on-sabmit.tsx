import { NavigationProp } from "@/router";
import { t } from "../../../locales";
import initialValues from "./initial-values";
import { Alert } from "react-native";
import { createItem, updateItem } from "@/components/database/crud";
import { FormikHelpers } from "formik";
import { FormValues } from "..";

const onSabmit = async (
  actions: FormikHelpers<FormValues>,
  { fk_band, id, ...values }: typeof initialValues,
  navigation: NavigationProp,
  setIsEdit?: (_: boolean) => void
) => {
  try {
    if (id) {
      await updateItem({
        tableName: "songs",
        data: {
          ...values,
          band_id: fk_band?.id,
          search_text_lower: (values?.title || "")?.toLowerCase()
        },
        filters: `id = ${id}`
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
        band_id: fk_band?.id
      }
    });
    Alert.alert(t`ElementAdded`);
    navigation.navigate("Song", { id: insertId.toString() });
    actions.resetForm();
  } catch (err) {
    console.error(err);
    Alert.alert(t`ErrorSavingSong`);
  }
};

export default onSabmit;
