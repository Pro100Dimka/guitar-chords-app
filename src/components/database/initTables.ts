// src/components/database/initTables.ts
import { IModel } from "@/@interfaces";
import models from "./models";
import SQLite, { WebsqlDatabase } from "react-native-sqlite-2";

const db: WebsqlDatabase = SQLite.openDatabase("freetune.db");

const createTable = async (tableName: string, model: IModel) => {
  const { fields, foreignKeys } = model;
  const columns = Object.entries(fields)
    .map(([k, t]) => `${k} ${t}`)
    .join(", ");
  const foreignSQL = foreignKeys?.length ? `, ${foreignKeys.join(", ")}` : "";
  const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns}${foreignSQL});`;
  return new Promise<void>((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        [],
        () => {
          console.info(`Table ${tableName} created ✅`);
          resolve();
        },
        (_, error) => {
          console.error(`Error creating table ${tableName}:`, error);
          reject(error);
          return false; // important for react-native-sqlite-2
        }
      );
    });
  });
};
const initTables = async () => {
  for (const [tableName, model] of Object.entries(models)) {
    await createTable(tableName, model);
  }
};
export default initTables;
