/**
 * Self-owned product chat shell (Face + web-runtime).
 * UX flow mirrors DSH conversation/sidebar; modules are XRK-only.
 */

import { FaceSessionView } from "@xrkseek/web-runtime";
import {
  FaceConnection,
  type FaceConnectionStatus,
} from "../connection.js";
import { defaultBaseUrl, el } from "../dom.js";
import { renderTrajectoryNode } from "../trajectory.js";

export interface SessionListItem {
  readonly sessionId: string;
  readonly title: string | null;
  readonly blank: boolean;
  readonly running: boolean;
  readonly updatedAt: number;
  readonly agentPreset?: string;
}

export function mountChatShell(root: HTMLElement): void {
  root.innerHTML = "";
  root.className = "xrk-chat";

  const view = new FaceSessionView();
  let sessions: SessionListItem[] = [];
  let agentPreset = "minimal";
  let status: FaceConnectionStatus = "idle";
  let statusDetail = "";
  let busy = false;

  const sidebar = el("aside", "");
  sidebar.className = "xrk-chat-sidebar";
  const main = el("main", "");
  main.className = "xrk-chat-main";
  const statusEl = el("div", "");
  statusEl.className = "xrk-chat-status";
  const sessionListEl = el("div", "");
  sessionListEl.className = "xrk-chat-sessions";
  const trajectory = el("div", "");
  trajectory.className = "xrk-chat-trajectory";
  const queueLine = el("p", "");
  queueLine.className = "xrk-chat-queue";
  const composer = el("form", "") as HTMLFormElement;
  composer.className = "xrk-chat-composer";
  const promptInput = document.createElement("textarea");
  promptInput.rows = 2;
  promptInput.placeholder = "发消息…（Enter 发送，Shift+Enter 换行）";
  promptInput.autocomplete = "off";

  const brand = el("div", "");
  brand.className = "xrk-chat-brand";
  brand.innerHTML = `<img src="/logo-plate.png" alt="" width="28" height="28" /><span>XRK</span>`;

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "xrk-chat-new";
  newBtn.textContent = "新会话";

  const presetSelect = document.createElement("select");
  presetSelect.className = "xrk-chat-preset";
  for (const id of ["minimal", "harness", "server"]) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    presetSelect.append(opt);
  }
  presetSelect.value = agentPreset;
  presetSelect.addEventListener("change", () => {
    agentPreset = presetSelect.value;
  });

  const header = el("header", "");
  header.className = "xrk-chat-header";
  const titleEl = el("h1", "选择或新建会话");
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  cancelBtn.hidden = true;

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.textContent = "发送";

  const conn = new FaceConnection({
    baseUrl: defaultBaseUrl(),
    onStatus: (next, detail) => {
      status = next;
      statusDetail = detail ?? "";
      renderChrome();
      if (next === "connected") {
        void refreshSessions();
      }
    },
    onMux: (frame) => {
      view.handleMux(frame);
    },
    onHost: (frame) => {
      void handleHost(frame);
    },
  });

  const renderChrome = (): void => {
    const label =
      status === "connected"
        ? "已连接"
        : status === "connecting"
          ? "连接中…"
          : status === "reconnecting"
            ? "重连中…"
            : status === "failed"
              ? `失败${statusDetail ? ` · ${statusDetail}` : ""}`
              : "未连接";
    statusEl.textContent = label;
    statusEl.dataset.state = status;

    const sid = view.activeSessionId;
    const title = view.title();
    titleEl.textContent = sid
      ? title?.trim() || sid.slice(0, 8)
      : "选择或新建会话";
    cancelBtn.hidden = !sid;
    sendBtn.disabled = !sid || busy || status !== "connected";
    promptInput.disabled = !sid || status !== "connected";
    newBtn.disabled = status !== "connected";

    const q = view.queueItems;
    queueLine.textContent =
      q.length === 0
        ? ""
        : `队列 · ${q.map((i) => i.content.slice(0, 48)).join(" · ")}`;
    queueLine.hidden = q.length === 0;
  };

  const renderSessions = (): void => {
    sessionListEl.replaceChildren();
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    if (sorted.length === 0) {
      const empty = el("p", "暂无会话");
      empty.className = "xrk-chat-empty";
      sessionListEl.append(empty);
      return;
    }
    for (const item of sorted) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "xrk-chat-session";
      if (item.sessionId === view.activeSessionId) {
        btn.classList.add("is-active");
      }
      if (item.running) btn.classList.add("is-running");
      const label = item.title?.trim() || (item.blank ? "空白会话" : item.sessionId.slice(0, 8));
      btn.textContent = label;
      btn.title = item.sessionId;
      btn.addEventListener("click", () => {
        void openSession(item.sessionId);
      });
      sessionListEl.append(btn);
    }
  };

  const renderTrajectory = (): void => {
    trajectory.replaceChildren();
    const nodes = view.fold.getSnapshot().nodes;
    if (!view.activeSessionId) {
      const hint = el("p", "连接 Host 后新建或打开会话。");
      hint.className = "xrk-chat-empty";
      trajectory.append(hint);
      return;
    }
    if (nodes.length === 0) {
      const hint = el("p", "开始对话吧。");
      hint.className = "xrk-chat-empty";
      trajectory.append(hint);
      return;
    }
    for (const node of nodes) {
      trajectory.append(renderTrajectoryNode(node));
    }
    trajectory.scrollTop = trajectory.scrollHeight;
  };

  const paint = (): void => {
    renderChrome();
    renderSessions();
    renderTrajectory();
  };
  view.subscribe(paint);

  const refreshSessions = async (): Promise<void> => {
    const listed = await conn.face.call<{ items: SessionListItem[] }>(
      "session.list",
      {},
    );
    if (!listed.ok) return;
    sessions = listed.value.items.map((i) => ({
      sessionId: i.sessionId,
      title: i.title ?? null,
      blank: Boolean(i.blank),
      running: Boolean(i.running),
      updatedAt: typeof i.updatedAt === "number" ? i.updatedAt : 0,
      ...(i.agentPreset ? { agentPreset: i.agentPreset } : {}),
    }));
    renderSessions();
  };

  const openSession = async (sessionId: string): Promise<void> => {
    view.attach(sessionId);
    paint();
    const history = await conn.face.call<{
      events: readonly { event: unknown; seq: number; view?: unknown }[];
      projections?: {
        asOfSeq: number;
        values: Record<string, unknown>;
      };
    }>("session.history", { sessionId, maxMessages: 200 });
    if (history.ok) {
      view.seedHistory(history.value);
    }
    paint();
  };

  const createSession = async (): Promise<void> => {
    if (status !== "connected") return;
    busy = true;
    renderChrome();
    const created = await conn.face.call<{
      sessionId: string;
      agentPreset?: string;
    }>("session.create", { agentPreset });
    busy = false;
    if (!created.ok) {
      statusDetail = created.error.message;
      renderChrome();
      return;
    }
    if (created.value.agentPreset) {
      agentPreset = created.value.agentPreset;
      presetSelect.value = agentPreset;
    }
    await refreshSessions();
    await openSession(created.value.sessionId);
  };

  const sendPrompt = async (): Promise<void> => {
    const sessionId = view.activeSessionId;
    if (!sessionId || status !== "connected") return;
    const text = promptInput.value.trim();
    if (!text) return;
    promptInput.value = "";
    busy = true;
    renderChrome();
    const result = await conn.face.call<{
      accepted: boolean;
      command?: { kind: string; text?: string };
    }>("session.prompt", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
    });
    busy = false;
    if (result.ok && result.value.accepted && !result.value.command) {
      view.noteOptimisticPrompt(result.rpcId, text);
    } else if (!result.ok) {
      statusDetail = result.error.message;
    }
    renderChrome();
    void refreshSessions();
  };

  const cancelTurn = async (): Promise<void> => {
    const sessionId = view.activeSessionId;
    if (!sessionId) return;
    await conn.face.call("session.cancel", { sessionId });
  };

  const handleHost = async (frame: unknown): Promise<void> => {
    if (!frame || typeof frame !== "object") return;
    const f = frame as { type?: string; sessionId?: string; running?: boolean };
    if (
      f.type === "host/session-added" ||
      f.type === "host/session-removed" ||
      f.type === "host/archived-sessions-changed"
    ) {
      await refreshSessions();
      return;
    }
    if (f.type === "host/session-status" && typeof f.sessionId === "string") {
      sessions = sessions.map((s) =>
        s.sessionId === f.sessionId
          ? { ...s, running: Boolean(f.running) }
          : s,
      );
      renderSessions();
      renderChrome();
    }
  };

  newBtn.addEventListener("click", () => {
    void createSession();
  });
  cancelBtn.addEventListener("click", () => {
    void cancelTurn();
  });
  composer.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void sendPrompt();
  });
  promptInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void sendPrompt();
    }
  });

  const sidebarTop = el("div", "");
  sidebarTop.className = "xrk-chat-sidebar-top";
  sidebarTop.append(brand, newBtn, presetSelect, statusEl);
  sidebar.append(sidebarTop, sessionListEl);

  header.append(titleEl, cancelBtn);
  const composerRow = el("div", "");
  composerRow.className = "xrk-chat-composer-row";
  composerRow.append(promptInput, sendBtn);
  composer.append(queueLine, composerRow);

  main.append(header, trajectory, composer);
  root.append(sidebar, main);

  paint();
  void conn.start();

  window.addEventListener("beforeunload", () => {
    conn.stop();
  });
}
