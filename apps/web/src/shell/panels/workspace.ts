import type { ShellController } from "../../shell-controller.js";
import { el } from "../../dom.js";

/** Contribution: chrome.sidebar list id=workspace */
export function mountWorkspacePanel(
  host: HTMLElement,
  ctl: ShellController,
): () => void {
  host.className = "shell-panel shell-workspace";

  const title = el("h2", "Workspace");
  const meta = el("p", "");
  meta.className = "shell-ws-meta";
  const entryList = el("ul", "");
  entryList.className = "shell-ws-entries";
  const injectLine = el("p", "");
  injectLine.className = "shell-ws-meta";

  const btnRow = el("div", "");
  btnRow.className = "shell-btn-row";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.textContent = "Refresh .xrk";
  refreshBtn.addEventListener("click", () => {
    void ctl.refreshWorkspace();
  });
  const syncBtn = document.createElement("button");
  syncBtn.type = "button";
  syncBtn.textContent = "Sync office-agent";
  syncBtn.addEventListener("click", () => {
    void ctl.syncWorkspaceSeeds("office-agent");
  });
  btnRow.append(refreshBtn, syncBtn);

  host.replaceChildren(title, meta, btnRow, injectLine, entryList);

  const render = (): void => {
    const w = ctl.workspace;
    const rootShort = w.root
      ? w.root.replace(/\\/g, "/").split("/").slice(-2).join("/")
      : "(unknown)";
    meta.textContent = [
      `root …/${rootShort}`,
      w.productExists === false
        ? ".xrk missing"
        : w.productExists
          ? ".xrk ok"
          : "",
      w.seedTemplates.length
        ? `seeds: ${w.seedTemplates.join(",")}`
        : "seeds: (none)",
    ]
      .filter(Boolean)
      .join(" · ");

    if (w.inject) {
      injectLine.textContent = `inject ${w.inject.blockCount} blocks · ${w.inject.totalChars} chars${
        w.inject.blocks.length
          ? ` · ${w.inject.blocks.map((b) => b.heading).join(", ")}`
          : ""
      }`;
    } else {
      injectLine.textContent = "inject: (refresh)";
    }

    entryList.replaceChildren();
    if (w.entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = w.productExists === false
        ? "(no .xrk — Sync office-agent)"
        : "(empty)";
      entryList.append(empty);
    } else {
      for (const e of w.entries.slice(0, 40)) {
        const li = document.createElement("li");
        li.textContent =
          e.kind === "dir"
            ? `${e.path}/`
            : `${e.path}${e.bytes !== undefined ? ` · ${e.bytes}B` : ""}`;
        entryList.append(li);
      }
      if (w.truncated || w.entries.length > 40) {
        const more = document.createElement("li");
        more.className = "muted";
        more.textContent = "…truncated";
        entryList.append(more);
      }
    }
  };

  const unsub = ctl.subscribe(render);
  render();
  void ctl.refreshWorkspace();

  return () => {
    unsub();
  };
}
