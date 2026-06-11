import type { SendQuestionOptions } from "./types";

export type WorkflowTestSendInterceptor = (
  opts: SendQuestionOptions,
) => Promise<void> | void;

let sendInterceptor: WorkflowTestSendInterceptor | null = null;

export function setWorkflowTestSendInterceptor(
  interceptor: WorkflowTestSendInterceptor | null,
): void {
  sendInterceptor = interceptor;
}

export function getWorkflowTestSendInterceptor(): WorkflowTestSendInterceptor | null {
  return sendInterceptor;
}
