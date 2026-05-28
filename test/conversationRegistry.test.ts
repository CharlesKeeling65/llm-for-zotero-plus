import { assert } from "chai";
import {
  inferSinglePaperItemIdFromContextRows,
  registerConversationScope,
  validateConversationScope,
} from "../src/shared/conversationRegistry";

describe("conversation registry", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, unknown>;
  };
  const originalZotero = globalScope.Zotero;

  afterEach(function () {
    globalScope.Zotero = originalZotero;
  });

  it("rejects scope and profile mismatches for a registered key", async function () {
    globalScope.Zotero = {
      Profile: {
        dir: "/tmp/llm-for-zotero-registry-test",
      },
      DB: {
        queryAsync: async (sql: string) => {
          if (
            sql.includes("FROM llm_for_zotero_conversation_registry") &&
            sql.includes("WHERE conversation_key = ?")
          ) {
            return [
              {
                conversationKey: 123,
                system: "codex",
                kind: "paper",
                profileSignature: "profile-dev",
                libraryID: 1,
                paperItemID: 3196,
                valid: 1,
              },
            ];
          }
          return [];
        },
      },
    };

    assert.equal(
      await validateConversationScope({
        conversationKey: 123,
        system: "codex",
        kind: "paper",
        profileSignature: "profile-dev",
        libraryID: 1,
        paperItemID: 3196,
      }),
      true,
    );
    assert.equal(
      await validateConversationScope({
        conversationKey: 123,
        system: "codex",
        kind: "paper",
        profileSignature: "profile-dev",
        libraryID: 1,
        paperItemID: 3340,
      }),
      false,
    );
    assert.equal(
      await validateConversationScope({
        conversationKey: 123,
        system: "codex",
        kind: "paper",
        profileSignature: "profile-other",
        libraryID: 1,
        paperItemID: 3196,
      }),
      false,
    );
  });

  it("treats unregistered runtime keys as unsafe once the registry DB exists", async function () {
    globalScope.Zotero = {
      Profile: {
        dir: "/tmp/llm-for-zotero-registry-test",
      },
      DB: {
        queryAsync: async () => [],
      },
    };

    assert.equal(
      await validateConversationScope({
        conversationKey: 123,
        system: "codex",
        kind: "paper",
        profileSignature: "profile-dev",
        libraryID: 1,
        paperItemID: 3196,
      }),
      false,
    );
    assert.equal(
      await validateConversationScope({
        conversationKey: 123,
        system: "upstream",
        kind: "paper",
        profileSignature: "profile-dev",
        libraryID: 1,
        paperItemID: 3196,
      }),
      true,
    );
  });

  it("does not clear invalid registry state during ordinary registration", async function () {
    const row = {
      conversationKey: 123,
      system: "codex",
      kind: "paper",
      profileSignature: "profile-dev",
      libraryID: 1,
      paperItemID: 3196,
      valid: 0,
      invalidReason: "ambiguous paper context evidence",
      title: "Ambiguous chat",
      updatedAt: 100,
    };
    globalScope.Zotero = {
      Profile: {
        dir: "/tmp/llm-for-zotero-registry-test",
      },
      DB: {
        queryAsync: async (sql: string, params?: unknown[]) => {
          if (
            sql.includes("FROM llm_for_zotero_conversation_registry") &&
            sql.includes("WHERE conversation_key = ?")
          ) {
            return [row];
          }
          if (sql.includes("INSERT INTO llm_for_zotero_conversation_registry")) {
            if (sql.includes("valid = 1")) row.valid = 1;
            if (sql.includes("invalid_reason = NULL")) {
              row.invalidReason = "";
            }
            row.updatedAt = Number(params?.[7] || row.updatedAt);
          }
          return [];
        },
      },
    };

    const scope = {
      conversationKey: 123,
      system: "codex" as const,
      kind: "paper" as const,
      profileSignature: "profile-dev",
      libraryID: 1,
      paperItemID: 3196,
    };
    assert.equal(await validateConversationScope(scope), false);
    assert.equal(
      await registerConversationScope({
        ...scope,
        updatedAt: 200,
        title: "Same ambiguous chat",
      }),
      true,
    );
    assert.equal(row.valid, 0);
    assert.equal(row.invalidReason, "ambiguous paper context evidence");
    assert.equal(await validateConversationScope(scope), false);
  });

  it("allows validation in test contexts where Zotero DB is unavailable", async function () {
    globalScope.Zotero = {};

    assert.equal(
      await validateConversationScope({
        conversationKey: 123,
        system: "codex",
        kind: "paper",
        profileSignature: "profile-dev",
        libraryID: 1,
        paperItemID: 3196,
      }),
      true,
    );
  });

  it("infers only unambiguous paper ownership from stored context JSON", function () {
    assert.equal(
      inferSinglePaperItemIdFromContextRows([
        {
          paperContextsJson: JSON.stringify([
            { itemId: 3196, contextItemId: 3197, title: "Paper" },
          ]),
          fullTextPaperContextsJson: JSON.stringify([
            { itemID: 3196, contextItemId: 3198, title: "Paper" },
          ]),
        },
      ]),
      3196,
    );
    assert.equal(
      inferSinglePaperItemIdFromContextRows([
        {
          paperContextsJson: JSON.stringify([{ itemId: 3196 }]),
          citationPaperContextsJson: JSON.stringify([{ itemId: 3340 }]),
        },
      ]),
      "ambiguous",
    );
  });
});
