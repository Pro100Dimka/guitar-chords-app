// src/components/database/crud/get-all-items.ts
import { IGetItems } from "@/@interfaces";
import { db } from "../index";
import { queryScope } from "./query";

const getAllItems = <T = Record<string, unknown>>({
  tableName,
  fields = "*",
  filters = "",
  orderBy,
  page,
  limit,
  ids,
  joins = [],
  parameters = []
}: IGetItems): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    const scope = queryScope(tableName, joins);
    scope.fields(fields);
    scope.where(filters, parameters);
    const idColumn = `${tableName.split(" ").at(-1)}.id`;
    if (ids !== undefined) {
      scope.column(idColumn);
      if (
        !Array.isArray(ids) ||
        !ids.every((id) => Number.isSafeInteger(id) && id > 0)
      )
        throw new Error("Invalid record identifiers");
    }
    if (orderBy) scope.order(orderBy);
    if (
      [page, limit].some(
        (value) =>
          value !== undefined && (!Number.isSafeInteger(value) || value < 0)
      )
    )
      throw new Error("Invalid pagination");
    let sql = `SELECT ${fields} FROM ${tableName}`;
    if (joins.length > 0) sql += " " + joins.join(" "); //  join если есть
    if (filters) sql += ` WHERE ${filters}`; //  фильтры
    if (ids !== undefined)
      sql += `${filters ? " AND" : " WHERE"} ${idColumn} IN (${ids.join(",") || "NULL"})`;
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
