/**
 * Right-click model: which rows a right-click offers, and the gestures behind
 * them.
 *
 * Owned by ui-primitives because a right-click lands anywhere — the composer,
 * a reply body, a link — and because it has to draw from the same `Menu`
 * primitive every dropdown uses. (Electron ships no context menu at all; the
 * shell used to build a native one, which also meant a light Win32 card
 * floating over a dark product UI.)
 */

/** Locale-resolved row copy, resolved per right-click (not per render). */
export interface ContextMenuLabels {
  readonly undo: string;
  readonly redo: string;
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly pastePlainText: string;
  readonly delete: string;
  readonly selectAll: string;
  readonly copyLink: string;
}

/**
 * Caret / selection as it was at right-click time.
 *
 * The host focuses a menuitem for keyboard walk, which clears a live
 * contenteditable selection; gestures restore this bookmark before
 * `execCommand` so Cut / Copy / Delete still see what the user highlighted.
 */
export type ContextMenuSelectionBookmark =
  | {
      readonly kind: "control";
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: "dom";
      readonly ranges: readonly Range[];
    };

/** What a right-click landed on, resolved from the event and the DOM. */
export interface ContextMenuHit {
  /** The exact element under the pointer. */
  readonly target: HTMLElement;
  /** Nearest editable ancestor (input / textarea / contenteditable), if any. */
  readonly editable: HTMLElement | null;
  readonly isEditable: boolean;
  /** Document selection text (empty for input / textarea selection). */
  readonly selectionText: string;
  /**
   * Selection captured before the menu steals focus. Null when the click
   * landed with no caret (e.g. a blank panel that still offers Copy Link).
   */
  readonly selection: ContextMenuSelectionBookmark | null;
  /** `href` of the nearest anchor under the pointer. */
  readonly linkUrl: string;
  readonly x: number;
  readonly y: number;
}

/** One row of the menu. */
export type ContextMenuEntry =
  | {
      readonly kind: "row";
      readonly id: string;
      readonly label: string;
      readonly disabled: boolean;
      readonly run: () => void;
    }
  | { readonly kind: "separator"; readonly id: string };

/** The editing gestures a row performs. Injected so the model stays testable. */
export interface ContextMenuActions {
  copy(hit: ContextMenuHit): void;
  cut(hit: ContextMenuHit): void;
  remove(hit: ContextMenuHit): void;
  selectAll(hit: ContextMenuHit): void;
  undo(hit: ContextMenuHit): void;
  redo(hit: ContextMenuHit): void;
  copyText(text: string): void;
  paste(hit: ContextMenuHit, plainText: boolean): void;
}

/** Clipboard shape as far as the menu cares: enough to grey out paste rows. */
export interface ClipboardProbe {
  readonly hasText: boolean;
  readonly hasFiles: boolean;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether one element takes text input.
 * `isContentEditable` is missing in jsdom, so the attribute answers it too.
 */
function isEditableElement(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.disabled && !el.readOnly && !NON_TEXT_INPUT_TYPES.has(el.type);
  }
  return (
    (el instanceof HTMLElement && el.isContentEditable === true) ||
    el.getAttribute("contenteditable") === "true"
  );
}

/** Walk up from the pointer to the first element that takes text. */
function editableAncestor(node: EventTarget | null): HTMLElement | null {
  let el =
    node instanceof HTMLElement
      ? node
      : node instanceof Element
        ? node.parentElement
        : null;
  while (el !== null) {
    if (isEditableElement(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Anchor href under the pointer, if the click landed on (inside) a link. */
function linkUnderPointer(node: EventTarget | null): string {
  if (!(node instanceof Element)) return "";
  const anchor = node.closest("a[href]");
  const href = anchor?.getAttribute("href") ?? "";
  if (href === "" || href.startsWith("#")) return "";
  // The DOM property resolves relative hrefs; the attribute is the fallback.
  return anchor instanceof HTMLAnchorElement ? anchor.href : href;
}

/**
 * Snapshot the live selection so a later gesture can put it back after the
 * menu has taken focus.
 * @param editable - nearest text surface, or null for a prose selection.
 */
function snapshotContextMenuSelection(
  editable: HTMLElement | null,
): ContextMenuSelectionBookmark | null {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    return {
      kind: "control",
      start: editable.selectionStart ?? 0,
      end: editable.selectionEnd ?? 0,
    };
  }
  const live = window.getSelection();
  if (live === null || live.rangeCount === 0) return null;
  const ranges: Range[] = [];
  for (let i = 0; i < live.rangeCount; i++) {
    const range = live.getRangeAt(i);
    if (editable === null || editable.contains(range.commonAncestorContainer)) {
      ranges.push(range.cloneRange());
    }
  }
  return ranges.length > 0 ? { kind: "dom", ranges } : null;
}

/**
 * Put the right-click selection back (call after focusing the editable).
 * @param hit - the open-menu hit that owns the bookmark.
 */
export function restoreContextMenuSelection(hit: ContextMenuHit): void {
  const bookmark = hit.selection;
  if (bookmark === null) return;
  if (bookmark.kind === "control") {
    const el = hit.editable;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    try {
      el.setSelectionRange(bookmark.start, bookmark.end);
    } catch {
      // Detached / non-text input type: the gesture becomes a no-op.
    }
    return;
  }
  const live = window.getSelection();
  if (live === null) return;
  live.removeAllRanges();
  for (const range of bookmark.ranges) {
    try {
      live.addRange(range);
    } catch {
      // Node was replaced between right-click and the row click.
    }
  }
}

/**
 * Resolve the right-click target.
 * @param event - the `contextmenu` event (coordinates + selection state).
 * @returns the hit descriptor the menu builder branches on.
 */
export function readContextMenuHit(event: MouseEvent): ContextMenuHit {
  const target =
    event.target instanceof HTMLElement ? event.target : (document.body as HTMLElement);
  const editable = editableAncestor(event.target);
  const selection = snapshotContextMenuSelection(editable);
  let selectionText = "";
  if (
    editable instanceof HTMLInputElement
    || editable instanceof HTMLTextAreaElement
  ) {
    const start = editable.selectionStart ?? 0;
    const end = editable.selectionEnd ?? 0;
    selectionText = editable.value.slice(start, end);
  } else {
    selectionText = window.getSelection()?.toString() ?? "";
  }
  return {
    target,
    editable,
    isEditable: editable !== null,
    selectionText,
    selection,
    linkUrl: linkUnderPointer(event.target),
    x: event.clientX,
    y: event.clientY,
  };
}

/** Whether the right-click captured a non-collapsed selection. */
export function hasContextMenuSelection(hit: ContextMenuHit): boolean {
  const bookmark = hit.selection;
  if (bookmark?.kind === "control") return bookmark.start !== bookmark.end;
  if (bookmark?.kind === "dom") {
    return bookmark.ranges.some((range) => !range.collapsed);
  }
  // Hits built in tests without a bookmark still answer from the live fields.
  const el = hit.editable;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.selectionStart !== el.selectionEnd;
  }
  return hit.selectionText !== "";
}

/**
 * Whether a native text control can undo / redo via the document command stack.
 *
 * Contenteditable hosts (the Lexical composer with `@lexical/history`) own a
 * separate undo stack reached through `beforeinput` `historyUndo` /
 * `historyRedo`. `queryCommandEnabled` answers the browser stack and would
 * grey those rows incorrectly — callers must not use this for contenteditable.
 */
export function contextMenuCommandEnabled(command: "undo" | "redo"): boolean {
  try {
    return document.queryCommandEnabled(command);
  } catch {
    return false;
  }
}

/**
 * Whether undo / redo rows should stay enabled for this hit.
 *
 * Native controls defer to `queryCommandEnabled`. Contenteditable surfaces
 * keep the rows live: their history is not the document stack, and an empty
 * Lexical stack no-ops the gesture the same way Ctrl+Z would.
 */
export function contextMenuHistoryEnabled(
  hit: ContextMenuHit,
  command: "undo" | "redo",
): boolean {
  const el = hit.editable;
  if (el !== null && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return true;
  }
  return contextMenuCommandEnabled(command);
}

/**
 * Build the menu for one right-click.
 *
 * An empty list is meaningful: the host then leaves the event alone, so blank
 * panels stay quiet instead of popping an empty card.
 */
export function buildContextMenuEntries(options: {
  readonly hit: ContextMenuHit;
  readonly labels: ContextMenuLabels;
  readonly clipboard: ClipboardProbe;
  readonly actions: ContextMenuActions;
}): readonly ContextMenuEntry[] {
  const { hit, labels, clipboard, actions } = options;
  const entries: ContextMenuEntry[] = [];
  const row = (
    id: string,
    label: string,
    disabled: boolean,
    run: () => void,
  ): ContextMenuEntry => ({ kind: "row", id, label, disabled, run });
  const separator = (id: string): ContextMenuEntry => ({ kind: "separator", id });

  if (hit.isEditable) {
    const selected = hasContextMenuSelection(hit);
    const canPaste = clipboard.hasText || clipboard.hasFiles;
    entries.push(
      row("undo", labels.undo, !contextMenuHistoryEnabled(hit, "undo"), () => {
        actions.undo(hit);
      }),
      row("redo", labels.redo, !contextMenuHistoryEnabled(hit, "redo"), () => {
        actions.redo(hit);
      }),
      separator("edit-separator"),
      row("cut", labels.cut, !selected, () => {
        actions.cut(hit);
      }),
      row("copy", labels.copy, !selected, () => {
        actions.copy(hit);
      }),
      row("paste", labels.paste, !canPaste, () => {
        actions.paste(hit, false);
      }),
      row("delete", labels.delete, !selected, () => {
        actions.remove(hit);
      }),
      separator("clip-separator"),
      row("select-all", labels.selectAll, false, () => {
        actions.selectAll(hit);
      }),
    );
    // Plain-text paste has no discoverable shortcut once the browser menu is
    // gone, and pasted code should not drag formatting into the composer.
    if (canPaste) {
      entries.push(
        row("paste-plain", labels.pastePlainText, false, () => {
          actions.paste(hit, true);
        }),
      );
    }
  } else if (hit.selectionText !== "") {
    entries.push(
      row("copy", labels.copy, false, () => {
        actions.copy(hit);
      }),
    );
  }

  // A selection that already IS the raw URL makes "Copy Link Address" a
  // duplicate row; a link under prose does not.
  if (hit.linkUrl !== "" && hit.selectionText.trim() !== hit.linkUrl) {
    if (entries.length > 0) entries.push(separator("link-separator"));
    entries.push(
      row("copy-link", labels.copyLink, false, () => {
        actions.copyText(hit.linkUrl);
      }),
    );
  }

  return entries;
}

/**
 * Ask the clipboard what is on it, for row enablement.
 *
 * `read()` is one round trip and its `types` answer both halves; where the
 * engine refuses `read()` (no permission / older engine), text still probes.
 */
export async function probeContextMenuClipboard(): Promise<ClipboardProbe> {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) return { hasText: false, hasFiles: false };
  try {
    if (typeof clipboard.read === "function") {
      const items = await clipboard.read();
      return {
        hasText: items.some((item) => item.types.includes("text/plain")),
        hasFiles: items.some((item) =>
          item.types.some((type) => type !== "text/plain"),
        ),
      };
    }
    if (typeof clipboard.readText === "function") {
      return { hasText: (await clipboard.readText()) !== "", hasFiles: false };
    }
  } catch {
    // Permission refused / no user activation: paste stays greyed out, the
    // rest of the menu still works.
  }
  return { hasText: false, hasFiles: false };
}
