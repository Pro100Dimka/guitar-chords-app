import { openDatabaseSync } from "expo-sqlite";

const db = openDatabaseSync("chords.db");

export const initDB = async () => {
  const tableSProps = [
    [
      "bands",
      "id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, search_text_lower TEXT"
    ],
    [
      "songs",
      "id INTEGER PRIMARY KEY NOT NULL, band_id INTEGER, title TEXT NOT NULL, content TEXT NOT NULL, youtobe_link_music TEXT, youtobe_link_chords TEXT, search_text_lower TEXT"
    ]
  ];
  for (const [tableName, tableProps] of tableSProps) {
    // await db.execAsync(`DROP TABLE IF EXISTS ${tableName};`);
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${tableName} (${tableProps});`
    );
    const columnName = "search_text_lower";
    const columns = await db.getAllAsync(`PRAGMA table_info(${tableName});`);
    const columnExists = columns.some((col: any) => col.name === columnName);
    if (!columnExists) {
      await db.execAsync(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} TEXT;`
      );
    }
  }
  console.info(
    `Database initialized with tables: ${tableSProps.map(([name]) => name).join(", ")}`
  );
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
export interface IFetchDataParams {
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
  const str = `SELECT ${fields ? fields : "*"} FROM ${tableName} ${join ? `JOIN ${join}` : " "} ${filters ? "WHERE " + filters : " "} LIMIT ${limit} OFFSET ${page * limit};`;
  return await db.getAllAsync(str);
};
export const fetchDataById = async <T>(
  params: IFetchDataByIdParams
): Promise<T> => {
  const { tableName, data, fields, join } = params;
  const keys = Object.keys(data);
  const values = Object.values(data);
  const conditions = keys.map((key) => `${key} = ?`).join(" AND ");
  const result = await db.getAllAsync(
    `SELECT ${fields ? fields : "*"} FROM ${tableName} ${join ? `JOIN ${join}` : " "} ${conditions ? "WHERE " + conditions : ""};`,
    values
  );
  return result[0] as T;
};
let queue = Promise.resolve();

export const createData = async <T>(
  tableName: string,
  data: Record<string, any>
): Promise<T> => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const columns = keys.join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  let lastInsertId = 0;
  queue = queue.then(async () => {
    const result = await db.runAsync(
      `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders});`,
      values
    );
    lastInsertId = result.lastInsertRowId;
  });

  await queue; // ждём выполнения всех предыдущих запросов

  return { id: lastInsertId, ...data } as T;
};
export const updateData = async (
  tableName: string,
  updatedData: Record<string, any>,
  conditions: Record<string, any>
) => {
  const updateSet = Object.keys(updatedData)
    .map((key) => `${key} = ?`)
    .join(", ");
  const conditionsSet = Object.keys(conditions)
    .map((key) => `${key} = ?`)
    .join(" AND ");
  await db.runAsync(
    `UPDATE ${tableName} SET ${updateSet} WHERE ${conditionsSet};`,
    [
      ...Object.values(updatedData).map((v) => v ?? null),
      ...Object.values(conditions).map((v) => v ?? null)
    ]
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
