import type { ShellController } from "../../shell-controller.js";
import { formatBootReport } from "../../boot-composition.js";
import { el } from "../../dom.js";

export type StatusLineId = "boot" | "connection" | "queue" | "workspace";

/** Contribution: chrome.status list entries */
export function mountStatusLine(
  host: HTMLElement,
  ctl: ShellController,
  id: StatusLineId,
): () => void {
  host.className = `shell-status-line shell-status-${id}`;
  const line = el("span", "");
  host.replaceChildren(line);

  const render = (): void => {
    switch (id) {
      case "boot": {
        const snap = ctl.gate.getSnapshot();
        line.textContent = `boot ${snap.phase}`;
        line.title = formatBootReport(ctl.gate);
        break;
      }
      case "connection": {
        const sid = ctl.view.activeSessionId || "(none)";
        line.textContent = `mux ${ctl.muxState} · ${sid}`;
        line.title = ctl.client.httpBase;
        break;
      }
      case "queue": {
        const n = ctl.view.queueItems.length;
        line.textContent = n === 0 ? "queue empty" : `queue ${n}`;
        break;
      }
      case "workspace": {
        const w = ctl.workspace;
        if (w.productExists === false) {
          line.textContent = ".xrk missing";
        } else if (w.inject) {
          line.textContent = `.xrk ${w.inject.blockCount}blk`;
        } else {
          line.textContent = ".xrk …";
        }
        line.title = w.productDir ?? "";
        break;
      }
    }
  };

  const unsub = ctl.subscribe(render);
  const unsubView = ctl.view.subscribe(render);
  const unsubGate = ctl.gate.subscribe(render);
  render();

  return () => {
    unsub();
    unsubView();
    unsubGate();
  };
}
