/**
 * @vitest-environment jsdom
 *
 * Right-click host integration: the composer / prose / link surfaces a
 * right-click lands on, and the keyboard walk a native menu used to give for
 * free. Rows are driven through injected `actions` doubles, so nothing here
 * depends on what the engine's `execCommand` happens to do under jsdom — only
 * on which rows the host offers, what it enables, and that clicking one runs
 * its gesture.
 *
 * Row copy goes through the product locale seat (`t`), not a labels object:
 * a missing key, an empty string, or a value that merely echoes the key all
 * count as a miss and land on the built-in English copy. Both halves of that
 * rule are pinned below, because it is the one thing a translator cannot see
 * break.
 *
 * Two jsdom facts shape these specs: the clipboard probe resolves through a
 * promise (so opening is always awaited), and there is no `navigator.clipboard`
 * unless a spec puts one there (so paste greys out unless a spec opts in).
 */
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "../src/ContextMenu.tsx";
import type { ContextMenuActions } from "../src/context-menu.ts";

/** Locale table keyed exactly like the host's `LABEL_KEYS`. */
const EN: Record<string, string> = {
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

/** Stable identity: the host keys its document listener on `t`. */
const T = (key: string): string => EN[key] ?? "";

/** A composer surface the host must treat as editable. */
function composer(testId = "composer"): ReactNode {
  return (
    <div contentEditable suppressContentEditableWarning data-testid={testId}>
      hello
    </div>
  );
}

/** Gesture doubles: a row must run *something*, not the browser's idea of it. */
function fakeActions(): ContextMenuActions {
  return {
    copy: vi.fn(),
    cut: vi.fn(),
    remove: vi.fn(),
    selectAll: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copyText: vi.fn(),
    paste: vi.fn(),
  };
}

/** jsdom keeps one document selection; a stale range would read as prose text. */
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** Right-click a surface and wait out the clipboard probe round-trip. */
async function rightClick(target: Element): Promise<void> {
  fireEvent.contextMenu(target, { clientX: 40, clientY: 60 });
  await waitFor(() => {
    expect(screen.queryByRole("menu")).not.toBeNull();
  });
}

/** Select an element's whole text the way a drag would. */
function selectContents(el: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null) throw new Error("jsdom has no Selection");
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  expect(selection.toString()).not.toBe("");
}

/** The host plus a right-click target, in one tree. */
function renderHost(
  target: ReactNode,
  actions: ContextMenuActions = fakeActions(),
): void {
  render(
    <>
      <ContextMenuHost t={T} actions={actions} />
      {target}
    </>,
  );
}

describe("ContextMenuHost", () => {
  it("opens the editing rows on a contenteditable right-click", async () => {
    renderHost(composer());
    await rightClick(screen.getByTestId("composer"));
    for (const name of [
      "Undo",
      "Redo",
      "Cut",
      "Copy",
      "Paste",
      "Delete",
      "Select All",
    ]) {
      expect(screen.getByRole("menuitem", { name })).toBeDefined();
    }
  });

  it("stays quiet on a blank right-click (no selection, no link, not editable)", async () => {
    renderHost(<div data-testid="panel">panel</div>);
    fireEvent.contextMenu(screen.getByTestId("panel"), { clientX: 5, clientY: 5 });
    // The probe round-trips through a promise even when it rejects the click,
    // so flush microtasks before calling "nothing appeared" a fact.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers copy alone over selected prose", async () => {
    renderHost(<p data-testid="prose">some selected words</p>);
    const prose = screen.getByTestId("prose");
    selectContents(prose);
    await rightClick(prose);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    const copy = screen.getByRole("menuitem", { name: "Copy" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(false);
    expect(screen.queryByRole("menuitem", { name: "Paste" })).toBeNull();
  });

  it("runs the row gesture and closes when a row is clicked", async () => {
    const copy = vi.fn();
    renderHost(composer(), { ...fakeActions(), copy });
    const el = screen.getByTestId("composer");
    selectContents(el);
    await rightClick(el);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(copy).toHaveBeenCalledTimes(1);
    // The menu unmounts before the gesture runs, so a paste can never land
    // behind a menu that is still holding the caret.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes and hands the caret back to the pre-menu element", async () => {
    render(
      <>
        <ContextMenuHost t={T} actions={fakeActions()} />
        <div
          contentEditable
          suppressContentEditableWarning
          tabIndex={-1}
          data-testid="composer"
        >
          hello
        </div>
      </>,
    );
    const el = screen.getByTestId("composer");
    el.focus();
    await rightClick(el);
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(el);
  });

  it("ArrowDown / End walk the enabled rows the way a native menu does", async () => {
    renderHost(composer());
    const el = screen.getByTestId("composer");
    selectContents(el);
    await rightClick(el);
    // Contenteditable keeps undo/redo enabled (Lexical history); paste stays
    // grey without a clipboard stub. Focus lands on the first enabled row.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Undo");
    });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Redo");
    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Select All");
  });

  it("a clipboard holding text enables both paste rows, plain text included", async () => {
    const paste = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        read: async () => [{ types: ["text/plain"] }],
        readText: async () => "pasted",
      },
      configurable: true,
    });
    renderHost(composer(), { ...fakeActions(), paste });
    await rightClick(screen.getByTestId("composer"));
    const pasteRow = screen.getByRole("menuitem", {
      name: "Paste",
    }) as HTMLButtonElement;
    expect(pasteRow.disabled).toBe(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste as Plain Text" }));
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste.mock.calls[0]?.[1]).toBe(true);
  });

  it("a right-click already answered upstream keeps its own handler", async () => {
    const copy = vi.fn();
    render(
      <>
        <ContextMenuHost t={T} actions={{ ...fakeActions(), copy }} />
        <div
          data-testid="tree"
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          row
        </div>
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("tree"), { clientX: 5, clientY: 5 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(copy).not.toHaveBeenCalled();
  });
});

describe("ContextMenuHost row copy", () => {
  it("falls back to built-in English when no locale seat is wired", async () => {
    render(
      <>
        <ContextMenuHost actions={fakeActions()} />
        {composer()}
      </>,
    );
    await rightClick(screen.getByTestId("composer"));
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Select All" })).toBeDefined();
  });

  it("treats an echoing or empty t answer as a miss and keeps English", async () => {
    // A half-wired namespace is the common case: some keys answer, some echo
    // their own key. Neither may blank a row.
    render(
      <>
        <ContextMenuHost t={(key) => key} actions={fakeActions()} />
        {composer()}
      </>,
    );
    await rightClick(screen.getByTestId("composer"));
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeDefined();

    cleanup();
    window.getSelection()?.removeAllRanges();
    render(
      <>
        <ContextMenuHost t={() => ""} actions={fakeActions()} />
        {composer()}
      </>,
    );
    await rightClick(screen.getByTestId("composer"));
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeDefined();
  });

  it("uses locale copy whenever t resolves the key", async () => {
    const ZH: Record<string, string> = {
      undo: "撤销",
      redo: "重做",
      cut: "剪切",
      copy: "复制",
      paste: "粘贴",
      pastePlainText: "粘贴为纯文本",
      delete: "删除",
      selectAll: "全选",
      copyLink: "复制链接地址",
    };
    render(
      <>
        <ContextMenuHost t={(key) => ZH[key] ?? key} actions={fakeActions()} />
        {composer()}
      </>,
    );
    await rightClick(screen.getByTestId("composer"));
    for (const name of ["撤销", "重做", "剪切", "复制", "粘贴", "删除", "全选"]) {
      expect(screen.getByRole("menuitem", { name })).toBeDefined();
    }
  });

  it("leaves native textarea / modal dialogs to the browser menu", async () => {
    renderHost(
      <div role="dialog" aria-modal="true">
        <textarea data-testid="paste-editor" defaultValue="body" />
      </div>,
    );
    fireEvent.contextMenu(screen.getByTestId("paste-editor"), {
      clientX: 20,
      clientY: 20,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
