/**
 * The gestures behind right-click rows.
 *
 * Contenteditable surfaces (the Lexical composer) own editing through the same
 * DOM events the keyboard uses — `beforeinput` (`historyUndo` / `historyRedo`
 * / `deleteContentBackward`) and `cut` / `copy` / `paste` — so the menu must
 * not call `document.execCommand('undo'|'redo')` against the browser stack
 * while `@lexical/history` holds the real one. Native input / textarea still
 * use execCommand / setRangeText.
 *
 * Cut / Copy / Delete restore the selection bookmark captured at right-click
 * time: focusing the menu's first row otherwise clears a contenteditable
 * highlight.
 */
import {
  restoreContextMenuSelection,
} from "./context-menu.ts";
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

/**
 * Put the caret / highlight back where the right-click happened before editing.
 * Always restores the bookmark after focus: the menu steals focus for its
 * keyboard walk, and a contenteditable selection does not survive that.
 */
function focusEditable(hit: ContextMenuHit): void {
  hit.editable?.focus({ preventScroll: true });
  restoreContextMenuSelection(hit);
}

/**
 * Fire a cancelable `beforeinput` the editor already listens for (Lexical maps
 * `historyUndo` / `historyRedo` / `deleteContentBackward` onto its commands).
 * @returns true when a listener called `preventDefault` (gesture handled).
 */
function dispatchEditorBeforeInput(el: HTMLElement, inputType: string): boolean {
  return !el.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType,
    }),
  );
}

/**
 * Build a cancelable clipboard event with a live `DataTransfer`.
 *
 * Always a plain `Event` plus an own `clipboardData` property: jsdom's
 * `ClipboardEvent` init ignores / stubs `clipboardData`, and Lexical only
 * needs the event type + a transferable bag for `setData` / `getData`.
 */
function createClipboardEvent(
  type: "cut" | "copy" | "paste",
  data: DataTransfer,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: data,
  });
  return event;
}

/**
 * Fire a cancelable clipboard event with a live `DataTransfer` so an editor
 * can `setData` the way a real Ctrl+X / Ctrl+C would.
 * @returns the event (callers read `defaultPrevented` and any `setData` payload).
 */
function dispatchEditorClipboard(
  el: HTMLElement,
  type: "cut" | "copy",
): Event {
  const data = typeof DataTransfer === "function" ? new DataTransfer() : null;
  /* v8 ignore next 4 -- ancient jsdom without DataTransfer; Electron always has it. */
  if (data === null) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
  }
  const event = createClipboardEvent(type, data);
  el.dispatchEvent(event);
  return event;
}

/** True when the live selection (after restore) covers any text. */
function hasLiveSelection(hit: ContextMenuHit): boolean {
  const el = hit.editable;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.selectionStart !== el.selectionEnd;
  }
  const live = window.getSelection();
  if (live === null || live.rangeCount === 0) return false;
  return !live.isCollapsed && live.toString() !== "";
}

/**
 * Delete the restored selection.
 *
 * Contenteditable: prefer `beforeinput` (`deleteContentBackward`) so Lexical
 * records a history step; fall back to `execCommand`. Native controls use
 * `setRangeText` when the command is unavailable (jsdom).
 */
function deleteSelection(hit: ContextMenuHit): void {
  const el = hit.editable;
  if (el !== null && !isNativeTextControl(el)) {
    if (dispatchEditorBeforeInput(el, "deleteContentBackward")) return;
  }
  if (document.execCommand("delete")) return;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  const bookmark = hit.selection;
  if (bookmark?.kind !== "control" || bookmark.start === bookmark.end) return;
  el.setRangeText("", bookmark.start, bookmark.end, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
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
  /* v8 ignore next -- jsdom without DataTransfer cannot carry a paste payload. */
  if (typeof DataTransfer !== "function") return;
  const data = new DataTransfer();
  if (content.text !== "") data.setData("text/plain", content.text);
  for (const file of content.files) data.items.add(file);
  el.dispatchEvent(createClipboardEvent("paste", data));
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

/** Write text when a synthetic clipboard event cannot reach the OS clipboard. */
function writeClipboardText(text: string): void {
  if (text === "") return;
  void navigator.clipboard?.writeText(text).catch(() => {
    // Clipboard blocked: the row already ran; nothing more to offer.
  });
}

/**
 * Flush whatever an editor wrote onto a synthetic clipboard event out to the
 * system clipboard (synthetic clipboard events do not update it on their own).
 */
function flushClipboardData(event: Event, fallbackText: string): void {
  const data = (event as { clipboardData?: DataTransfer | null }).clipboardData;
  const text = data?.getData("text/plain") ?? "";
  writeClipboardText(text !== "" ? text : fallbackText);
}

/** DOM-backed actions; every row mirrors the keyboard shortcut of the same name. */
export const domContextMenuActions: ContextMenuActions = {
  copy(hit) {
    focusEditable(hit);
    const el = hit.editable;
    if (el !== null && !isNativeTextControl(el)) {
      // Real Ctrl+C path: Lexical's COPY_COMMAND fills clipboardData.
      const event = dispatchEditorClipboard(el, "copy");
      if (event.defaultPrevented) {
        flushClipboardData(event, hit.selectionText);
        return;
      }
    }
    if (document.execCommand("copy")) return;
    writeClipboardText(hit.selectionText);
  },
  cut(hit) {
    focusEditable(hit);
    const el = hit.editable;
    if (el !== null && !isNativeTextControl(el)) {
      const event = dispatchEditorClipboard(el, "cut");
      if (event.defaultPrevented) {
        flushClipboardData(event, hit.selectionText);
        return;
      }
    }
    if (document.execCommand("cut")) return;
    // Mirror a native cut when neither path ran: copy then delete.
    if (hit.selectionText !== "") writeClipboardText(hit.selectionText);
    if (hasLiveSelection(hit) || hit.selection !== null) deleteSelection(hit);
  },
  remove(hit) {
    focusEditable(hit);
    deleteSelection(hit);
  },
  selectAll(hit) {
    const el = hit.editable;
    if (el === null) return;
    el.focus({ preventScroll: true });
    // Prefer scoping to the editable: `execCommand('selectAll')` selects the
    // whole document in some engines and misses input/textarea entirely.
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.select();
      return;
    }
    const live = window.getSelection();
    if (live === null) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    live.removeAllRanges();
    live.addRange(range);
  },
  undo(hit) {
    focusEditable(hit);
    const el = hit.editable;
    // Lexical (and peers) map historyUndo → UNDO_COMMAND; the document
    // execCommand stack is a different history and must not win here.
    if (el !== null && !isNativeTextControl(el)) {
      if (dispatchEditorBeforeInput(el, "historyUndo")) return;
    }
    document.execCommand("undo");
  },
  redo(hit) {
    focusEditable(hit);
    const el = hit.editable;
    if (el !== null && !isNativeTextControl(el)) {
      if (dispatchEditorBeforeInput(el, "historyRedo")) return;
    }
    document.execCommand("redo");
  },
  copyText(text) {
    writeClipboardText(text);
  },
  paste(hit, plainText) {
    void pasteAt(hit, plainText);
  },
};
