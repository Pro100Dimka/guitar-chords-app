// src/components/database/initTables.ts
import models from "./models";
import { WebsqlDatabase } from "react-native-sqlite-2";

const initialSchema = Object.entries(models).map(
  ([tableName, { fields, foreignKeys }]) => {
    const columns = Object.entries(fields)
      .map(([k, t]) => `${k} ${t}`)
      .join(", ");
    const foreignSQL = foreignKeys?.length ? `, ${foreignKeys.join(", ")}` : "";
    return `CREATE TABLE IF NOT EXISTS ${tableName} (${columns}${foreignSQL});`;
  }
);

// Append migrations in version order. Existing migrations must remain unchanged.
const migrations = [initialSchema];

const initTables = (db: WebsqlDatabase) => {
  return new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql("PRAGMA user_version", [], (_, result) => {
          const version: number = result.rows.item(0).user_version;
          if (version > migrations.length) {
            throw new Error(
              "Database was created by a newer application version"
            );
          }
          migrations.slice(version).forEach((statements, index) => {
            statements.forEach((sql) => tx.executeSql(sql));
            tx.executeSql(`PRAGMA user_version = ${version + index + 1}`);
          });
        });
      },
      reject,
      resolve
    );
  });
};
export default initTables;
