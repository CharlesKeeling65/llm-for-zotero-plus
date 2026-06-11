import { assert } from "chai";
import { attachMenuActionController } from "../src/modules/contextPanel/setupHandlers/controllers/menuActionController";

class FakeElement {
  public dataset: Record<string, string | undefined> = {};
  public textContent = "";
  public className = "";
  private readonly listeners = new Map<string, Array<(event: any) => unknown>>();

  addEventListener(type: string, listener: (event: any) => unknown): void {
    const existing = this.listeners.get(type) || [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  async dispatch(type: string): Promise<void> {
    const event = {
      preventDefault() {},
      stopPropagation() {},
    };
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
  }
}

describe("menu action controller note routing", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: {
      Item?: new (itemType: string) => Zotero.Item;
    };
    ztoolkit?: {
      log?: (...args: unknown[]) => void;
    };
  };
  const originalZotero = globalScope.Zotero;
  const originalZtoolkit = globalScope.ztoolkit;
  const savedNotes: MockNoteItem[] = [];

  class MockNoteItem {
    id = 0;
    libraryID = 0;
    parentID?: number;
    private noteHtml = "";

    constructor(itemType: string) {
      assert.equal(itemType, "note");
    }

    isNote() {
      return true;
    }

    setNote(html: string) {
      this.noteHtml = html;
    }

    getNote() {
      return this.noteHtml;
    }

    async saveTx() {
      if (!this.id) {
        this.id = 100 + savedNotes.length;
        savedNotes.push(this);
      }
      return this.id;
    }
  }

  beforeEach(function () {
    savedNotes.splice(0);
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Item: MockNoteItem as unknown as new (itemType: string) => Zotero.Item,
    };
    globalScope.ztoolkit = {
      ...(originalZtoolkit || {}),
      log: () => {},
    };
  });

  afterEach(function () {
    if (originalZotero) {
      globalScope.Zotero = originalZotero;
    } else {
      delete globalScope.Zotero;
    }
    if (originalZtoolkit) {
      globalScope.ztoolkit = originalZtoolkit;
    } else {
      delete globalScope.ztoolkit;
    }
  });

  it("saves response-menu notes as standalone notes in library chat mode", async function () {
    const responseMenu = new FakeElement();
    const responseMenuNoteBtn = new FakeElement();
    const status = new FakeElement();
    const logErrors: unknown[] = [];
    const currentItem = {
      id: 42,
      libraryID: 1,
    } as unknown as Zotero.Item;

    attachMenuActionController({
      body: new FakeElement() as unknown as Element,
      status: status as unknown as HTMLElement,
      responseMenu: responseMenu as unknown as HTMLDivElement,
      responseMenuCopyBtn: new FakeElement() as unknown as HTMLButtonElement,
      responseMenuNoteBtn: responseMenuNoteBtn as unknown as HTMLButtonElement,
      responseMenuDeleteBtn: null,
      promptMenu: null,
      promptMenuDeleteBtn: null,
      exportMenu: null,
      exportMenuCopyBtn: null,
      exportMenuNoteBtn: null,
      exportBtn: null,
      popoutBtn: null,
      settingsBtn: null,
      preferencesPaneId: "llm-for-zotero-test",
      getItem: () => currentItem,
      getResponseMenuTarget: () => ({
        item: currentItem,
        contentText: "Generated a figure.",
        modelName: "Codex",
      }),
      getPromptMenuTarget: () => null,
      getCurrentLibraryID: () => 1,
      getConversationSystem: () => "codex",
      getCurrentRuntimeModeForItem: () => "agent",
      isGlobalMode: () => true,
      ensureConversationLoaded: async () => {},
      getConversationKey: () => 1,
      getHistory: () => [],
      resolveActiveNoteSession: () => null,
      closeResponseMenu: () => {},
      closePromptMenu: () => {},
      closeExportMenu: () => {},
      closeRetryModelMenu: () => {},
      closeSlashMenu: () => {},
      closeHistoryNewMenu: () => {},
      closeHistoryMenu: () => {},
      queueTurnDeletion: async () => {},
      logError: (...args: unknown[]) => {
        logErrors.push(args);
      },
    });

    await responseMenuNoteBtn.dispatch("click");

    assert.lengthOf(savedNotes, 1);
    assert.equal(savedNotes[0].libraryID, 1);
    assert.isUndefined(savedNotes[0].parentID);
    assert.include(savedNotes[0].getNote(), "Generated a figure.");
    assert.equal(status.textContent, "Created a new note");
    assert.isEmpty(logErrors);
  });
});
