import { openDatabaseSync } from "expo-sqlite";

const db = openDatabaseSync("chords.db");

export const initDB = async () => {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL
    );`
  );
  console.info("DB initialized");
};

export const insertSong = async (title: string, content: string) => {
  return await db.runAsync(
    `INSERT INTO songs (title, content) VALUES (?, ?);`,
    [title, content]
  );
};

export const fetchSongs = async () => {
  return await db.getAllAsync(`SELECT * FROM songs;`);
};
export interface ISong {
  id: number;
  title: string;
  content: string;
}
