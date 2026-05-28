import { assert } from "chai";
import {
  CLAUDE_GLOBAL_CONVERSATION_KEY_BASE,
  CLAUDE_PAPER_CONVERSATION_KEY_BASE,
  CODEX_GLOBAL_CONVERSATION_KEY_BASE,
  CODEX_PAPER_CONVERSATION_KEY_BASE,
} from "../src/shared/conversationKeySpace";
import { appendMessage } from "../src/utils/chatStore";
import {
  appendClaudeMessage,
  listClaudePaperConversations,
  upsertClaudeConversationSummary,
} from "../src/claudeCode/store";
import {
  appendCodexMessage,
  listCodexPaperConversations,
  repairCodexConversationIdentityRegistry,
  repairMisroutedCodexConversationRows,
  upsertCodexConversationSummary,
} from "../src/codexAppServer/store";
import type { StoredChatMessage } from "../src/utils/chatStore";

type QueryRecord = {
  sql: string;
  params: unknown[];
};

const sampleMessage: StoredChatMessage = {
  role: "user",
  text: "hello",
  timestamp: 1,
};

function installQueryRecorder(
  queryAsync: (sql: string, params?: unknown[]) => Promise<unknown[]> = async () => [],
): { queries: QueryRecord[]; restore: () => void } {
  const originalZotero = globalThis.Zotero;
  const queries: QueryRecord[] = [];
  (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero = {
    DB: {
      queryAsync: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: Array.isArray(params) ? params : [] });
        return queryAsync(sql, params);
      },
      executeTransaction: async (callback: () => Promise<unknown>) =>
        await callback(),
    },
    debug: () => undefined,
    Profile: {
      dir: "/tmp/llm-for-zotero-test-profile",
    },
  } as unknown as typeof Zotero;
  return {
    queries,
    restore: () => {
      (globalThis as typeof globalThis & { Zotero?: typeof Zotero }).Zotero =
        originalZotero;
    },
  };
}

describe("conversation store key validation", function () {
  it("rejects Codex-range keys at Claude store boundaries", async function () {
    const { queries, restore } = installQueryRecorder();
    try {
      await appendClaudeMessage(CODEX_GLOBAL_CONVERSATION_KEY_BASE + 1, sampleMessage);
      await upsertClaudeConversationSummary({
        conversationKey: CODEX_PAPER_CONVERSATION_KEY_BASE + 1,
        libraryID: 1,
        kind: "paper",
      });

      assert.lengthOf(queries, 0);
    } finally {
      restore();
    }
  });

  it("rejects Claude-range keys at Codex store boundaries", async function () {
    const { queries, restore } = installQueryRecorder();
    try {
      await appendCodexMessage(CLAUDE_GLOBAL_CONVERSATION_KEY_BASE + 1, sampleMessage);
      await upsertCodexConversationSummary({
        conversationKey: CLAUDE_PAPER_CONVERSATION_KEY_BASE + 1,
        libraryID: 1,
        kind: "paper",
      });

      assert.lengthOf(queries, 0);
    } finally {
      restore();
    }
  });

  it("rejects runtime keys in the upstream chat store", async function () {
    const { queries, restore } = installQueryRecorder();
    try {
      await appendMessage(CODEX_GLOBAL_CONVERSATION_KEY_BASE + 1, sampleMessage);

      assert.lengthOf(queries, 0);
    } finally {
      restore();
    }
  });

  it("refuses to reassign an existing Codex paper conversation to a different paper", async function () {
    const conversationKey = CODEX_PAPER_CONVERSATION_KEY_BASE + 123;
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (
        sql.includes("FROM llm_for_zotero_codex_conversations c") &&
        sql.includes("WHERE c.conversation_key = ?")
      ) {
        return [
          {
            conversationKey,
            libraryID: 1,
            kind: "paper",
            paperItemID: 3196,
            createdAt: 100,
            updatedAt: 200,
            title: "Existing paper",
            userTurnCount: 1,
          },
        ];
      }
      return [];
    });
    try {
      const stored = await upsertCodexConversationSummary({
        conversationKey,
        libraryID: 1,
        kind: "paper",
        paperItemID: 3340,
      });

      assert.equal(stored, false);
      assert.isFalse(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_codex_conversations"),
        ),
      );
    } finally {
      restore();
    }
  });

  it("backfills missing Codex registry rows while listing legacy history", async function () {
    const conversationKey = CODEX_PAPER_CONVERSATION_KEY_BASE + 3331;
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (
        sql.includes("FROM llm_for_zotero_codex_conversations c") &&
        sql.includes("c.kind = 'paper'") &&
        sql.includes("c.paper_item_id = ?")
      ) {
        return [
          {
            conversationKey,
            libraryID: 1,
            kind: "paper",
            paperItemID: 3326,
            createdAt: 100,
            updatedAt: 200,
            title: "Legacy paper chat",
            userTurnCount: 1,
          },
        ];
      }
      return [];
    });
    try {
      const entries = await listCodexPaperConversations(1, 3326, 10);

      assert.lengthOf(entries, 1);
      assert.equal(entries[0]?.conversationKey, conversationKey);
      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_conversation_registry"),
        ),
      );
    } finally {
      restore();
    }
  });

  it("does not list a missing-registry Codex row under the wrong paper after context repair", async function () {
    const conversationKey = CODEX_PAPER_CONVERSATION_KEY_BASE + 3342;
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (
        sql.includes("FROM llm_for_zotero_codex_conversations c") &&
        sql.includes("c.kind = 'paper'") &&
        sql.includes("c.paper_item_id = ?")
      ) {
        return [
          {
            conversationKey,
            libraryID: 1,
            kind: "paper",
            paperItemID: 3342,
            createdAt: 100,
            updatedAt: 200,
            title: "Wrong paper",
            userTurnCount: 1,
          },
        ];
      }
      if (
        sql.includes("FROM llm_for_zotero_codex_messages") &&
        sql.includes("paper_contexts_json AS paperContextsJson")
      ) {
        return [
          {
            paperContextsJson: JSON.stringify([{ itemId: 3326 }]),
          },
        ];
      }
      return [];
    });
    try {
      const entries = await listCodexPaperConversations(1, 3342, 10);

      assert.lengthOf(entries, 0);
      const repairUpdate = queries.find((query) =>
        query.sql.includes("UPDATE llm_for_zotero_codex_conversations") &&
        query.sql.includes("SET paper_item_id = ?"),
      );
      assert.deepEqual(repairUpdate?.params, [3326, conversationKey]);
    } finally {
      restore();
    }
  });

  it("backfills missing Claude registry rows while listing legacy history", async function () {
    const conversationKey = CLAUDE_PAPER_CONVERSATION_KEY_BASE + 3331;
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (
        sql.includes("FROM llm_for_zotero_claude_conversations c") &&
        sql.includes("c.kind = 'paper'") &&
        sql.includes("c.paper_item_id = ?")
      ) {
        return [
          {
            conversationKey,
            libraryID: 1,
            kind: "paper",
            paperItemID: 3326,
            createdAt: 100,
            updatedAt: 200,
            title: "Legacy Claude chat",
            userTurnCount: 1,
          },
        ];
      }
      return [];
    });
    try {
      const entries = await listClaudePaperConversations(1, 3326, 10);

      assert.lengthOf(entries, 1);
      assert.equal(entries[0]?.conversationKey, conversationKey);
      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_conversation_registry"),
        ),
      );
    } finally {
      restore();
    }
  });
});

describe("misrouted Codex conversation repair", function () {
  const codexKey = CODEX_GLOBAL_CONVERSATION_KEY_BASE + 123;

  it("moves Codex-range rows out of Claude tables when Codex has no matching key", async function () {
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (sql.includes("FROM sqlite_master")) return [{ name: "ok" }];
      if (sql.includes("SELECT DISTINCT conversation_key AS conversationKey")) {
        return [{ conversationKey: codexKey }];
      }
      if (sql.includes("COUNT(*) AS rowCount")) {
        if (sql.includes("FROM llm_for_zotero_claude_")) return [{ rowCount: 1 }];
        if (sql.includes("FROM llm_for_zotero_codex_")) return [{ rowCount: 0 }];
      }
      return [];
    });
    try {
      await repairMisroutedCodexConversationRows();

      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_codex_conversations"),
        ),
      );
      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_codex_messages"),
        ),
      );
      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("DELETE FROM llm_for_zotero_claude_conversations"),
        ),
      );
      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("DELETE FROM llm_for_zotero_claude_messages"),
        ),
      );
    } finally {
      restore();
    }
  });

  it("does not overwrite existing Codex rows", async function () {
    const warnings: string[] = [];
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (sql.includes("FROM sqlite_master")) return [{ name: "ok" }];
      if (sql.includes("SELECT DISTINCT conversation_key AS conversationKey")) {
        return [{ conversationKey: codexKey }];
      }
      if (sql.includes("COUNT(*) AS rowCount")) return [{ rowCount: 1 }];
      return [];
    });
    (
      globalThis as typeof globalThis & {
        Zotero?: typeof Zotero & { debug?: (message: string) => void };
      }
    ).Zotero!.debug = (message: string) => {
      warnings.push(message);
    };
    try {
      await repairMisroutedCodexConversationRows();

      assert.isFalse(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_codex_conversations"),
        ),
      );
      assert.isFalse(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_codex_messages"),
        ),
      );
      assert.lengthOf(warnings, 2);
    } finally {
      restore();
    }
  });
});

describe("Codex conversation identity repair", function () {
  const conversationKey = CODEX_PAPER_CONVERSATION_KEY_BASE + 3340;

  it("restores a wrong-paper Codex catalog row when message contexts prove the original paper", async function () {
    const { queries, restore } = installQueryRecorder(async (sql) => {
      if (
        sql.includes("FROM llm_for_zotero_codex_conversations") &&
        sql.includes("ORDER BY updatedAt DESC")
      ) {
        return [
          {
            conversationKey,
            libraryID: 1,
            kind: "paper",
            paperItemID: 3340,
            createdAt: 100,
            updatedAt: 200,
            title: "Wrong paper",
          },
        ];
      }
      if (
        sql.includes("FROM llm_for_zotero_codex_messages") &&
        sql.includes("paper_contexts_json AS paperContextsJson")
      ) {
        return [
          {
            paperContextsJson: JSON.stringify([
              {
                itemId: 3196,
                contextItemId: 3197,
                title: "Stable and Dynamic Coding for Working Memory",
              },
            ]),
          },
        ];
      }
      return [];
    });
    try {
      await repairCodexConversationIdentityRegistry();

      const repairUpdate = queries.find((query) =>
        query.sql.includes("UPDATE llm_for_zotero_codex_conversations") &&
        query.sql.includes("SET paper_item_id = ?"),
      );
      assert.deepEqual(repairUpdate?.params, [3196, conversationKey]);
      assert.isTrue(
        queries.some((query) =>
          query.sql.includes("INSERT INTO llm_for_zotero_conversation_registry"),
        ),
      );
    } finally {
      restore();
    }
  });
});
