import { openDatabaseSync } from "expo-sqlite";

const db = openDatabaseSync("chords.db");

export const initDB = async () => {
  const tableSProps = [
    ["bands", "id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL"],
    [
      "songs",
      "id INTEGER PRIMARY KEY NOT NULL, band_id INTEGER, title TEXT NOT NULL, content TEXT NOT NULL, youtobe_link_music TEXT, youtobe_link_chords TEXT"
    ]
  ];
  for (const [tableName, tableProps] of tableSProps) {
    // await db.execAsync(`DROP TABLE IF EXISTS ${tableName};`);
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${tableName} (${tableProps});`
    );
  }
  console.info(
    `Database initialized with tables: ${tableSProps.map(([name]) => name).join(", ")}`
  );
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
  youtobe_link_music?: string;
  youtobe_link_chords?: string;
  fk_band?: IBand;
  band_id?: number;
  band_name?: string;
}
export interface IBand {
  id: number;
  name: string;
}
interface IFetchDataParams {
  tableName?: string;
  fields?: string;
  filters?: string;
  page?: number;
  limit?: number;
  join?: string;
}
interface IFetchDataByIdParams {
  tableName?: string;
  data: Record<string, any>;
  fields?: string;
  join?: string;
}
export const fetchData = async <T>(params: IFetchDataParams): Promise<T[]> => {
  const { tableName, fields, filters, page = 0, limit = 10, join } = params;
  return await db.getAllAsync(
    `SELECT ${fields ? fields : "*"} FROM ${tableName} ${join ? `JOIN ${join}` : " "}${filters ? "WHERE " + filters : ""} LIMIT ? OFFSET ?;`,
    [limit, page * limit]
  );
};
export const fetchDataById = async <T>(
  params: IFetchDataByIdParams
): Promise<T> => {
  const { tableName, data, fields, join } = params;
  const keys = Object.keys(data);
  const values = Object.values(data);
  const conditions = keys.map((key) => `${key} = ?`).join(" AND ");
  const result = await db.getAllSync(
    `SELECT ${fields ? fields : "*"} FROM ${tableName} ${join ? `JOIN ${join}` : " "} ${conditions ? "WHERE " + conditions : ""};`,
    values
  );
  return result[0] as T;
};
export const createData = async <T>(
  tableName: string,
  data: Record<string, any>
): Promise<T> => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const columns = keys.join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const result = await db.runAsync(
    `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders});`,
    values
  );
  return {
    id: result.lastInsertRowId,
    ...data
  } as T;
};
export const updateData = async (
  tableName: string,
  updatedData: Record<string, any>,
  conditions: Record<string, any>
) => {
  const updateKeys = Object.keys(updatedData);
  const updateValues = Object.values(updatedData).map((v) => v ?? null); // защита от undefined
  const conditionKeys = Object.keys(conditions);
  const conditionValues = Object.values(conditions).map((v) => v ?? null);

  const updateSet = updateKeys.map((key) => `${key} = ?`).join(", ");
  const conditionsSet = conditionKeys.map((key) => `${key} = ?`).join(" AND ");
  await db.runAsync(
    `UPDATE ${tableName} SET ${updateSet} WHERE ${conditionsSet};`,
    [...updateValues, ...conditionValues]
  );
};
export const deleteData = async (
  tableName: string,
  data: Record<string, any>
) => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const conditions = keys.map((key) => `${key} = ?`).join(" AND ");
  await db.runAsync(`DELETE FROM ${tableName} WHERE ${conditions};`, values);
};
