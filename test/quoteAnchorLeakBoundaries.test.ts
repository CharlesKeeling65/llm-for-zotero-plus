import { assert } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(resolve(testDir, "..", path), "utf8");
}

describe("quote anchor leak boundaries", function () {
  it("renders assistant bubbles through the quote-anchor display helper", function () {
    const chatSource = source("src/modules/contextPanel/chat.ts");

    assert.include(
      chatSource,
      "const safeText = buildAssistantDisplayMarkdownForRender(msg);",
    );
    assert.notInclude(chatSource, "const safeText = sanitizeText(msg.text);");
    assert.notInclude(
      chatSource,
      "renderRenderedMarkdownInto(bubble, sanitizeText(msg.text",
    );
  });

  it("renders agent trace markdown through the quote-anchor display helper", function () {
    const traceSource = source("src/modules/contextPanel/agentTrace/render.ts");

    assert.include(traceSource, "buildAgentTraceMarkdownForRender(");
    assert.include(traceSource, "itemEntry.text,");
    assert.include(
      traceSource,
      "renderRenderedMarkdownInto(inlineEl, inlineText",
    );
    assert.notInclude(
      traceSource,
      "renderRenderedMarkdownInto(inlineEl, itemEntry.text",
    );
    assert.notInclude(traceSource, "inlineEl.textContent = itemEntry.text");
  });

  it("copies and exports quote anchors with unavailable fallback enabled", function () {
    const chatSource = source("src/modules/contextPanel/chat.ts");
    const notesSource = source("src/modules/contextPanel/notes.ts");
    const menuSource = source(
      "src/modules/contextPanel/setupHandlers/controllers/menuActionController.ts",
    );

    assert.include(menuSource, "target.quoteCitations");
    assert.include(chatSource, '{ unresolved: "unavailable" }');
    assert.include(notesSource, '{ unresolved: "unavailable" }');
  });
});
