import type { ResolvedContextSource, SendQuestionOptions } from "./types";

export type WorkflowTestFixture = {
  parentItemId: number;
  pdfAttachmentId: number;
  tempPdfPath: string;
};

export type WorkflowTestPanel = {
  panelId: string;
  itemId: number;
  contextSnapshot: ResolvedContextSource | null;
};

export type WorkflowTestDiagnostics = {
  panelId?: string;
  activeItemId?: number;
  contextSnapshot?: ResolvedContextSource | null;
  chipText: string[];
  inputValue?: string;
  statusText?: string;
  lastSend: SendQuestionOptions | null;
};

export type WorkflowTestApi = {
  reset: () => Promise<void>;
  createPaperWithPdfFixture: (input: {
    title: string;
    pdfTitle: string;
  }) => Promise<WorkflowTestFixture>;
  renderPanelForItem: (itemId: number) => Promise<WorkflowTestPanel>;
  ask: (panelId: string, text: string) => Promise<SendQuestionOptions>;
  getLastSend: () => SendQuestionOptions | null;
  getDiagnostics: (panelId?: string) => Promise<WorkflowTestDiagnostics>;
  cleanupFixture: (fixture: WorkflowTestFixture) => Promise<void>;
};
