// src/components/database/crud/delete-item.ts
import { IDeleteItem } from "@/@interfaces";
import { db } from "../index";

const deleteItem = ({ tableName, filters }: IDeleteItem): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tableName) return reject(new Error("tableName is required"));
    if (!filters) return reject(new Error("filters (WHERE) is required"));
    const sql = `DELETE FROM ${tableName} WHERE ${filters}`;
    db.transaction((tx) => tx.executeSql(sql, []), reject, resolve);
  });
};

export default deleteItem;
