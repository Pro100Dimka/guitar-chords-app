// src/components/database/crud/update-item.ts
import { IUpdateItem } from "@/@interfaces";
import SQLite, { WebsqlDatabase } from "react-native-sqlite-2";
const db: WebsqlDatabase = SQLite.openDatabase("freetune.db");

const updateItem = ({
  tableName,
  data,
  filters
}: IUpdateItem): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    if (!data || Object.keys(data).length === 0)
      return reject(new Error("data is required"));
    if (!filters) return reject(new Error("filters (WHERE) is required"));
    // строим SET часть: "col1 = ?, col2 = ?"
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = Object.values(data);
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${filters}`;
    console.info("Executing SQL:", sql, values);
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        values,
        () => resolve(),
        (_, err) => {
          console.error(`Error updating table ${tableName}:`, err);
          reject(err);
          return false;
        }
      );
    });
  });
};
export default updateItem;
