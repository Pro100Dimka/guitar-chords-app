import getAllItems from "../src/components/database/crud/get-all-items";
import { db } from "../src/components/database";

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
