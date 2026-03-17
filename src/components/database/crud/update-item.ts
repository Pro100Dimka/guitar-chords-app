// src/components/database/crud/update-item.ts
import { IUpdateItem } from "@/@interfaces";
import { db } from "../index";

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
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = Object.values(data);
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${filters}`;
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
