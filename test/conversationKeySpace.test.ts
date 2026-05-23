import { assert } from "chai";
import {
  CLAUDE_GLOBAL_CONVERSATION_KEY_BASE,
  CLAUDE_PAPER_CONVERSATION_KEY_BASE,
  CODEX_GLOBAL_CONVERSATION_KEY_BASE,
  CODEX_PAPER_CONVERSATION_KEY_BASE,
  UPSTREAM_GLOBAL_CONVERSATION_KEY_BASE,
  UPSTREAM_PAPER_CONVERSATION_KEY_BASE,
  RUNTIME_CONVERSATION_KEY_END,
  buildDefaultConversationKey,
  classifyConversationKey,
  getConversationKeyRange,
  isConversationKeyForKind,
} from "../src/shared/conversationKeySpace";
import { isClaudeConversationKey } from "../src/claudeCode/constants";
import { isCodexConversationKey } from "../src/codexAppServer/constants";

describe("conversation key space", function () {
  it("classifies Claude keys only as Claude", function () {
    const globalKey = CLAUDE_GLOBAL_CONVERSATION_KEY_BASE + 1;
    const paperKey = CLAUDE_PAPER_CONVERSATION_KEY_BASE + 1;

    assert.deepEqual(classifyConversationKey(globalKey), {
      system: "claude_code",
      kind: "global",
    });
    assert.deepEqual(classifyConversationKey(paperKey), {
      system: "claude_code",
      kind: "paper",
    });
    assert.isTrue(isClaudeConversationKey(globalKey));
    assert.isTrue(isClaudeConversationKey(paperKey));
    assert.isFalse(isCodexConversationKey(globalKey));
    assert.isFalse(isCodexConversationKey(paperKey));
  });

  it("classifies Codex keys only as Codex", function () {
    const globalKey = CODEX_GLOBAL_CONVERSATION_KEY_BASE + 1;
    const paperKey = CODEX_PAPER_CONVERSATION_KEY_BASE + 1;

    assert.deepEqual(classifyConversationKey(globalKey), {
      system: "codex",
      kind: "global",
    });
    assert.deepEqual(classifyConversationKey(paperKey), {
      system: "codex",
      kind: "paper",
    });
    assert.isTrue(isCodexConversationKey(globalKey));
    assert.isTrue(isCodexConversationKey(paperKey));
    assert.isFalse(isClaudeConversationKey(globalKey));
    assert.isFalse(isClaudeConversationKey(paperKey));
  });

  it("classifies upstream global and historical paper keys separately", function () {
    assert.deepEqual(
      classifyConversationKey(UPSTREAM_GLOBAL_CONVERSATION_KEY_BASE),
      {
        system: "upstream",
        kind: "global",
      },
    );
    assert.deepEqual(
      classifyConversationKey(UPSTREAM_PAPER_CONVERSATION_KEY_BASE),
      {
        system: "upstream",
        kind: "paper",
      },
    );
    assert.deepEqual(classifyConversationKey(42), {
      system: "upstream",
      kind: "paper",
    });
    assert.isFalse(isConversationKeyForKind("upstream", "global", 42));
  });

  it("leaves future high-key bands unclassified", function () {
    assert.isNull(classifyConversationKey(RUNTIME_CONVERSATION_KEY_END));
    assert.isFalse(isClaudeConversationKey(RUNTIME_CONVERSATION_KEY_END));
    assert.isFalse(isCodexConversationKey(RUNTIME_CONVERSATION_KEY_END));
  });

  it("builds default profile-scoped runtime keys inside the requested range", function () {
    const range = getConversationKeyRange("codex", "paper", "profile-0");
    const key = buildDefaultConversationKey(
      "codex",
      "paper",
      42,
      "profile-0",
    );

    assert.equal(key, range.start + 42);
    assert.isAtLeast(key, range.start);
    assert.isBelow(key, range.endExclusive);
    assert.deepEqual(classifyConversationKey(key), {
      system: "codex",
      kind: "paper",
    });
  });
});
