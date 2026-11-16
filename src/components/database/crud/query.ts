import models from "../models";

const identifier = "[a-zA-Z_][a-zA-Z_0-9]*";
const reference = `${identifier}(?:\\.${identifier})?`;
const invalid = () => {
  throw new Error("Invalid database query");
};

export function queryScope(table: string, joins: string[] = []) {
  const tables: Record<string, string> = {};
  const addTable = (value: string) => {
    const match = value.match(
      new RegExp(`^(${identifier})(?: (${identifier}))?$`)
    );
    if (!match || !Object.hasOwn(models, match[1])) return invalid();
    tables[match[2] ?? match[1]] = match[1];
  };
  addTable(table);
  const column = (value: string) => {
    const parts = value.split(".");
    const [owner, name] = parts.length === 2 ? parts : ["", parts[0]];
    if (
      !new RegExp(`^${reference}$`).test(value) ||
      !(owner
        ? tables[owner] && Object.hasOwn(models[tables[owner]].fields, name)
        : Object.values(tables).some((key) =>
            Object.hasOwn(models[key].fields, name)
          ))
    )
      invalid();
  };
  for (const join of joins) {
    const match = join.match(
      new RegExp(
        `^LEFT JOIN (${identifier}(?: ${identifier})?) ON (${reference}) = (${reference})$`
      )
    );
    if (!match) return invalid();
    addTable(match[1]);
    column(match[2]);
    column(match[3]);
  }
  const fields = (value: string) => {
    const parts = value.match(/(?:[^,()]|\([^()]*\))+/g) ?? [];
    if (parts.join(",") !== value) return invalid();
    for (const part of parts) {
      const match = part
        .trim()
        .match(
          new RegExp(
            `^(\\*|${identifier}\\.\\*|${reference}|(?:length|substr|COALESCE)\\(${reference}(?:, (?:[0-9]+|''))*\\))(?: (?:[aA][sS] )?${identifier})?$`,
            "i"
          )
        );
      if (!match) return invalid();
      const expression = match[1];
      if (expression === "*") continue;
      if (expression.endsWith(".*")) {
        if (!tables[expression.slice(0, -2)]) invalid();
        continue;
      }
      column(
        expression.includes("(")
          ? expression.slice(expression.indexOf("(") + 1).split(/[,)]/)[0]
          : expression
      );
    }
  };
  const where = (value: string, parameters: (string | number | null)[]) => {
    const search =
      "LOWER(COALESCE(b.search_text_lower, '') || ' ' || s.search_text_lower) LIKE ? ESCAPE '!' COLLATE NOCASE";
    for (const part of value ? value.split(" AND ") : []) {
      if (part === search) {
        column("b.search_text_lower");
        column("s.search_text_lower");
        continue;
      }
      const match = part.match(
        new RegExp(
          `^(?:lower\\((${reference})\\)|(${reference})) (?:=|LIKE|IN) (\\?|\\((?:\\?(?:,\\?)*|NULL)\\))$`,
          "i"
        )
      );
      if (!match) return invalid();
      column(match[1] ?? match[2]);
    }
    if (
      (value.match(/\?/g) ?? []).length !== parameters.length ||
      parameters.some(
        (value) =>
          value !== null && !["string", "number"].includes(typeof value)
      )
    )
      invalid();
  };
  const order = (value: string) => {
    for (const part of value.split(",")) {
      const match = part
        .trim()
        .match(
          new RegExp(
            `^(${reference})(?: COLLATE NOCASE)?(?: (?:ASC|DESC))?$`,
            "i"
          )
        );
      if (match) {
        column(match[1]);
        continue;
      }
      const cases = part.match(
        new RegExp(`^CASE (${reference})((?: WHEN [0-9]+ THEN [0-9]+)+) END$`)
      );
      if (!cases) return invalid();
      column(cases[1]);
    }
  };
  return { column, fields, where, order };
}
