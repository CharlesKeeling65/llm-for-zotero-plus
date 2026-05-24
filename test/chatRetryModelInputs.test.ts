import { assert } from "chai";
import {
  buildAssistantDisplayMarkdownForRender,
  buildRenderedMarkdownClipboardPayload,
  resolveRetryModelInputsForTests,
  type EffectiveRequestConfig,
} from "../src/modules/contextPanel/chat";
import { buildQuoteCitation } from "../src/modules/contextPanel/quoteCitations";
import type {
  ChatAttachment,
  Message,
} from "../src/modules/contextPanel/types";
import { FULL_PDF_UNSUPPORTED_MESSAGE } from "../src/modules/contextPanel/pdfSupportMessages";

describe("chat retry model inputs", function () {
  const visiblePdf: ChatAttachment = {
    id: "pdf-paper-123-1",
    name: "paper.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    category: "pdf",
    storedPath: "/tmp/paper.pdf",
  };

  it("expands quote anchors before rendering assistant bubbles", function () {
    const quoteCitation = buildQuoteCitation({
      quoteText: "Rendered quote anchors should not leak.",
      citationLabel: "(Lee, 2026)",
      contextItemId: 42,
    });
    assert.isDefined(quoteCitation);

    const rendered = buildAssistantDisplayMarkdownForRender({
      text: `Evidence:\n\n[[quote:${quoteCitation!.id}]]`,
      quoteCitations: [quoteCitation!],
    });

    assert.include(rendered, "> Rendered quote anchors");
    assert.include(rendered, "(Lee, 2026)");
    assert.notInclude(rendered, "[[quote:");
  });

  it("does not render unresolved quote anchors in assistant bubbles", function () {
    const rendered = buildAssistantDisplayMarkdownForRender({
      text: "Evidence:\n\n[[quote:Q_missing]]",
      quoteCitations: [],
    });

    assert.include(rendered, "[quote unavailable]");
    assert.notInclude(rendered, "[[quote:");
  });

  it("expands quote anchors in rendered clipboard payloads", function () {
    const quoteCitation = buildQuoteCitation({
      quoteText: "Clipboard quote anchors should not leak.",
      citationLabel: "(Lee, 2026)",
      contextItemId: 42,
    });
    assert.isDefined(quoteCitation);

    const payload = buildRenderedMarkdownClipboardPayload(
      `Evidence:\n\n[[quote:${quoteCitation!.id}]]`,
      [quoteCitation!],
    );

    assert.isNotNull(payload);
    assert.include(payload!.plainText, "> Clipboard quote anchors");
    assert.include(payload!.plainText, "(Lee, 2026)");
    assert.notInclude(payload!.plainText, "[[quote:");
    assert.include(payload!.renderedHtml, "<blockquote>");
    assert.notInclude(payload!.renderedHtml, "[[quote:");
  });

  it("does not leak unresolved quote anchors in clipboard payloads", function () {
    const payload = buildRenderedMarkdownClipboardPayload(
      "Evidence:\n\n[[quote:Q_missing]]",
      [],
    );

    assert.isNotNull(payload);
    assert.include(payload!.plainText, "[quote unavailable]");
    assert.notInclude(payload!.plainText, "[[quote:");
    assert.notInclude(payload!.renderedHtml, "[[quote:");
  });

  const visionConfig: EffectiveRequestConfig = {
    model: "third-party-vision",
    apiBase: "https://example.test/v1",
    apiKey: "",
    authMode: "api_key",
    providerProtocol: "openai_chat_compat",
    modelEntryId: "vision-entry",
    modelProviderLabel: "OpenAI compatible",
    reasoning: undefined,
    advanced: undefined,
  };

  function retryUserMessage(): Message {
    return {
      role: "user",
      text: "Read this PDF",
      timestamp: 1,
      attachments: [visiblePdf],
      modelAttachments: [],
      modelName: visionConfig.model,
      modelEntryId: visionConfig.modelEntryId,
      modelProviderLabel: visionConfig.modelProviderLabel,
    };
  }

  it("fails same-provider retries when the target no longer supports full PDF mode", async function () {
    const screenshotImages = ["data:image/png;base64,abc"];

    try {
      await resolveRetryModelInputsForTests({
        userMessage: retryUserMessage(),
        visibleAttachments: [visiblePdf],
        screenshotImages,
        effectiveRequestConfig: visionConfig,
      });
      assert.fail("Expected non-native PDF retry to reject");
    } catch (err) {
      assert.equal(
        err instanceof Error ? err.message : String(err),
        FULL_PDF_UNSUPPORTED_MESSAGE,
      );
    }
  });

  it("recomputes PDF handling when retry switches to a native PDF provider", async function () {
    const nativeConfig: EffectiveRequestConfig = {
      ...visionConfig,
      model: "gpt-4.1",
      apiBase: "https://api.openai.com/v1",
      providerProtocol: "responses_api",
      modelEntryId: "openai-entry",
      modelProviderLabel: "OpenAI",
    };

    const result = await resolveRetryModelInputsForTests({
      userMessage: retryUserMessage(),
      visibleAttachments: [visiblePdf],
      screenshotImages: [],
      effectiveRequestConfig: nativeConfig,
    });

    assert.lengthOf(result.modelAttachments || [], 1);
    assert.equal(result.modelAttachments?.[0]?.id, visiblePdf.id);
    assert.equal(result.modelAttachments?.[0]?.category, "pdf");
  });

  it("fails PDF retries when retry switches to a text-only model", async function () {
    const textOnlyConfig: EffectiveRequestConfig = {
      ...visionConfig,
      model: "deepseek-reasoner",
      modelEntryId: "deepseek-entry",
      modelProviderLabel: "DeepSeek",
    };

    try {
      await resolveRetryModelInputsForTests({
        userMessage: retryUserMessage(),
        visibleAttachments: [visiblePdf],
        screenshotImages: [],
        effectiveRequestConfig: textOnlyConfig,
      });
      assert.fail("Expected text-only PDF retry to reject");
    } catch (err) {
      assert.equal(
        err instanceof Error ? err.message : String(err),
        FULL_PDF_UNSUPPORTED_MESSAGE,
      );
    }
  });

  it("fails Moonshot PDF retries before provider upload preparation", async function () {
    const missingStoredPathPdf: ChatAttachment = {
      id: "pdf-paper-123-1",
      name: "paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      category: "pdf",
    };
    const uploadConfig: EffectiveRequestConfig = {
      ...visionConfig,
      model: "kimi-k2.5",
      apiBase: "https://api.moonshot.cn/v1",
      apiKey: "test-key",
      modelEntryId: "kimi-entry",
      modelProviderLabel: "Kimi",
    };

    try {
      await resolveRetryModelInputsForTests({
        userMessage: {
          ...retryUserMessage(),
          attachments: [missingStoredPathPdf],
        },
        visibleAttachments: [missingStoredPathPdf],
        screenshotImages: [],
        effectiveRequestConfig: uploadConfig,
      });
      assert.fail("Expected Moonshot PDF retry to reject");
    } catch (err) {
      assert.equal(
        err instanceof Error ? err.message : String(err),
        FULL_PDF_UNSUPPORTED_MESSAGE,
      );
    }
  });
});
