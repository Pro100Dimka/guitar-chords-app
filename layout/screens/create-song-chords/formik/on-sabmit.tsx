import { createData, updateData } from "@/database";
import initialValues from "./initial-values";

const onSabmit = async (
  { fk_band, id, ...values }: typeof initialValues,
  setIsEdit: (_: boolean) => void
) => {
  try {
    if (id) {
      await updateData("songs", { ...values, band_id: fk_band?.id }, { id });
      alert("Song updated!");
      if (setIsEdit) setIsEdit(false);
      return;
    }
    await createData("songs", { ...values, band_id: fk_band?.id });
    alert("Song saved!");
  } catch (err) {
    console.error(err);
    alert("Error saving song");
  }
};

export default onSabmit;
