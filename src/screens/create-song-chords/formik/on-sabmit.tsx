import { songFieldLimits } from "@/@interfaces";
import { NavigationProp } from "@/router";
import { t } from "../../../locales";
import { Alert } from "react-native";
import { db } from "@/components/database";
import { FormikHelpers } from "formik";
import type { FormValues } from "..";
import {
  defaultSongPreferences,
  normalizeSongPreferences,
  SongPreferences,
  suspendPreferenceSaving,
  usePreferences,
  writePreferences
} from "../../../components/preferences";

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
  let resume: ReturnType<typeof suspendPreferenceSaving> | undefined;
  let persisted: Record<string, SongPreferences> | undefined;
  let savedId = id;
  try {
    values.youtube_music = values.youtube_music ?? "";
    values.youtobe_lesson = values.youtobe_lesson ?? "";
    const performer = fk_band?.name.trim() ?? "";
    const fields = { ...values, band_name: performer };
    if (
      Object.entries(songFieldLimits).some(
        ([key, limit]) =>
          fields[key as keyof typeof songFieldLimits].length > limit
      )
    )
      throw new Error("FileTooLarge");
    resume = suspendPreferenceSaving();
    await new Promise<void>((resolve, reject) =>
      db.transaction(
        (tx) => {
          const saveSong = (bandId: string | number | null) => {
            const saveMetadata = (songId: number) => {
              savedId = songId;
              const state = usePreferences.getState();
              const preferences = normalizeSongPreferences({
                ...defaultSongPreferences,
                ...state.songs[songId],
                cover,
                contentSource,
                ...(capo !== undefined ? { capo, transpose: 0 } : {}),
                ...(sourceTuning ? { sourceTuning } : {})
              });
              persisted = { [songId]: preferences };
              writePreferences(tx, {
                ...state,
                songs: { ...state.songs, ...persisted }
              });
            };
            const data = [
              values.title,
              values.content,
              bandId,
              values.youtube_music,
              values.youtobe_lesson,
              values.title.toLowerCase()
            ];
            if (id)
              tx.executeSql(
                "UPDATE songs SET title = ?, content = ?, band_id = ?, youtube_music = ?, youtobe_lesson = ?, search_text_lower = ? WHERE id = ?",
                [...data, id],
                () => saveMetadata(id)
              );
            else
              tx.executeSql(
                "INSERT INTO songs (title, content, band_id, youtube_music, youtobe_lesson, search_text_lower) VALUES (?, ?, ?, ?, ?, ?)",
                data,
                (_, result) => saveMetadata(result.insertId)
              );
          };
          if (!performer || fk_band.id) {
            saveSong(performer ? fk_band.id : null);
            return;
          }
          tx.executeSql(
            "SELECT id FROM bands WHERE search_text_lower = ? LIMIT 1",
            [performer.toLowerCase()],
            (_, result) => {
              if (result.rows.length) saveSong(result.rows.item(0).id);
              else
                tx.executeSql(
                  "INSERT INTO bands (name, search_text_lower) VALUES (?, ?)",
                  [performer, performer.toLowerCase()],
                  (_, band) => saveSong(band.insertId)
                );
            }
          );
        },
        reject,
        resolve
      )
    );
    usePreferences.setState((state) => ({
      songs: { ...state.songs, ...persisted }
    }));
  } catch (error) {
    persisted = undefined;
    console.error(error);
    Alert.alert(t("ErrorSavingSong"));
    return false;
  } finally {
    resume?.(persisted);
  }
  Alert.alert(t(id ? "ElementChanged" : "ElementAdded"));
  if (id) setIsEdit?.(false);
  else navigation.replace("Song", { id: String(savedId) });
  return true;
};
export default onSabmit;
