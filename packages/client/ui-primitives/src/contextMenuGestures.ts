/**
 * The gestures behind right-click rows, expressed against the DOM editing
 * commands the platform still exposes to script.
 *
 * Paste is the only row a real implementation cannot borrow: the browser
 * blocks `execCommand('paste')`, so a paste row dispatches the very event the
 * keyboard shortcut delivers. That is not a trick for its own sake — it is
 * what routes the gesture into the composer's own paste pipeline (image
 * intake, long-text folding, mention hydration) instead of a second,
 * thinner one living here.
 */
import type { ContextMenuActions, ContextMenuHit } from "./context-menu.ts";

/** Clipboard payload pulled for one paste gesture. */
interface ClipboardContent {
  readonly text: string;
  readonly files: readonly File[];
}

/** Text controls take `insertText`; editors own their own paste pipeline. */
function isNativeTextControl(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** Put the caret back where the right-click happened before editing. */
function focusEditable(hit: ContextMenuHit): void {
  hit.editable?.focus();
}

/**
 * Read the clipboard into text + files.
 *
 * Text and files are pulled separately on purpose: a picture on the clipboard
 * still pastes as a picture when `readText` is refused.
 */
async function readClipboardContent(): Promise<ClipboardContent> {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) return { text: "", files: [] };
  let text = "";
  try {
    text = typeof clipboard.readText === "function" ? await clipboard.readText() : "";
  } catch {
    // Permission refused: files may still be readable, and vice versa.
  }
  const files: File[] = [];
  try {
    if (typeof clipboard.read === "function") {
      for (const item of await clipboard.read()) {
        for (const type of item.types) {
          if (type === "text/plain") continue;
          files.push(new File([await item.getType(type)], "clipboard", { type }));
        }
      }
    }
  } catch {
    // Same tolerance: whatever landed still pastes.
  }
  return { text, files };
}

/**
 * Deliver a paste to an editor.
 * Only `text/plain` rides along for the plain-text row, so a composer with
 * both file and text intake takes its plain-text branch.
 */
function dispatchPasteEvent(el: HTMLElement, content: ClipboardContent): void {
  const data = new DataTransfer();
  if (content.text !== "") data.setData("text/plain", content.text);
  for (const file of content.files) data.items.add(file);
  el.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Paste at the right-click caret.
 * Synthetic paste events never run the browser's default insertion, so a plain
 * input / textarea takes the same `insertText` command the engine issues for
 * its own Ctrl+V.
 */
async function pasteAt(hit: ContextMenuHit, plainText: boolean): Promise<void> {
  focusEditable(hit);
  const el = hit.editable;
  if (el === null) return;
  const content = await readClipboardContent();
  if (isNativeTextControl(el)) {
    if (content.text !== "") document.execCommand("insertText", false, content.text);
    return;
  }
  if (content.text === "" && content.files.length === 0) return;
  dispatchPasteEvent(el, plainText ? { text: content.text, files: [] } : content);
}

/** DOM-backed actions; every row mirrors the keyboard shortcut of the same name. */
export const domContextMenuActions: ContextMenuActions = {
  copy(hit) {
    focusEditable(hit);
    document.execCommand("copy");
  },
  cut(hit) {
    focusEditable(hit);
    document.execCommand("cut");
  },
  remove(hit) {
    focusEditable(hit);
    document.execCommand("delete");
  },
  selectAll(hit) {
    focusEditable(hit);
    document.execCommand("selectAll");
  },
  undo(hit) {
    focusEditable(hit);
    document.execCommand("undo");
  },
  redo(hit) {
    focusEditable(hit);
    document.execCommand("redo");
  },
  copyText(text) {
    void navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard blocked: the selection-based copy row is still there.
    });
  },
  paste(hit, plainText) {
    void pasteAt(hit, plainText);
  },
};
