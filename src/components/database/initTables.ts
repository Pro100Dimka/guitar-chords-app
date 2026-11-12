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
const migrations = [
  initialSchema,
  [
    `CREATE TABLE IF NOT EXISTS song_audio (
      song_id INTEGER PRIMARY KEY REFERENCES songs(id),
      sha256 TEXT NOT NULL UNIQUE,
      file_name TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      duration REAL NOT NULL,
      analysis_json TEXT,
      generated_json TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      manually_edited INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audio_analysis_jobs (
      id TEXT PRIMARY KEY,
      song_id INTEGER NOT NULL UNIQUE REFERENCES songs(id),
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      server_job_id TEXT,
      server_url TEXT NOT NULL,
      error TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    )`,
    // The existing app does not enable SQLite foreign_keys on every connection.
    // A trigger keeps deletion safe for its existing CRUD paths as well.
    `CREATE TRIGGER IF NOT EXISTS delete_song_audio AFTER DELETE ON songs BEGIN
      DELETE FROM audio_analysis_jobs WHERE song_id = OLD.id;
      DELETE FROM song_audio WHERE song_id = OLD.id;
    END`
  ]
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
