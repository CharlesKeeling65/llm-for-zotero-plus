declare const Zotero: any;

import {
  buildDefaultClaudeGlobalConversationKey,
  buildDefaultClaudePaperConversationKey,
} from "../../claudeCode/constants";
import {
  buildDefaultCodexGlobalConversationKey,
  buildDefaultCodexPaperConversationKey,
} from "../../codexAppServer/constants";
import {
  conversationRepository,
  type ConversationCatalogEntry,
} from "../../core/conversations/repository";
import { resolveConversationStorageSystem } from "../../shared/conversationStorageRouting";
import type { ConversationSystem } from "../../shared/types";
import { getConversationKey } from "./conversationIdentity";
import {
  resolveActiveNoteSession,
  resolveConversationBaseItem,
  resolveConversationSystemForItem,
  resolveDisplayConversationKind,
} from "./portalScope";

type ConversationKind = "global" | "paper";

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function sameRuntimeScope(
  summary: ConversationCatalogEntry | null,
  params: {
    kind: ConversationKind;
    libraryID: number;
    paperItemID?: number | null;
  },
): summary is ConversationCatalogEntry {
  if (!summary) return false;
  if (summary.kind !== params.kind) return false;
  if (summary.libraryID !== params.libraryID) return false;
  if (params.kind === "paper") {
    return (summary.paperItemID || null) === (params.paperItemID || null);
  }
  return true;
}

function resolveProvisionScope(item: Zotero.Item): {
  conversationKey: number;
  kind: ConversationKind;
  libraryID: number;
  paperItemID?: number;
} | null {
  const conversationKey = normalizePositiveInt(getConversationKey(item));
  const kind = resolveDisplayConversationKind(item);
  if (!conversationKey || !kind) return null;
  if (kind === "global") {
    const libraryID = normalizePositiveInt(item?.libraryID);
    return libraryID
      ? {
          conversationKey,
          kind,
          libraryID,
        }
      : null;
  }
  const baseItem = resolveConversationBaseItem(item);
  const paperItemID = normalizePositiveInt(baseItem?.id);
  const libraryID = normalizePositiveInt(
    baseItem?.libraryID || item?.libraryID,
  );
  if (!libraryID || !paperItemID) return null;
  return {
    conversationKey,
    kind,
    libraryID,
    paperItemID,
  };
}

export function resolveConversationStorageSystemForItem(params: {
  item: Zotero.Item;
  conversationSystem?: ConversationSystem | null;
}): ConversationSystem | null {
  const conversationKey = normalizePositiveInt(getConversationKey(params.item));
  if (!conversationKey) return null;
  if (resolveActiveNoteSession(params.item)) {
    return "upstream";
  }
  const itemSystem = resolveConversationSystemForItem(params.item);
  return resolveConversationStorageSystem({
    conversationKey,
    conversationSystem: itemSystem || params.conversationSystem,
  });
}

async function provisionUpstreamConversation(scope: {
  conversationKey: number;
  kind: ConversationKind;
  libraryID: number;
  paperItemID?: number;
}): Promise<boolean> {
  return Boolean(
    await conversationRepository.ensureCatalogEntry({
      system: "upstream",
      conversationKey: scope.conversationKey,
      kind: scope.kind,
      libraryID: scope.libraryID,
      paperItemID: scope.paperItemID,
    }),
  );
}

async function provisionRuntimeConversation(
  system: "claude_code" | "codex",
  scope: {
    conversationKey: number;
    kind: ConversationKind;
    libraryID: number;
    paperItemID?: number;
  },
): Promise<boolean> {
  const existing = await conversationRepository.getCatalogEntry({
    system,
    kind: scope.kind,
    conversationKey: scope.conversationKey,
  });
  if (sameRuntimeScope(existing, scope)) {
    return Boolean(
      await conversationRepository.ensureCatalogEntry({
        system,
        conversationKey: scope.conversationKey,
        kind: scope.kind,
        libraryID: scope.libraryID,
        paperItemID: scope.paperItemID,
      }),
    );
  }
  if (scope.kind === "global") {
    const expectedKey =
      system === "claude_code"
        ? buildDefaultClaudeGlobalConversationKey(scope.libraryID)
        : buildDefaultCodexGlobalConversationKey(scope.libraryID);
    if (scope.conversationKey !== expectedKey) return false;
    const ensured = await conversationRepository.ensureCatalogEntry({
      system,
      kind: "global",
      libraryID: scope.libraryID,
    });
    return ensured?.conversationKey === scope.conversationKey;
  }
  if (!scope.paperItemID) return false;
  const expectedPaperKey =
    system === "claude_code"
      ? buildDefaultClaudePaperConversationKey(scope.paperItemID)
      : buildDefaultCodexPaperConversationKey(scope.paperItemID);
  if (scope.conversationKey !== expectedPaperKey) return false;
  const ensured = await conversationRepository.ensureCatalogEntry({
    system,
    kind: "paper",
    libraryID: scope.libraryID,
    paperItemID: scope.paperItemID,
  });
  return ensured?.conversationKey === scope.conversationKey;
}

async function provisionClaudeConversation(scope: {
  conversationKey: number;
  kind: ConversationKind;
  libraryID: number;
  paperItemID?: number;
}): Promise<boolean> {
  return provisionRuntimeConversation("claude_code", scope);
}

async function provisionCodexConversation(scope: {
  conversationKey: number;
  kind: ConversationKind;
  libraryID: number;
  paperItemID?: number;
}): Promise<boolean> {
  return provisionRuntimeConversation("codex", scope);
}

export async function provisionConversationScopeForItem(params: {
  item: Zotero.Item;
  conversationSystem?: ConversationSystem | null;
}): Promise<boolean> {
  const scope = resolveProvisionScope(params.item);
  if (!scope) return false;
  const storageSystem = resolveConversationStorageSystemForItem(params);
  try {
    if (storageSystem === "claude_code") {
      return await provisionClaudeConversation(scope);
    }
    if (storageSystem === "codex") {
      return await provisionCodexConversation(scope);
    }
    if (storageSystem === "upstream") {
      return await provisionUpstreamConversation(scope);
    }
  } catch (err) {
    const debug = (
      globalThis as typeof globalThis & {
        Zotero?: { debug?: (message: string, err?: unknown) => void };
      }
    ).Zotero?.debug;
    debug?.("LLM: Failed to provision conversation scope", err);
  }
  return false;
}
