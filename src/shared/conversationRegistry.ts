declare const Zotero: any;

import type { ConversationSystem } from "./types";

export type RegistryConversationKind = "global" | "paper";

export type ConversationRegistryScope = {
  conversationKey: number;
  system: ConversationSystem;
  kind: RegistryConversationKind;
  libraryID: number;
  paperItemID?: number | null;
  profileSignature?: string | null;
  createdAt?: number;
  updatedAt?: number;
  title?: string | null;
};

export type ConversationRegistryRow = Required<
  Pick<
    ConversationRegistryScope,
    "conversationKey" | "system" | "kind" | "libraryID"
  >
> & {
  profileSignature: string;
  paperItemID: number | null;
  valid: boolean;
  invalidReason?: string;
};

export type PaperContextJsonColumns = {
  paperContextsJson?: unknown;
  fullTextPaperContextsJson?: unknown;
  selectedTextPaperContextsJson?: unknown;
  citationPaperContextsJson?: unknown;
};

const CONVERSATION_REGISTRY_TABLE = "llm_for_zotero_conversation_registry";
const CONVERSATION_REGISTRY_SCOPE_INDEX =
  "llm_for_zotero_conversation_registry_scope_idx";

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function normalizeText(value: unknown, maxLength = 256): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function normalizeSystem(value: unknown): ConversationSystem | null {
  return value === "upstream" || value === "claude_code" || value === "codex"
    ? value
    : null;
}

function normalizeKind(value: unknown): RegistryConversationKind | null {
  return value === "global" || value === "paper" ? value : null;
}

function normalizeTimestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Date.now();
}

export function buildProfileSignature(profileDir: string): string {
  const normalized = profileDir.trim().replace(/\\/g, "/");
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `profile-${(hash >>> 0).toString(16)}`;
}

export function getCurrentProfileSignature(): string {
  const profileDir = normalizeText(
    (globalThis as typeof globalThis & { Zotero?: { Profile?: { dir?: unknown } } })
      .Zotero?.Profile?.dir,
    1024,
  );
  return profileDir ? buildProfileSignature(profileDir) : "profile-default";
}

function normalizeScope(
  params: ConversationRegistryScope,
): (ConversationRegistryRow & { createdAt: number; updatedAt: number; title: string | null }) | null {
  const conversationKey = normalizePositiveInt(params.conversationKey);
  const libraryID = normalizePositiveInt(params.libraryID);
  const system = normalizeSystem(params.system);
  const kind = normalizeKind(params.kind);
  if (!conversationKey || !libraryID || !system || !kind) return null;
  const paperItemID =
    kind === "paper" ? normalizePositiveInt(params.paperItemID) : null;
  if (kind === "paper" && !paperItemID) return null;
  return {
    conversationKey,
    system,
    kind,
    profileSignature:
      normalizeText(params.profileSignature, 128) || getCurrentProfileSignature(),
    libraryID,
    paperItemID,
    valid: true,
    createdAt: normalizeTimestamp(params.createdAt),
    updatedAt: normalizeTimestamp(params.updatedAt),
    title: normalizeText(params.title || "", 128) || null,
  };
}

function sameRegistryScope(
  left: ConversationRegistryRow,
  right: ConversationRegistryRow,
): boolean {
  return (
    left.system === right.system &&
    left.kind === right.kind &&
    left.profileSignature === right.profileSignature &&
    left.libraryID === right.libraryID &&
    (left.paperItemID || null) === (right.paperItemID || null)
  );
}

function logRegistryWarning(message: string): void {
  const debug = (globalThis as typeof globalThis & {
    Zotero?: { debug?: (message: string) => void };
  }).Zotero?.debug;
  debug?.(`LLM: ${message}`);
}

function getZoteroDb():
  | { queryAsync?: (sql: string, params?: unknown[]) => Promise<unknown> }
  | null {
  return (
    (globalThis as typeof globalThis & {
      Zotero?: { DB?: { queryAsync?: (sql: string, params?: unknown[]) => Promise<unknown> } };
    }).Zotero?.DB || null
  );
}

export async function initConversationRegistryStore(): Promise<void> {
  const db = getZoteroDb();
  if (!db?.queryAsync) return;
  await db.queryAsync(
    `CREATE TABLE IF NOT EXISTS ${CONVERSATION_REGISTRY_TABLE} (
      conversation_key INTEGER PRIMARY KEY,
      system TEXT NOT NULL CHECK(system IN ('upstream', 'claude_code', 'codex')),
      kind TEXT NOT NULL CHECK(kind IN ('global', 'paper')),
      profile_signature TEXT NOT NULL,
      library_id INTEGER NOT NULL,
      paper_item_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title TEXT,
      valid INTEGER NOT NULL DEFAULT 1,
      invalid_reason TEXT
    )`,
  );
  await db.queryAsync(
    `CREATE INDEX IF NOT EXISTS ${CONVERSATION_REGISTRY_SCOPE_INDEX}
     ON ${CONVERSATION_REGISTRY_TABLE}
       (profile_signature, system, kind, library_id, paper_item_id, updated_at DESC)`,
  );
}

export async function getRegisteredConversationScope(
  conversationKey: number,
): Promise<ConversationRegistryRow | null> {
  const normalizedKey = normalizePositiveInt(conversationKey);
  if (!normalizedKey) return null;
  const db = getZoteroDb();
  if (!db?.queryAsync) return null;
  await initConversationRegistryStore();
  const rows = (await db.queryAsync(
    `SELECT conversation_key AS conversationKey,
            system,
            kind,
            profile_signature AS profileSignature,
            library_id AS libraryID,
            paper_item_id AS paperItemID,
            valid,
            invalid_reason AS invalidReason
     FROM ${CONVERSATION_REGISTRY_TABLE}
     WHERE conversation_key = ?
     LIMIT 1`,
    [normalizedKey],
  )) as Array<Record<string, unknown>> | undefined;
  const row = rows?.[0];
  if (!row) return null;
  const system = normalizeSystem(row.system);
  const kind = normalizeKind(row.kind);
  const libraryID = normalizePositiveInt(row.libraryID);
  if (!system || !kind || !libraryID) return null;
  return {
    conversationKey: normalizedKey,
    system,
    kind,
    profileSignature: normalizeText(row.profileSignature, 128),
    libraryID,
    paperItemID: normalizePositiveInt(row.paperItemID),
    valid: Number(row.valid) !== 0,
    invalidReason: normalizeText(row.invalidReason, 256) || undefined,
  };
}

export async function registerConversationScope(
  params: ConversationRegistryScope,
): Promise<boolean> {
  const normalized = normalizeScope(params);
  if (!normalized) return false;
  const db = getZoteroDb();
  if (!db?.queryAsync) return false;
  await initConversationRegistryStore();
  const existing = await getRegisteredConversationScope(
    normalized.conversationKey,
  );
  if (existing && !sameRegistryScope(existing, normalized)) {
    logRegistryWarning(
      `Refused to reassign conversation ${normalized.conversationKey} from ${existing.system}/${existing.kind}/${existing.libraryID}/${existing.paperItemID || ""} to ${normalized.system}/${normalized.kind}/${normalized.libraryID}/${normalized.paperItemID || ""}.`,
    );
    return false;
  }
  await db.queryAsync(
    `INSERT INTO ${CONVERSATION_REGISTRY_TABLE}
      (conversation_key, system, kind, profile_signature, library_id, paper_item_id, created_at, updated_at, title, valid, invalid_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
     ON CONFLICT(conversation_key) DO UPDATE SET
       updated_at = excluded.updated_at,
       title = COALESCE(excluded.title, ${CONVERSATION_REGISTRY_TABLE}.title),
       valid = 1,
       invalid_reason = NULL`,
    [
      normalized.conversationKey,
      normalized.system,
      normalized.kind,
      normalized.profileSignature,
      normalized.libraryID,
      normalized.paperItemID,
      normalized.createdAt,
      normalized.updatedAt,
      normalized.title,
    ],
  );
  return true;
}

export async function invalidateRegisteredConversationScope(
  conversationKey: number,
  reason: string,
): Promise<void> {
  const normalizedKey = normalizePositiveInt(conversationKey);
  if (!normalizedKey) return;
  const db = getZoteroDb();
  if (!db?.queryAsync) return;
  await initConversationRegistryStore();
  await db.queryAsync(
    `UPDATE ${CONVERSATION_REGISTRY_TABLE}
     SET valid = 0,
         invalid_reason = ?
     WHERE conversation_key = ?`,
    [normalizeText(reason, 256) || "invalid scope", normalizedKey],
  );
}

export async function repairRegisteredConversationScope(
  params: ConversationRegistryScope,
): Promise<boolean> {
  const normalized = normalizeScope(params);
  if (!normalized) return false;
  const db = getZoteroDb();
  if (!db?.queryAsync) return false;
  await initConversationRegistryStore();
  await db.queryAsync(
    `INSERT INTO ${CONVERSATION_REGISTRY_TABLE}
      (conversation_key, system, kind, profile_signature, library_id, paper_item_id, created_at, updated_at, title, valid, invalid_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
     ON CONFLICT(conversation_key) DO UPDATE SET
       system = excluded.system,
       kind = excluded.kind,
       profile_signature = excluded.profile_signature,
       library_id = excluded.library_id,
       paper_item_id = excluded.paper_item_id,
       updated_at = excluded.updated_at,
       title = COALESCE(excluded.title, ${CONVERSATION_REGISTRY_TABLE}.title),
       valid = 1,
       invalid_reason = NULL`,
    [
      normalized.conversationKey,
      normalized.system,
      normalized.kind,
      normalized.profileSignature,
      normalized.libraryID,
      normalized.paperItemID,
      normalized.createdAt,
      normalized.updatedAt,
      normalized.title,
    ],
  );
  return true;
}

export async function validateConversationScope(
  params: ConversationRegistryScope,
): Promise<boolean> {
  const normalized = normalizeScope(params);
  if (!normalized) return false;
  const db = getZoteroDb();
  const existing = await getRegisteredConversationScope(
    normalized.conversationKey,
  );
  if (!existing) {
    if (!db?.queryAsync) return true;
    return normalized.system === "upstream";
  }
  return existing.valid && sameRegistryScope(existing, normalized);
}

function collectPaperIdsFromValue(value: unknown, out: Set<number>): void {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const parsed = JSON.parse(value) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const itemID = normalizePositiveInt(
        (entry as { itemId?: unknown; itemID?: unknown }).itemId ??
          (entry as { itemId?: unknown; itemID?: unknown }).itemID,
      );
      if (itemID) out.add(itemID);
    }
  } catch {
    // Ignore malformed legacy JSON. It cannot safely prove ownership.
  }
}

export function inferSinglePaperItemIdFromContextRows(
  rows: PaperContextJsonColumns[],
): number | "ambiguous" | null {
  const ids = new Set<number>();
  for (const row of rows) {
    collectPaperIdsFromValue(row.paperContextsJson, ids);
    collectPaperIdsFromValue(row.fullTextPaperContextsJson, ids);
    collectPaperIdsFromValue(row.selectedTextPaperContextsJson, ids);
    collectPaperIdsFromValue(row.citationPaperContextsJson, ids);
  }
  if (ids.size === 0) return null;
  if (ids.size > 1) return "ambiguous";
  return Array.from(ids)[0];
}
