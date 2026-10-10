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

/** What a right-click landed on, resolved from the event and the DOM. */
export interface ContextMenuHit {
  /** The exact element under the pointer. */
  readonly target: HTMLElement;
  /** Nearest editable ancestor (input / textarea / contenteditable), if any. */
  readonly editable: HTMLElement | null;
  readonly isEditable: boolean;
  /** Document selection text (empty for input / textarea selection). */
  readonly selectionText: string;
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
 * Resolve the right-click target.
 * @param event - the `contextmenu` event (coordinates + selection state).
 * @returns the hit descriptor the menu builder branches on.
 */
export function readContextMenuHit(event: MouseEvent): ContextMenuHit {
  const target =
    event.target instanceof HTMLElement ? event.target : (document.body as HTMLElement);
  const editable = editableAncestor(event.target);
  return {
    target,
    editable,
    isEditable: editable !== null,
    selectionText: window.getSelection()?.toString() ?? "",
    linkUrl: linkUnderPointer(event.target),
    x: event.clientX,
    y: event.clientY,
  };
}

/** Selection inside an input / textarea is not a document selection. */
export function hasContextMenuSelection(hit: ContextMenuHit): boolean {
  const el = hit.editable;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.selectionStart !== el.selectionEnd;
  }
  return hit.selectionText !== "";
}

/**
 * Whether the document can undo / redo.
 *
 * The composer runs WITHOUT @lexical/history, so its undo stack IS the
 * browser's — Ctrl+Z and this agree. Where the browser reports neither, the
 * row greys out rather than pretending.
 */
export function contextMenuCommandEnabled(command: "undo" | "redo"): boolean {
  try {
    return document.queryCommandEnabled(command);
  } catch {
    return false;
  }
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
      row("undo", labels.undo, !contextMenuCommandEnabled("undo"), () => {
        actions.undo(hit);
      }),
      row("redo", labels.redo, !contextMenuCommandEnabled("redo"), () => {
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
