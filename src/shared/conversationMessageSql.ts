export type StoredMessageOrderDirection = "asc" | "desc";

export function storedMessageRoleOrderSql(roleColumn = "role"): string {
  return `CASE ${roleColumn} WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END`;
}

export function storedMessageDisplayOrderSql(options: {
  direction?: StoredMessageOrderDirection;
  tableAlias?: string;
} = {}): string {
  const direction = options.direction === "desc" ? "DESC" : "ASC";
  const column = (name: string) =>
    options.tableAlias ? `${options.tableAlias}.${name}` : name;
  return [
    `${column("timestamp")} ${direction}`,
    `${storedMessageRoleOrderSql(column("role"))} ${direction}`,
    `${column("id")} ${direction}`,
  ].join(", ");
}

export function buildLatestStoredMessagesQuery(params: {
  tableName: string;
  selectColumnsSql: string;
  whereSql: string;
}): string {
  return `SELECT *
    FROM (
      SELECT ${params.selectColumnsSql}
      FROM ${params.tableName}
      WHERE ${params.whereSql}
      ORDER BY ${storedMessageDisplayOrderSql({ direction: "desc" })}
      LIMIT ?
    )
    ORDER BY ${storedMessageDisplayOrderSql({ direction: "asc" })}`;
}
