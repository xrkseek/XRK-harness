import type { ShellController } from "../../shell-controller.js";
import { el } from "../../dom.js";

/** Contribution: chrome.sidebar list id=sessions */
export function mountSidebar(
  host: HTMLElement,
  ctl: ShellController,
): () => void {
  host.className = "shell-panel shell-sidebar";
  const brand = el("h1", "XRK");
  brand.className = "shell-brand";
  const sub = el("p", "Harness");
  sub.className = "shell-brand-sub";

  const baseInput = document.createElement("input");
  baseInput.type = "text";
  baseInput.value = ctl.baseUrl;
  baseInput.placeholder = "Host base URL";
  baseInput.className = "shell-input";

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.value = ctl.apiKey;
  keyInput.placeholder = "XRK_API_KEY";
  keyInput.className = "shell-input";

  const applyConn = (): void => {
    ctl.setConnection(baseInput.value, keyInput.value);
  };
  baseInput.addEventListener("change", applyConn);
  keyInput.addEventListener("change", applyConn);

  const btnRow = el("div", "");
  btnRow.className = "shell-btn-row";
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.textContent = "New session";
  newBtn.addEventListener("click", () => {
    applyConn();
    void ctl.createSession();
  });
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => {
    applyConn();
    void ctl.refreshList();
  });
  btnRow.append(newBtn, refreshBtn);

  const list = el("ul", "");
  list.className = "shell-session-list";

  host.replaceChildren(
    brand,
    sub,
    baseInput,
    keyInput,
    btnRow,
    el("h2", "Sessions"),
    list,
  );

  const render = (): void => {
    list.replaceChildren();
    for (const item of ctl.sessionItems) {
      const li = document.createElement("li");
      const active = item.sessionId === ctl.view.activeSessionId;
      li.className = active ? "active" : "";
      const title = ctl.displayTitle(item);
      const meta = [
        item.running ? "run" : null,
        item.blank ? "blank" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      li.textContent = meta ? `${title} · ${meta}` : title;
      li.title = item.sessionId;
      li.addEventListener("click", () => {
        applyConn();
        void ctl.selectSession(item.sessionId);
      });
      list.append(li);
    }
    if (ctl.sessionItems.length === 0) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "(no sessions — New or Refresh)";
      list.append(empty);
    }
  };

  const unsub = ctl.subscribe(render);
  const unsubView = ctl.view.subscribe(render);
  render();
  void ctl.refreshList();

  return () => {
    unsub();
    unsubView();
  };
}
