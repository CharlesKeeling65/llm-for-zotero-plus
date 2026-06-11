type ZoteroDb = {
  queryAsync?: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export const CONVERSATION_SCHEMA_MIGRATIONS_TABLE =
  "llm_for_zotero_conversation_schema_migrations";

export const CONVERSATION_ID_TRANSITION_MIGRATION_ID =
  "conversation-id-transition-v1";

const CONVERSATION_ID_TRANSITION_DESCRIPTION =
  "Conversation history stores use canonical conversation_id with legacy numeric keys as compatibility aliases.";

function getZoteroDb(): ZoteroDb | null {
  return (
    (globalThis as typeof globalThis & { Zotero?: { DB?: ZoteroDb } }).Zotero
      ?.DB || null
  );
}

function normalizeMigrationID(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeMigrationDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 512) : null;
}

export async function initConversationSchemaMigrationLedger(): Promise<boolean> {
  const db = getZoteroDb();
  if (!db?.queryAsync) return false;
  await db.queryAsync(
    `CREATE TABLE IF NOT EXISTS ${CONVERSATION_SCHEMA_MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT
    )`,
  );
  return true;
}

export async function hasConversationSchemaMigration(
  migrationID: string,
): Promise<boolean> {
  const id = normalizeMigrationID(migrationID);
  if (!id) return false;
  const initialized = await initConversationSchemaMigrationLedger();
  if (!initialized) return false;
  const db = getZoteroDb();
  const rows = (await db?.queryAsync?.(
    `SELECT id
     FROM ${CONVERSATION_SCHEMA_MIGRATIONS_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [id],
  )) as Array<{ id?: unknown }> | undefined;
  return Boolean(rows?.length);
}

export async function markConversationSchemaMigrationApplied(
  migrationID: string,
  description?: string,
): Promise<boolean> {
  const id = normalizeMigrationID(migrationID);
  if (!id) return false;
  const initialized = await initConversationSchemaMigrationLedger();
  if (!initialized) return false;
  const db = getZoteroDb();
  if (!db?.queryAsync) return false;
  await db.queryAsync(
    `INSERT INTO ${CONVERSATION_SCHEMA_MIGRATIONS_TABLE}
      (id, applied_at, description)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       description = COALESCE(excluded.description, ${CONVERSATION_SCHEMA_MIGRATIONS_TABLE}.description)`,
    [id, Date.now(), normalizeMigrationDescription(description)],
  );
  return true;
}

export async function runConversationSchemaMigrationOnce(
  migrationID: string,
  description: string,
  migrate: () => Promise<void> | void,
): Promise<boolean> {
  const id = normalizeMigrationID(migrationID);
  if (!id) return false;
  const initialized = await initConversationSchemaMigrationLedger();
  if (!initialized) return false;
  if (await hasConversationSchemaMigration(id)) return false;
  await migrate();
  await markConversationSchemaMigrationApplied(id, description);
  return true;
}

export async function markConversationIDTransitionMigrationApplied(): Promise<boolean> {
  return markConversationSchemaMigrationApplied(
    CONVERSATION_ID_TRANSITION_MIGRATION_ID,
    CONVERSATION_ID_TRANSITION_DESCRIPTION,
  );
}
