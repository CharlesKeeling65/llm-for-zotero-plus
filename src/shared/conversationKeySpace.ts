import type { ConversationSystem } from "./types";

export type ConversationKeyKind = "global" | "paper";

export type ConversationKeyClassification = {
  system: ConversationSystem;
  kind: ConversationKeyKind;
};

export type ConversationKeyRange = {
  start: number;
  endExclusive: number;
};

export const UPSTREAM_PAPER_CONVERSATION_KEY_BASE = 1_500_000_000;
export const UPSTREAM_GLOBAL_CONVERSATION_KEY_BASE = 2_000_000_000;
export const UPSTREAM_RUNTIME_CONVERSATION_KEY_END = 3_000_000_000;

export const RUNTIME_PROFILE_KEY_MULTIPLIER = 1_000_000_000;
export const RUNTIME_PROFILE_SLOT_MOD = 999_999;

export const CLAUDE_GLOBAL_CONVERSATION_KEY_BASE = 3_000_000_000_000_000;
export const CLAUDE_PAPER_CONVERSATION_KEY_BASE = 4_000_000_000_000_000;
export const CODEX_GLOBAL_CONVERSATION_KEY_BASE = 5_000_000_000_000_000;
export const CODEX_PAPER_CONVERSATION_KEY_BASE = 6_000_000_000_000_000;
export const RUNTIME_CONVERSATION_KEY_END = 7_000_000_000_000_000;

function normalizeConversationKey(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function normalizeScopeId(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function containsKey(range: ConversationKeyRange, value: number): boolean {
  const normalized = normalizeConversationKey(value);
  return Boolean(
    normalized &&
      normalized >= range.start &&
      normalized < range.endExclusive,
  );
}

export function getProfileKeySlot(profileSignature?: string | null): number {
  const signature = typeof profileSignature === "string"
    ? profileSignature.trim()
    : "";
  const hex = signature.replace(/^profile-/, "");
  const parsed = Number.parseInt(hex, 16);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return (parsed % RUNTIME_PROFILE_SLOT_MOD) + 1;
}

export function getProfileKeyOffset(profileSignature?: string | null): number {
  return getProfileKeySlot(profileSignature) * RUNTIME_PROFILE_KEY_MULTIPLIER;
}

function fullKindRange(
  system: ConversationSystem,
  kind: ConversationKeyKind,
): ConversationKeyRange {
  if (system === "upstream") {
    return kind === "global"
      ? {
          start: UPSTREAM_GLOBAL_CONVERSATION_KEY_BASE,
          endExclusive: UPSTREAM_RUNTIME_CONVERSATION_KEY_END,
        }
      : {
          start: 1,
          endExclusive: UPSTREAM_GLOBAL_CONVERSATION_KEY_BASE,
        };
  }
  if (system === "claude_code") {
    return kind === "global"
      ? {
          start: CLAUDE_GLOBAL_CONVERSATION_KEY_BASE,
          endExclusive: CLAUDE_PAPER_CONVERSATION_KEY_BASE,
        }
      : {
          start: CLAUDE_PAPER_CONVERSATION_KEY_BASE,
          endExclusive: CODEX_GLOBAL_CONVERSATION_KEY_BASE,
        };
  }
  return kind === "global"
    ? {
        start: CODEX_GLOBAL_CONVERSATION_KEY_BASE,
        endExclusive: CODEX_PAPER_CONVERSATION_KEY_BASE,
      }
    : {
        start: CODEX_PAPER_CONVERSATION_KEY_BASE,
        endExclusive: RUNTIME_CONVERSATION_KEY_END,
      };
}

export function getConversationKeyRange(
  system: ConversationSystem,
  kind: ConversationKeyKind,
  profileSignature?: string | null,
): ConversationKeyRange {
  if (system === "upstream" || profileSignature === undefined) {
    return fullKindRange(system, kind);
  }
  const base = system === "claude_code"
    ? kind === "global"
      ? CLAUDE_GLOBAL_CONVERSATION_KEY_BASE
      : CLAUDE_PAPER_CONVERSATION_KEY_BASE
    : kind === "global"
      ? CODEX_GLOBAL_CONVERSATION_KEY_BASE
      : CODEX_PAPER_CONVERSATION_KEY_BASE;
  const start = base + getProfileKeyOffset(profileSignature);
  return {
    start,
    endExclusive: start + RUNTIME_PROFILE_KEY_MULTIPLIER,
  };
}

export function buildDefaultConversationKey(
  system: ConversationSystem,
  kind: ConversationKeyKind,
  scopeId: number,
  profileSignature?: string | null,
): number {
  if (system === "upstream") {
    if (kind === "global") return UPSTREAM_GLOBAL_CONVERSATION_KEY_BASE;
    return normalizeScopeId(scopeId);
  }
  return (
    getConversationKeyRange(system, kind, profileSignature || "").start +
    normalizeScopeId(scopeId)
  );
}

export function classifyConversationKey(
  value: number,
): ConversationKeyClassification | null {
  const key = normalizeConversationKey(value);
  if (!key) return null;
  const systems: ConversationSystem[] = ["upstream", "claude_code", "codex"];
  const kinds: ConversationKeyKind[] = ["global", "paper"];
  for (const system of systems) {
    for (const kind of kinds) {
      if (containsKey(fullKindRange(system, kind), key)) {
        return { system, kind };
      }
    }
  }
  return null;
}

export function isConversationKeyFor(
  system: ConversationSystem,
  key: number,
): boolean {
  return classifyConversationKey(key)?.system === system;
}

export function isConversationKeyForKind(
  system: ConversationSystem,
  kind: ConversationKeyKind,
  key: number,
): boolean {
  const classification = classifyConversationKey(key);
  return (
    classification?.system === system &&
    classification.kind === kind
  );
}

export function isConversationKeyInRange(
  key: number,
  range: ConversationKeyRange,
): boolean {
  return containsKey(range, key);
}
