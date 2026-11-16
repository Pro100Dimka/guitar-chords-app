// src/components/database/crud/update-item.ts
import { IUpdateItem } from "@/@interfaces";
import { db } from "../index";
import { queryScope } from "./query";

const updateItem = ({
  tableName,
  data,
  filters,
  parameters = []
}: IUpdateItem): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    if (!data || Object.keys(data).length === 0)
      return reject(new Error("data is required"));
    if (!filters) return reject(new Error("filters (WHERE) is required"));
    const scope = queryScope(tableName);
    Object.keys(data).forEach(scope.column);
    scope.where(filters, parameters);
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = [...Object.values(data), ...parameters];
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${filters}`;
    db.transaction((tx) => tx.executeSql(sql, values), reject, resolve);
  });
};
export default updateItem;
