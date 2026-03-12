// src/components/database/crud/create-item.ts
import { ICreateItem } from "@/@interfaces";
import { db } from "../index";

const createItem = ({ tableName, data }: ICreateItem): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    if (!data || Object.keys(data).length === 0)
      return reject(new Error("data is required"));
    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ");
    const values = Object.values(data);
    const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    console.info("Executing SQL:", sql, values);
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        values,
        (_, result) => resolve(result),
        (_, err) => {
          console.error("Error inserting item:", err);
          reject(err);
          return false;
        }
      );
    });
  });
};
export default createItem;
