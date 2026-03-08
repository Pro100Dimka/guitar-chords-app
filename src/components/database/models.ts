// src/components/database/models.ts
import { IModels } from "@/@types";

const models: IModels = {
  settings: { fields: { key: "TEXT PRIMARY KEY", value: "TEXT" } },
  bands: {
    fields: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      name: "TEXT NOT NULL",
      search_text_lower: "TEXT"
    }
  },
  songs: {
    fields: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      band_id: "INTEGER",
      title: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      youtube_music: "TEXT",
      youtobe_lesson: "TEXT",
      search_text_lower: "TEXT"
    },
    foreignKeys: ["FOREIGN KEY (band_id) REFERENCES bands(id)"]
  }
};
export default models;
