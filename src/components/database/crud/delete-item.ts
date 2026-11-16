// src/components/database/crud/delete-item.ts
import { IDeleteItem } from "@/@interfaces";
import { db } from "../index";
import { queryScope } from "./query";

const deleteItem = ({
  tableName,
  filters,
  parameters = []
}: IDeleteItem): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    if (!filters) return reject(new Error("filters (WHERE) is required"));
    queryScope(tableName).where(filters, parameters);
    const sql = `DELETE FROM ${tableName} WHERE ${filters}`;
    db.transaction((tx) => tx.executeSql(sql, parameters), reject, resolve);
  });
};

export default deleteItem;
