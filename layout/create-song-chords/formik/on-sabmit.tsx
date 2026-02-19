import { createData, ISong, updateData } from "@/database";
import { t } from "@/locales";
import { router } from "expo-router";
import initialValues from "./initial-values";

const onSabmit = async (
  { fk_band, id, ...values }: typeof initialValues,
  setIsEdit: (_: boolean) => void
) => {
  try {
    if (id) {
      await updateData(
        "songs",
        {
          ...values,
          band_id: fk_band?.id,
          search_text_lower: values.title.toLowerCase()
        },
        { id }
      );
      alert(t`ElementChanged`);
      if (setIsEdit) setIsEdit(false);
      return;
    }
    const savedData: ISong = await createData("songs", {
      ...values,
      search_text_lower: values.title.toLowerCase(),
      band_id: fk_band?.id
    });
    alert(t`ElementAdded`);
    router.push({
      pathname: "/song/[id]",
      params: { id: savedData.id }
    });
  } catch (err) {
    console.error(err);
    alert(t`ErrorSavingSong`);
  }
};

export default onSabmit;
