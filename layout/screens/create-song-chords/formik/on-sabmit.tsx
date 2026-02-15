import { insertSong } from "@/database";
import initialValues from "./initial-values";

const onSabmit = async (values: typeof initialValues) => {
  try {
    await insertSong(values.title, values.content);
    alert("Song saved!");
  } catch (err) {
    console.error(err);
    alert("Error saving song");
  }
};

export default onSabmit;
