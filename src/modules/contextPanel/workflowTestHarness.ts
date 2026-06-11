import { buildUI } from "./buildUI";
import { setupHandlers } from "./setupHandlers";
import {
  activeContextPanels,
  activeContextPanelRawItems,
  loadedConversationKeys,
} from "./state";
import type { ResolvedContextSource, SendQuestionOptions } from "./types";
import type {
  WorkflowTestApi,
  WorkflowTestDiagnostics,
  WorkflowTestFixture,
  WorkflowTestPanel,
} from "./workflowTestTypes";
import { ensureConversationLoaded, getConversationKey } from "./chat";
import { resolveContextSourceItemAsync } from "./contextResolution";
import { setWorkflowTestSendInterceptor } from "./workflowTestHooks";

type PanelRecord = {
  id: string;
  body: HTMLElement;
  item: Zotero.Item;
  contextSnapshot: ResolvedContextSource | null;
};

const panels = new Map<string, PanelRecord>();
let panelCounter = 0;
let lastSend: SendQuestionOptions | null = null;

function assertWorkflowTestEnabled(): void {
  if (__env__ !== "test" && __env__ !== "development") {
    throw new Error("Workflow test harness is not available in production");
  }
}

function getWorkflowDocument(): Document {
  const directDoc = (globalThis as { document?: Document }).document;
  if (directDoc) return directDoc;
  const mainDoc = Zotero.getMainWindow?.()?.document;
  if (mainDoc) return mainDoc;
  throw new Error("No document available for workflow test panel rendering");
}

function appendHost(doc: Document): HTMLElement {
  const host = doc.createElement("div");
  host.className = "llm-workflow-test-host";
  host.setAttribute("data-llm-workflow-test", "true");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "720px";
  host.style.height = "960px";
  const parent = doc.body || doc.documentElement;
  parent.appendChild(host);
  return host;
}

function getTempPath(filename: string): string {
  const tempDir = Zotero.getTempDirectory?.()?.path?.trim();
  if (!tempDir) throw new Error("Zotero temp directory is unavailable");
  const pathUtils = (
    globalThis as { PathUtils?: { join?: (...parts: string[]) => string } }
  ).PathUtils;
  return pathUtils?.join
    ? pathUtils.join(tempDir, filename)
    : `${tempDir.replace(/[\\/]+$/u, "")}/${filename}`;
}

function minimalPdfBytes(title: string): Uint8Array {
  const safeTitle = title.replace(/[()\\]/gu, " ").slice(0, 80);
  const pdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${safeTitle.length + 64} >> stream`,
    "BT /F1 12 Tf 32 96 Td",
    `(${safeTitle}) Tj`,
    "ET",
    "endstream endobj",
    "xref",
    "0 5",
    "0000000000 65535 f ",
    "trailer << /Root 1 0 R /Size 5 >>",
    "startxref",
    "0",
    "%%EOF",
    "",
  ].join("\n");
  return new TextEncoder().encode(pdf);
}

async function writeTempPdf(title: string): Promise<string> {
  const path = getTempPath(`llm-for-zotero-workflow-${Date.now()}.pdf`);
  const ioUtils = (
    globalThis as unknown as {
      IOUtils?: {
        write?: (path: string, data: Uint8Array) => Promise<unknown>;
      };
    }
  ).IOUtils;
  if (!ioUtils?.write) throw new Error("IOUtils.write is unavailable");
  await ioUtils.write(path, minimalPdfBytes(title));
  return path;
}

async function removePathIfPossible(path: string): Promise<void> {
  if (!path) return;
  try {
    await (
      globalThis as { IOUtils?: { remove?: (path: string) => Promise<void> } }
    ).IOUtils?.remove?.(path);
  } catch (_error) {
    void _error;
  }
}

async function trashItemIfPossible(itemId: number): Promise<void> {
  const item = Zotero.Items.get(itemId);
  if (!item) return;
  try {
    item.deleted = true;
    await item.saveTx();
  } catch (_error) {
    void _error;
  }
}

async function waitForLastSend(): Promise<SendQuestionOptions> {
  const startedAt = Date.now();
  while (!lastSend) {
    if (Date.now() - startedAt > 5000) {
      throw new Error("Timed out waiting for workflow send capture");
    }
    await Zotero.Promise.delay(25);
  }
  return lastSend;
}

function getPanel(panelId: string): PanelRecord {
  const panel = panels.get(panelId);
  if (!panel) throw new Error(`Unknown workflow test panel: ${panelId}`);
  return panel;
}

async function createPaperWithPdfFixture(input: {
  title: string;
  pdfTitle: string;
}): Promise<WorkflowTestFixture> {
  assertWorkflowTestEnabled();
  const libraryID = Zotero.Libraries.userLibraryID;
  const parentItem = new Zotero.Item("journalArticle");
  parentItem.libraryID = libraryID;
  parentItem.setField("title", input.title);
  const savedParentItemId = await parentItem.saveTx();
  const parentItemId = Math.floor(Number(savedParentItemId));
  if (!Number.isFinite(parentItemId) || parentItemId <= 0) {
    throw new Error("Failed to save workflow test parent item");
  }
  const tempPdfPath = await writeTempPdf(input.pdfTitle);
  const attachment = await Zotero.Attachments.importFromFile({
    file: tempPdfPath,
    parentItemID: parentItemId,
    title: input.pdfTitle,
    contentType: "application/pdf",
  });
  const pdfAttachmentId = Math.floor(Number(attachment.id));
  if (!Number.isFinite(pdfAttachmentId) || pdfAttachmentId <= 0) {
    throw new Error("Failed to import workflow test PDF attachment");
  }
  return {
    parentItemId,
    pdfAttachmentId,
    tempPdfPath,
  };
}

async function renderPanelForItem(itemId: number): Promise<WorkflowTestPanel> {
  assertWorkflowTestEnabled();
  const item = Zotero.Items.get(itemId);
  if (!item) throw new Error(`Unable to find Zotero item ${itemId}`);
  const doc = getWorkflowDocument();
  const body = appendHost(doc);
  const panelId = `workflow-panel-${++panelCounter}`;
  body.dataset.workflowPanelId = panelId;
  buildUI(body, item);
  activeContextPanels.set(body, () => item);
  activeContextPanelRawItems.set(body, item);
  loadedConversationKeys.add(getConversationKey(item));
  setupHandlers(body, item);
  await ensureConversationLoaded(item).catch(() => undefined);
  const contextSnapshot = await resolveContextSourceItemAsync(item);
  const panel = { id: panelId, body, item, contextSnapshot };
  panels.set(panelId, panel);
  return { panelId, itemId, contextSnapshot };
}

async function ask(
  panelId: string,
  text: string,
): Promise<SendQuestionOptions> {
  assertWorkflowTestEnabled();
  lastSend = null;
  const panel = getPanel(panelId);
  const input = panel.body.querySelector(
    "#llm-input",
  ) as HTMLTextAreaElement | null;
  if (!input) throw new Error("Workflow test input box was not rendered");
  input.value = text;
  const eventCtor = panel.body.ownerDocument.defaultView?.Event ?? Event;
  input.dispatchEvent(new eventCtor("input", { bubbles: true }));
  const sendBtn = panel.body.querySelector(
    "#llm-send",
  ) as HTMLButtonElement | null;
  if (!sendBtn) throw new Error("Workflow test send button was not rendered");
  sendBtn.click();
  return waitForLastSend();
}

async function getDiagnostics(
  panelId?: string,
): Promise<WorkflowTestDiagnostics> {
  const panel = panelId ? panels.get(panelId) : undefined;
  const body = panel?.body;
  return {
    panelId,
    activeItemId: panel?.item.id,
    contextSnapshot: panel?.contextSnapshot,
    chipText: Array.from(
      body?.querySelectorAll(".llm-paper-context-chip-text") || [],
    ).map((node) => ((node as Element).textContent || "").trim()),
    inputValue: (
      body?.querySelector("#llm-input") as HTMLTextAreaElement | null
    )?.value,
    statusText:
      (body?.querySelector("#llm-status") as HTMLElement | null)?.textContent ||
      undefined,
    lastSend,
  };
}

async function reset(): Promise<void> {
  assertWorkflowTestEnabled();
  lastSend = null;
  for (const panel of panels.values()) {
    activeContextPanels.delete(panel.body);
    activeContextPanelRawItems.delete(panel.body);
    panel.body.remove();
  }
  panels.clear();
  setWorkflowTestSendInterceptor((opts) => {
    lastSend = opts;
  });
}

async function cleanupFixture(fixture: WorkflowTestFixture): Promise<void> {
  assertWorkflowTestEnabled();
  await trashItemIfPossible(fixture.pdfAttachmentId);
  await trashItemIfPossible(fixture.parentItemId);
  await removePathIfPossible(fixture.tempPdfPath);
}

export function installWorkflowTestHarness(targetAddon: {
  api: { workflowTest?: WorkflowTestApi };
}): void {
  if (__env__ !== "test" && __env__ !== "development") return;
  targetAddon.api.workflowTest = {
    reset,
    createPaperWithPdfFixture,
    renderPanelForItem,
    ask,
    getLastSend: () => lastSend,
    getDiagnostics,
    cleanupFixture,
  };
}
