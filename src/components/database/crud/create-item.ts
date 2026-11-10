// src/components/database/crud/create-item.ts
import { ICreateItem } from "@/@interfaces";
import { db } from "../index";
import { SQLResultSet } from "react-native-sqlite-2";

const createItem = ({
  tableName,
  data
}: ICreateItem): Promise<SQLResultSet> => {
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
    let result: SQLResultSet;
    db.transaction(
      (tx) =>
        tx.executeSql(sql, values, (_, value) => {
          result = value;
        }),
      reject,
      () => resolve(result)
    );
  });
};
export default createItem;
