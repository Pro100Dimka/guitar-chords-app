// src/components/database/initTables.ts
import models from "./models";
import { SQLTransaction, WebsqlDatabase } from "react-native-sqlite-2";

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
const migrations: (string[] | ((tx: SQLTransaction) => void))[] = [
  initialSchema,
  [
    "CREATE INDEX IF NOT EXISTS songs_title_order ON songs(title COLLATE NOCASE, id)",
    "CREATE INDEX IF NOT EXISTS songs_title_match ON songs(title)",
    "CREATE INDEX IF NOT EXISTS bands_name_match ON bands(name)"
  ],
  (tx) => {
    // Older libraries allowed missing search keys. SQLite LOWER alone does
    // not lowercase Cyrillic or other non-ASCII titles and artist names.
    for (const [table, field] of [
      ["songs", "title"],
      ["bands", "name"]
    ]) {
      tx.executeSql(
        `SELECT id, ${field} AS value FROM ${table} WHERE search_text_lower IS NULL OR search_text_lower = ''`,
        [],
        (_, result) => {
          for (let i = 0; i < result.rows.length; i++) {
            const row = result.rows.item(i);
            tx.executeSql(
              `UPDATE ${table} SET search_text_lower = ? WHERE id = ?`,
              [row.value.toLowerCase(), row.id]
            );
          }
        }
      );
    }
  }
];

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
            if (typeof statements === "function") statements(tx);
            else statements.forEach((sql) => tx.executeSql(sql));
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
