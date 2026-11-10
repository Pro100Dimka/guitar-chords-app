import { db } from "../src/components/database";
import { SQLTransaction } from "react-native-sqlite-2";
import {
  createItem,
  updateItem,
  deleteItem,
  getAllItems
} from "../src/components/database/crud";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn(), readTransaction: jest.fn() }
}));

const operations = {
  create: () => createItem({ tableName: "songs", data: { title: "Song" } }),
  update: () =>
    updateItem({
      tableName: "songs",
      data: { title: "Song" },
      filters: "id = 1"
    }),
  delete: () => deleteItem({ tableName: "songs", filters: "id = 1" }),
  read: () => getAllItems({ tableName: "songs" })
};
afterEach(() => jest.resetAllMocks());

test.each(Object.entries(operations))(
  "%s waits for transaction completion and rejects commit failure",
  async (_, operation) => {
    const executeSql: SQLTransaction["executeSql"] = jest.fn(
      (sql, values, success) =>
        success?.(
          { executeSql },
          {
            insertId: 7,
            rowsAffected: 1,
            rows: { length: 1, item: () => ({ id: 7, title: "Song" }) }
          }
        )
    );
    jest
      .mocked(db.transaction)
      .mockImplementation((callback) => callback({ executeSql }));
    let settled = false;
    const pending = operation();
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    const error = Object.assign(new Error("commit failed"), { code: 1 });
    jest.mocked(db.transaction).mock.calls[0][1]?.(error);
    await expect(pending).rejects.toBe(error);
  }
);

test.each(Object.entries(operations))(
  "%s rejects a transaction failure before SQL execution",
  async (_, operation) => {
    const pending = operation();
    const error = Object.assign(new Error("begin failed"), { code: 1 });
    jest.mocked(db.transaction).mock.calls[0][1]?.(error);
    await expect(pending).rejects.toBe(error);
  }
);

test("read returns actual nonempty rows after transaction success", async () => {
  const row = { id: 9, title: "Persisted" };
  const executeSql: SQLTransaction["executeSql"] = jest.fn(
    (sql, values, success) =>
      success?.(
        { executeSql },
        {
          rows: { length: 1, item: () => row },
          rowsAffected: 0,
          insertId: 0
        }
      )
  );
  jest.mocked(db.transaction).mockImplementation((callback, error, success) => {
    callback({ executeSql });
    success?.();
  });
  await expect(getAllItems({ tableName: "songs" })).resolves.toEqual([row]);
});
