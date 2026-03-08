// src/components/database/index.ts
import SQLite, { WebsqlDatabase } from "react-native-sqlite-2";
import initTables from "./initTables";

export const db: WebsqlDatabase = SQLite.openDatabase("freetune.db");

export const initDatabase = async () => {
  await initTables();
};
