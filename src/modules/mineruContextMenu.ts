import { config } from "../../package.json";
import { processSelectedItems } from "./mineruBatchProcessor";

/**
 * Collect PDF attachment IDs from currently selected Zotero items.
 * - If the item is itself a PDF attachment, use its ID directly.
 * - If the item is a regular library item, find its first PDF child attachment.
 */
async function collectPdfAttachmentIds(items: Zotero.Item[]): Promise<number[]> {
  const ids: number[] = [];
  for (const item of items) {
    if (item.isAttachment() && item.attachmentContentType === "application/pdf") {
      ids.push(item.id);
    } else if (item.isRegularItem()) {
      const childIds = item.getAttachments();
      for (const attId of childIds) {
        const att = Zotero.Items.get(attId);
        if (att?.isAttachment() && att.attachmentContentType === "application/pdf") {
          ids.push(attId);
          break; // take only the first PDF per item
        }
      }
    }
  }
  return ids;
}

/**
 * Command handler for the "MinerU: Parse PDF" right-click menu item.
 * Retrieves selected items, extracts their PDF attachment IDs,
 * then calls processSelectedItems (the same entry point used by
 * the "Start Selected" button in the MinerU Manager panel).
 */
export async function handleMineruContextCommand(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane?.();
  if (!pane) return;

  const selectedItems: Zotero.Item[] = pane.getSelectedItems?.() ?? [];
  if (selectedItems.length === 0) return;

  const pdfIds = await collectPdfAttachmentIds(selectedItems);
  if (pdfIds.length === 0) {
    ztoolkit.log("LLM MinerU context menu: no PDF attachments in selected items");
    return;
  }

  // processSelectedItems internally creates a filenameMatcher if none
  // is provided, so we don't need to pass one explicitly.
  await processSelectedItems(pdfIds);
}

/**
 * Register the "MinerU: Parse PDF" menu item on Zotero's native
 * item context menu (#zotero-itemmenu).
 *
 * Uses ztoolkit.Menu.register("item", ...) which automatically
 * handles cleanup when ztoolkit.unregisterAll() is called.
 */
export function registerMineruContextMenu(): void {
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${config.addonRef}-mineru-context-process`,
    label: "MinerU: Parse PDF",
    commandListener: () => {
      void handleMineruContextCommand();
    },
    icon: `chrome://${config.addonRef}/content/icons/icon-20.png`,
  });
}
