import fs from "node:fs";
import path from "node:path";
import { assert } from "chai";

describe("webchat extension DOM contracts", function () {
  const fixtureDir = path.resolve(process.cwd(), "test/fixtures/webchat");
  const syncRepo = path.resolve(process.cwd(), "../sync-for-zotero");
  const contentScript = path.join(syncRepo, "extension/content_script.js");

  it("documents the ChatGPT DOM anchors used by the bridge", function () {
    const fixture = fs.readFileSync(
      path.join(fixtureDir, "chatgpt-dom.html"),
      "utf8",
    );

    assert.include(fixture, '<form data-testid="composer">');
    assert.include(fixture, 'button data-testid="send-button"');
    assert.include(fixture, '<input type="file" hidden');
    assert.include(fixture, 'href="/c/chatgpt-thread-1"');
  });

  it("documents the DeepSeek DOM anchors used by the bridge", function () {
    const fixture = fs.readFileSync(
      path.join(fixtureDir, "deepseek-dom.html"),
      "utf8",
    );

    assert.include(fixture, 'textarea placeholder="Message DeepSeek"');
    assert.include(fixture, "ds-button--circle");
    assert.include(fixture, "ds-button--disabled");
    assert.include(fixture, '<input type="file" hidden');
    assert.include(fixture, "ds-message");
    assert.include(fixture, "ds-assistant-message-main-content");
    assert.include(fixture, "ds-think-content");
  });

  it("keeps DeepSeek extraction compatible with Chrome 102 selector support", function () {
    if (!fs.existsSync(contentScript)) {
      this.skip();
    }

    const source = fs.readFileSync(contentScript, "utf8");

    assert.notInclude(source, "div.ds-message:not(:has");
    assert.notInclude(source, "div.ds-message:has(.ds-markdown)");
    assert.include(source, 'conversationMessageSelector: "div.ds-message"');
    assert.include(source, 'userMessageSelector: "div.ds-message"');
    assert.include(source, "assistantMessageSelectors");
    assert.include(source, '".ds-think-content"');
    assert.include(source, "\"[class*='think']\"");
    assert.include(source, "getUserMessageCount()");
  });
});
