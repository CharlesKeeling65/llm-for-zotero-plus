import { assert } from "chai";
import { describe, it, afterEach } from "mocha";

import { clearPendingRequestIdAndSync } from "../src/modules/contextPanel/chat";
import {
  activeContextPanels,
  activeContextPanelStateSync,
  clearAllState,
  isRequestPending,
  setPendingRequestId,
} from "../src/modules/contextPanel/state";

function fakeItem(id: number): Zotero.Item {
  return {
    id,
    isAttachment: () => false,
  } as unknown as Zotero.Item;
}

function fakePanelBody(conversationKey: number): Element {
  const root = {
    dataset: { itemId: String(conversationKey) },
  };
  return {
    isConnected: true,
    querySelector: (selector: string) =>
      selector === "#llm-main" ? root : null,
  } as unknown as Element;
}

describe("chat request lifecycle sync", function () {
  afterEach(() => {
    clearAllState();
  });

  it("resyncs another live panel when a shared conversation finishes", function () {
    const conversationKey = 101;
    const sourceBody = fakePanelBody(conversationKey);
    const standaloneBody = fakePanelBody(conversationKey);
    const unrelatedBody = fakePanelBody(202);
    const synced: number[] = [];

    activeContextPanels.set(standaloneBody, () => fakeItem(conversationKey));
    activeContextPanels.set(unrelatedBody, () => fakeItem(202));
    activeContextPanelStateSync.set(standaloneBody, () =>
      synced.push(conversationKey),
    );
    activeContextPanelStateSync.set(unrelatedBody, () => synced.push(202));

    setPendingRequestId(conversationKey, 7);
    assert.isTrue(isRequestPending(conversationKey));

    clearPendingRequestIdAndSync(
      conversationKey,
      sourceBody,
      fakeItem(conversationKey),
    );

    assert.isFalse(isRequestPending(conversationKey));
    assert.deepEqual(synced, [conversationKey]);
  });
});
