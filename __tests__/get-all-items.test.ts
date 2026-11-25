import getAllItems from "../src/components/database/crud/get-all-items";
import { db } from "../src/components/database";
import { updateItem, deleteItem } from "../src/components/database/crud";

test.each([
  { tableName: "songs; DROP TABLE songs" },
  { tableName: "songs", fields: "(SELECT value FROM settings)" },
  { tableName: "songs", filters: "id = 1 OR 1 = 1" },
  { tableName: "songs", orderBy: "title; DELETE FROM songs" },
  { tableName: "songs", joins: ["JOIN settings ON 1 = 1"] },
  { tableName: "songs", limit: -1 },
  { tableName: "songs", fields: "unknown_column" }
])("rejects unsafe read fragments before opening SQLite: %o", async (query) => {
  jest.mocked(db.transaction).mockClear();
  await expect(getAllItems(query)).rejects.toThrow();
  expect(db.transaction).not.toHaveBeenCalled();
});

test.each([
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1
])(
  "read selection rejects invalid record id %s before opening SQLite",
  async (id) => {
    jest.mocked(db.transaction).mockClear();
    await expect(
      getAllItems({ tableName: "songs", ids: [id] })
    ).rejects.toThrow("Invalid record identifiers");
    expect(db.transaction).not.toHaveBeenCalled();
  }
);

test.each([
  { page: Number.MAX_SAFE_INTEGER, limit: 2 },
  { page: 2, limit: Number.MAX_SAFE_INTEGER }
])("rejects overflowing SQLite page offsets before starting a transaction: %o", async (pagination) => {
  jest.mocked(db.transaction).mockClear();
  await expect(
    getAllItems({ tableName: "songs", ...pagination })
  ).rejects.toThrow("Invalid pagination");
  expect(db.transaction).not.toHaveBeenCalled();
});

test("record selection cannot inject SQL or target a table without an id column", async () => {
  jest.mocked(db.transaction).mockClear();
  await expect(
    getAllItems(JSON.parse('{"tableName":"songs","ids":["1) OR 1=1 --"]}'))
  ).rejects.toThrow("Invalid record identifiers");
  await expect(
    getAllItems({ tableName: "settings", ids: [1] })
  ).rejects.toThrow("Invalid database query");
  expect(db.transaction).not.toHaveBeenCalled();
});

test("mutations reject injected identifiers and unbound predicates", async () => {
  jest.mocked(db.transaction).mockClear();
  await expect(
    updateItem({
      tableName: "songs",
      data: { "title = NULL; --": "bad" },
      filters: "id = ?"
    })
  ).rejects.toThrow();
  await expect(
    deleteItem({ tableName: "songs", filters: "id = 1 OR 1 = 1" })
  ).rejects.toThrow();
  expect(db.transaction).not.toHaveBeenCalled();
});

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));

test("zero-based pages use distinct offsets and search values stay bound", async () => {
  const executeSql = jest.fn();
  jest.mocked(db.transaction).mockImplementation((callback, error, success) => {
    callback({
      executeSql: (sql, values, success) => {
        executeSql(sql, values);
        success?.(
          { executeSql: jest.fn() },
          { rows: { length: 0, item: jest.fn() }, rowsAffected: 0, insertId: 0 }
        );
      }
    });
    success?.();
  });
  for (const page of [0, 1, 2]) {
    await getAllItems({ tableName: "songs", page, limit: 2 });
  }
  expect(executeSql.mock.calls).toEqual([
    ["SELECT * FROM songs LIMIT 2 OFFSET 0", []],
    ["SELECT * FROM songs LIMIT 2 OFFSET 2", []],
    ["SELECT * FROM songs LIMIT 2 OFFSET 4", []]
  ]);
  await getAllItems({
    tableName: "bands",
    filters: "name LIKE ?",
    parameters: ["%N' Roses%"]
  });
  expect(executeSql).toHaveBeenLastCalledWith(
    "SELECT * FROM bands WHERE name LIKE ?",
    ["%N' Roses%"]
  );
  jest.mocked(db.transaction).mockReset();
});
