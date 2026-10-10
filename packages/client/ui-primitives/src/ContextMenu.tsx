/**
 * Right-click host: one document listener, one portaled `Menu`.
 *
 * Drawn from the product's own menu primitive so a right-click looks like the
 * rest of the product instead of a foreign OS card, and so keyboard users get
 * the same rows a native menu would have offered (arrows, Home/End, Escape,
 * outside click, focus returned to the caret).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Menu } from "./Menu.tsx";
import type { MenuEntry } from "./Menu.tsx";
import { domContextMenuActions } from "./contextMenuGestures.ts";
import {
  buildContextMenuEntries,
  probeContextMenuClipboard,
  readContextMenuHit,
} from "./context-menu.ts";
import type {
  ContextMenuActions,
  ContextMenuEntry,
  ContextMenuHit,
  ContextMenuLabels,
} from "./context-menu.ts";

/**
 * English row copy, used when the product locale is not wired yet (or a
 * namespace has not registered these keys). Resolution happens per
 * right-click, never per render, so a language switch is picked up the next
 * time the user asks for a menu.
 */
const FALLBACK_LABELS: ContextMenuLabels = {
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  pastePlainText: "Paste as Plain Text",
  delete: "Delete",
  selectAll: "Select All",
  copyLink: "Copy Link Address",
};

/** Locale keys per row (the common namespace). */
const LABEL_KEYS = {
  undo: "undo",
  redo: "redo",
  cut: "cut",
  copy: "copy",
  paste: "paste",
  pastePlainText: "pastePlainText",
  delete: "delete",
  selectAll: "selectAll",
  copyLink: "copyLink",
} as const satisfies Record<keyof ContextMenuLabels, string>;

/** Host props: the product's translate seat plus optional gestures. */
export interface ContextMenuHostProps {
  /** `t` from the product locale; absent or missing keys fall back to English. */
  readonly t?: ((key: string) => string) | undefined;
  /** Defaults to the DOM gestures; tests and hosts override. */
  readonly actions?: ContextMenuActions;
}

/** Resolve row copy for one right-click. */
function resolveLabels(t: ContextMenuHostProps["t"]): ContextMenuLabels {
  if (t === undefined) return FALLBACK_LABELS;
  const resolved = { ...FALLBACK_LABELS };
  for (const [row, key] of Object.entries(LABEL_KEYS) as [
    keyof ContextMenuLabels,
    string,
  ][]) {
    const value = t(key);
    if (typeof value === "string" && value !== "" && value !== key)
      resolved[row] = value;
  }
  return resolved;
}

/** An open menu: where it was asked for, and what it offers. */
interface OpenRequest {
  readonly hit: ContextMenuHit;
  readonly entries: readonly ContextMenuEntry[];
}

/** Map the model onto the shared Menu primitive's entry shape. */
function toMenuEntries(entries: readonly ContextMenuEntry[]): MenuEntry[] {
  return entries.map((entry) =>
    entry.kind === "separator"
      ? { type: "separator", id: entry.id }
      : { id: entry.id, label: entry.label, disabled: entry.disabled },
  );
}

/** Selectable rows, in order — separators and headings carry other roles. */
function menuRows(list: HTMLDivElement | null): HTMLButtonElement[] {
  return Array.from(
    list?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
  ).filter((row) => !row.disabled);
}

/**
 * Render the product-wide right-click menu.
 * @param props - row copy and (optionally) the gestures behind each row.
 * @returns the portaled menu while open, nothing otherwise.
 */
export function ContextMenuHost({
  t,
  actions = domContextMenuActions,
}: ContextMenuHostProps): ReactNode {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Who owned the caret before the menu opened; gets it back on close. */
  const restoreRef = useRef<HTMLElement | null>(null);
  /** Monotonic ticket so a slow clipboard probe cannot open a stale menu. */
  const probeRef = useRef(0);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      // Something that already answered this gesture keeps it (JsonTree's copy
      // button, a nested menu, a plugin).
      if (event.defaultPrevented) return;
      const target =
        event.target instanceof Element ? event.target : null;
      // Native text fields + modal dialogs keep the browser menu. A portaled
      // Menu steals focus (and can scroll the page behind a dialog), which
      // made the shell look "squeezed" and broke Ctrl+A / Select All on
      // textarea edit surfaces such as the pasted-text modal.
      if (
        target !== null
        && target.closest(
          'textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]), [role="dialog"][aria-modal="true"]',
        )
      ) {
        return;
      }
      const hit = readContextMenuHit(event);
      // Nothing to offer: leave the event alone so blank panels stay quiet.
      if (!hit.isEditable && hit.selectionText === "" && hit.linkUrl === "") return;
      event.preventDefault();
      restoreRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const ticket = ++probeRef.current;
      void probeContextMenuClipboard().then((clipboard) => {
        // A newer right-click (or a close) overtook this probe.
        if (ticket !== probeRef.current) return;
        setRequest({
          hit,
          entries: buildContextMenuEntries({
            hit,
            labels: resolveLabels(t),
            clipboard,
            actions,
          }),
        });
      });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [actions, t]);

  const close = useCallback((): void => {
    probeRef.current++;
    setRequest(null);
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore !== null && restore.isConnected) restore.focus();
  }, []);

  // Arrow keys walk the rows the way a native menu does; Menu itself only
  // owns Escape and outside-click dismissal.
  useEffect(() => {
    if (request === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const { key } = event;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End")
        return;
      const rows = menuRows(listRef.current);
      if (rows.length === 0) return;
      event.preventDefault();
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? rows.length - 1
            : key === "ArrowDown"
              ? (current + 1) % rows.length
              : (current - 1 + rows.length) % rows.length;
      rows[next]?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [request]);

  // The portaled list paints hidden until Menu places it, so focus follows the
  // placement frame rather than the commit.
  useLayoutEffect(() => {
    if (request === null) return;
    const frame = requestAnimationFrame(() => {
      // preventScroll: focusing a menuitem must not scroll the page under a
      // dialog / composer (that reflow reads as the shell "squeezing").
      menuRows(listRef.current)[0]?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [request]);

  const getAnchorRect = useCallback((): DOMRect | null => {
    return request === null ? null : new DOMRect(request.hit.x, request.hit.y, 0, 0);
  }, [request]);

  const onSelect = (id: string): void => {
    const entry = request?.entries.find(
      (candidate) => candidate.kind === "row" && candidate.id === id,
    );
    // Close (and hand the caret back) BEFORE the gesture runs: pasting types
    // at the caret, which the menu would otherwise still be holding.
    close();
    if (entry?.kind === "row") entry.run();
  };

  return request === null ? null : (
    <Menu
      open
      anchor={null}
      items={toMenuEntries(request.entries)}
      portal
      listRef={listRef}
      getAnchorRect={getAnchorRect}
      onSelect={onSelect}
      onClose={close}
    />
  );
}
