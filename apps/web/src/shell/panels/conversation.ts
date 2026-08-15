import type { ShellController } from "../../shell-controller.js";
import { el, labeled } from "../../dom.js";
import { renderTrajectoryNode } from "../../trajectory.js";

/** Contribution: chrome.main keyed conversation */
export function mountConversation(
  host: HTMLElement,
  ctl: ShellController,
): () => void {
  host.className = "shell-panel shell-conversation";

  const empty = el("p", "Select or create a session.");
  empty.className = "shell-empty";

  const header = el("div", "");
  header.className = "shell-conv-header";
  const sessionMeta = el("p", "");
  sessionMeta.className = "session-meta";
  const queueLine = el("p", "");
  queueLine.className = "session-meta";
  const approvalBox = el("div", "");
  approvalBox.className = "shell-approvals";
  header.append(sessionMeta, queueLine, approvalBox);

  const trajectory = el("div", "");
  trajectory.className = "trajectory";

  const promptInput = document.createElement("input");
  promptInput.type = "text";
  promptInput.value = "ping";
  promptInput.placeholder = "prompt text or /recipe";
  promptInput.className = "shell-input shell-input-wide";

  const renameInput = document.createElement("input");
  renameInput.type = "text";
  renameInput.placeholder = "rename title";
  renameInput.className = "shell-input";

  const presetSelect = document.createElement("select");
  for (const id of ["minimal", "harness", "server"]) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    presetSelect.append(opt);
  }
  presetSelect.value = ctl.agentPreset;
  presetSelect.addEventListener("change", () => {
    ctl.agentPreset = presetSelect.value;
  });

  const actions = el("div", "");
  actions.className = "shell-btn-row";
  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.textContent = "Prompt";
  sendBtn.addEventListener("click", () => {
    void ctl.prompt(promptInput.value);
  });
  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.textContent = "Rename";
  renameBtn.addEventListener("click", () => {
    void ctl.rename(renameInput.value);
  });
  const presetBtn = document.createElement("button");
  presetBtn.type = "button";
  presetBtn.textContent = "Select preset";
  presetBtn.addEventListener("click", () => {
    ctl.agentPreset = presetSelect.value;
    void ctl.selectPreset();
  });
  const forkBtn = document.createElement("button");
  forkBtn.type = "button";
  forkBtn.textContent = "Fork session";
  forkBtn.addEventListener("click", () => {
    void ctl.forkSession();
  });
  actions.append(sendBtn, renameBtn, presetBtn, forkBtn);

  const log = el("pre", "");
  log.className = "log";

  const body = el("div", "");
  body.className = "shell-conv-body";
  body.append(
    header,
    el("h2", "Trajectory"),
    trajectory,
    labeled("Preset", presetSelect),
    labeled("Prompt", promptInput),
    labeled("Rename", renameInput),
    actions,
    el("h2", "RPC log"),
    log,
  );

  const render = (): void => {
    const sid = ctl.view.activeSessionId;
    if (!sid) {
      host.replaceChildren(empty);
      return;
    }
    host.replaceChildren(body);
    presetSelect.value = ctl.agentPreset;
    const title = ctl.view.title();
    const meta = ctl.view.listMetadata();
    sessionMeta.textContent = [
      `session: ${sid}`,
      `preset: ${ctl.agentPreset}`,
      title ? `title: ${title}` : "title: (null)",
      meta
        ? `blank=${meta.blank} lastPromptAt=${meta.lastPromptAt ?? "null"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const q = ctl.view.queueItems;
    queueLine.textContent =
      q.length === 0
        ? "queue: (empty)"
        : `queue: ${q.map((i) => `${i.placement}:${i.content.slice(0, 40)}`).join(" | ")}`;

    approvalBox.replaceChildren();
    const pending = ctl.pendingApprovals.filter((a) => a.sessionId === sid);
    if (pending.length === 0) {
      const none = el("p", "approvals: (none)");
      none.className = "session-meta";
      approvalBox.append(none);
    } else {
      const title = el("p", `approvals: ${pending.length} pending`);
      title.className = "session-meta";
      approvalBox.append(title);
      for (const a of pending) {
        const row = el("div", "");
        row.className = "shell-btn-row";
        const label = el(
          "span",
          `${a.toolName} — ${a.reason}${a.argsSummary ? ` · ${a.argsSummary.slice(0, 60)}` : ""}`,
        );
        const allowBtn = document.createElement("button");
        allowBtn.type = "button";
        allowBtn.textContent = "Allow";
        allowBtn.addEventListener("click", () => {
          void ctl.respondApproval(a.approvalId, "allow");
        });
        const denyBtn = document.createElement("button");
        denyBtn.type = "button";
        denyBtn.textContent = "Deny";
        denyBtn.addEventListener("click", () => {
          void ctl.respondApproval(a.approvalId, "deny");
        });
        row.append(label, allowBtn, denyBtn);
        approvalBox.append(row);
      }
    }

    trajectory.replaceChildren();
    for (const node of ctl.view.fold.getSnapshot().nodes) {
      trajectory.append(renderTrajectoryNode(node));
    }
    log.textContent = ctl.lastLog || "(idle)";
  };

  const unsub = ctl.subscribe(render);
  const unsubView = ctl.view.subscribe(render);
  render();

  return () => {
    unsub();
    unsubView();
  };
}
