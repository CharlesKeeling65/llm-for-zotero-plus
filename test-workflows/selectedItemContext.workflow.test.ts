import { assert } from "chai";
import type {
  WorkflowTestApi,
  WorkflowTestFixture,
} from "../src/modules/contextPanel/workflowTestTypes";

function getWorkflowTestApi(): WorkflowTestApi {
  const api = (Zotero as any).LLMForZotero?.api?.workflowTest;
  assert.isOk(api, "workflow test API should be installed");
  return api as WorkflowTestApi;
}

async function diagnosticsMessage(
  api: WorkflowTestApi,
  panelId?: string,
): Promise<string> {
  const diagnostics = await api.getDiagnostics(panelId);
  return JSON.stringify(
    {
      panelId: diagnostics.panelId,
      activeItemId: diagnostics.activeItemId,
      contextSnapshot: diagnostics.contextSnapshot,
      chipText: diagnostics.chipText,
      inputValue: diagnostics.inputValue,
      statusText: diagnostics.statusText,
      lastSend: diagnostics.lastSend
        ? {
            contextSource: diagnostics.lastSend.contextSource,
            question: diagnostics.lastSend.question,
            paperContexts: diagnostics.lastSend.paperContexts,
            fullTextPaperContexts: diagnostics.lastSend.fullTextPaperContexts,
          }
        : null,
    },
    null,
    2,
  );
}

describe("workflow: selected item context send", function () {
  this.timeout(30000);

  let api: WorkflowTestApi;
  let fixture: WorkflowTestFixture | null = null;

  beforeEach(async function () {
    api = getWorkflowTestApi();
    await api.reset();
  });

  afterEach(async function () {
    if (fixture) {
      await api.cleanupFixture(fixture);
      fixture = null;
    }
    await api.reset();
  });

  it("resolves a selected parent paper to its PDF context and captures it on send", async function () {
    fixture = await api.createPaperWithPdfFixture({
      title: "Workflow Harness Parent Paper",
      pdfTitle: "Workflow Harness Main PDF",
    });

    const panel = await api.renderPanelForItem(fixture.parentItemId);
    const context = panel.contextSnapshot;
    assert.isOk(
      context?.paperContext,
      await diagnosticsMessage(api, panel.panelId),
    );
    assert.equal(
      context?.paperContext?.itemId,
      fixture.parentItemId,
      await diagnosticsMessage(api, panel.panelId),
    );
    assert.equal(
      context?.paperContext?.contextItemId,
      fixture.pdfAttachmentId,
      await diagnosticsMessage(api, panel.panelId),
    );
    assert.notEqual(
      context?.sourceKind,
      "none",
      await diagnosticsMessage(api, panel.panelId),
    );

    const send = await api.ask(panel.panelId, "What is this paper about?");
    assert.include(send.question, "What is this paper about?");
    assert.equal(
      send.contextSource?.paperContext?.itemId,
      fixture.parentItemId,
      await diagnosticsMessage(api, panel.panelId),
    );
    assert.equal(
      send.contextSource?.paperContext?.contextItemId,
      fixture.pdfAttachmentId,
      await diagnosticsMessage(api, panel.panelId),
    );
    assert.deepEqual(api.getLastSend(), send);
  });
});
