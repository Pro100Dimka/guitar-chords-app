// src/components/database/crud/get-all-items.ts
import { IGetItems } from "@/@interfaces";
import { db } from "../index";

const getAllItems = <T = Record<string, unknown>>({
  tableName,
  fields = "*",
  filters = "",
  orderBy,
  page,
  limit,
  joins = [],
  parameters = []
}: IGetItems): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    let sql = `SELECT ${fields} FROM ${tableName}`;
    if (joins.length > 0) sql += " " + joins.join(" "); //  join если есть
    if (filters) sql += ` WHERE ${filters}`; //  фильтры
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    if (limit !== undefined) {
      const offset = page && page > 0 ? page * limit : 0;
      sql += ` LIMIT ${limit} OFFSET ${offset}`; // пагинация
    }
    const rows: T[] = [];
    db.transaction(
      (tx) => {
        tx.executeSql(sql, parameters, (_, result) => {
          for (let i = 0; i < result.rows.length; i++) {
            rows.push(result.rows.item(i));
          }
        });
      },
      reject,
      () => resolve(rows)
    );
  });
};
export default getAllItems;
