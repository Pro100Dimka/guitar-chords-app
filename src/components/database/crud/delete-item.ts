// src/components/database/crud/delete-item.ts
import { IDeleteItem } from "@/@interfaces";
import SQLite, { WebsqlDatabase } from "react-native-sqlite-2";
const db: WebsqlDatabase = SQLite.openDatabase("freetune.db");

const deleteItem = ({ tableName, filters }: IDeleteItem): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    if (!filters) return reject(new Error("filters (WHERE) is required"));
    const sql = `DELETE FROM ${tableName} WHERE ${filters}`;
    console.info("Executing SQL:", sql);
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        [],
        () => resolve(),
        (_, err) => {
          console.error(`Error deleting from ${tableName}:`, err);
          reject(err);
          return false;
        }
      );
    });
  });
};

export default deleteItem;
