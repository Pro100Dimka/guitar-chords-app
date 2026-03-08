// src/components/database/crud/get-all-items.ts
import { IGetItems } from "@/@interfaces";
import SQLite, { WebsqlDatabase } from "react-native-sqlite-2";

const db: WebsqlDatabase = SQLite.openDatabase("freetune.db");

const getAllItems = ({
  tableName,
  fields = "*",
  filters = "",
  page,
  limit,
  joins = []
}: IGetItems): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    let sql = `SELECT ${fields} FROM ${tableName}`;
    if (joins.length > 0) sql += " " + joins.join(" "); //  join если есть
    if (filters) sql += ` WHERE ${filters}`; //  фильтры
    if (limit !== undefined) {
      const offset = page && page > 0 ? (page - 1) * limit : 0;
      sql += ` LIMIT ${limit} OFFSET ${offset}`; // пагинация
    }
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        [],
        (_, result) => {
          const rows: any[] = [];
          for (let i = 0; i < result.rows.length; i++) {
            rows.push(result.rows.item(i));
          }
          resolve(rows);
        },
        (_, err) => {
          console.error("Error fetching items:", err);
          reject(err);
          return false;
        }
      );
    });
  });
};
export default getAllItems;
