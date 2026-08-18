/**
 * Face verifier console (`?console=1`).
 * Product chat UI: `apps/web-static` capture; source `apps/web` + `packages/client`.
 */

import {
  BootGate,
  FaceSessionView,
  SlotRegistry,
} from "@xrkseek/web-runtime";
import { FaceClient } from "./face-client.js";
import { readBootManifest } from "./boot-manifest.js";
import { defaultBaseUrl, el, input, labeled } from "./dom.js";
import { renderTrajectoryNode } from "./trajectory.js";

export function mountFaceConsole(root: HTMLElement): void {
  const boot = readBootManifest();
  root.innerHTML = "";
  root.className = "xrk-face-console";

  const bootGate = new BootGate();
  bootGate.register("manifest", boot ? "active" : "failed");
  if (!boot) bootGate.fail("missing __DSH_BOOT__ / __XRK_BOOT__");

  const view = new FaceSessionView();
  const slots = new SlotRegistry();
  let mux: WebSocket | undefined;
  let client = new FaceClient({ baseUrl: defaultBaseUrl() });
  let agentPreset = "minimal";

  const brand = el("h1", "XRK Harness");
  const sub = el(
    "p",
    "Face console · optimism rpcId · queue · tool views · agentPreset · SlotRegistry",
  );
  const bootLine = el(
    "p",
    boot
      ? `boot rev=${boot.rev} entries=${boot.entries.length} · gate=${bootGate.getSnapshot().phase}`
      : `boot: none · gate=${bootGate.getSnapshot().phase}`,
  );
  const sessionMeta = el("p", "session: (none)");
  sessionMeta.className = "session-meta";
  const queueLine = el("p", "queue: (empty)");
  queueLine.className = "session-meta";

  const baseInput = input("text", defaultBaseUrl());
  const keyInput = input("password", "");
  keyInput.placeholder = "XRK_API_KEY (optional)";
  const promptInput = input("text", "ping");
  promptInput.placeholder = "prompt text or /recipe";
  const renameInput = input("text", "");
  renameInput.placeholder = "rename title";
  const presetSelect = document.createElement("select");
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

  const actions = el("div", "");
  actions.className = "actions";
  const trajectory = el("div", "");
  trajectory.className = "trajectory";
  const log = el("pre", "");
  log.className = "log";

  const render = (): void => {
    const sid = view.activeSessionId || "(none)";
    const title = view.title();
    const meta = view.listMetadata();
    sessionMeta.textContent = [
      `session: ${sid}`,
      `preset: ${agentPreset}`,
      title ? `title: ${title}` : "title: (null)",
      meta
        ? `blank=${meta.blank} lastPromptAt=${meta.lastPromptAt ?? "null"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const q = view.queueItems;
    queueLine.textContent =
      q.length === 0
        ? "queue: (empty)"
        : `queue: ${q.map((i) => `${i.placement}:${i.content.slice(0, 40)}`).join(" | ")}`;

    trajectory.replaceChildren();
    for (const node of view.fold.getSnapshot().nodes) {
      trajectory.append(renderTrajectoryNode(node));
    }

    actions.replaceChildren();
    for (const entry of slots.entriesOfSlot("console.actions")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = entry.options.label ?? entry.options.id ?? "action";
      const run = entry.contribution as () => void;
      btn.addEventListener("click", () => run());
      actions.append(btn);
    }
  };
  view.subscribe(render);

  const rebuildClient = (): FaceClient => {
    client = new FaceClient({
      baseUrl: baseInput.value.trim() || defaultBaseUrl(),
      ...(keyInput.value.trim() ? { apiKey: keyInput.value.trim() } : {}),
    });
    return client;
  };

  const connectMux = (sid: string): void => {
    mux?.close();
    view.attach(sid);
    mux = rebuildClient().openMux((frame) => {
      view.handleMux(frame);
    });
  };

  const createSession = async (): Promise<void> => {
    const c = rebuildClient();
    log.textContent = "…";
    const describe = await c.call<{ version: string; cwd: string }>(
      "host.describe",
      {},
    );
    if (!describe.ok) {
      log.textContent = JSON.stringify(describe, null, 2);
      return;
    }
    const created = await c.call<{ sessionId: string; agentPreset?: string }>(
      "session.create",
      { agentPreset },
    );
    if (!created.ok) {
      log.textContent = JSON.stringify({ describe, created }, null, 2);
      return;
    }
    const sessionId = created.value.sessionId;
    if (created.value.agentPreset) agentPreset = created.value.agentPreset;
    presetSelect.value = agentPreset;
    connectMux(sessionId);
    const history = await c.call<{
      events: readonly { event: unknown; seq: number; view?: unknown }[];
      projections?: {
        asOfSeq: number;
        values: Record<string, unknown>;
      };
    }>("session.history", { sessionId, maxMessages: 200 });
    if (history.ok) {
      view.seedHistory(history.value);
    }
    log.textContent = JSON.stringify(
      {
        describe,
        created,
        historyOk: history.ok,
        projections: history.ok ? history.value.projections : undefined,
        sessionId,
      },
      null,
      2,
    );
  };

  const sendPrompt = async (): Promise<void> => {
    const sessionId = view.activeSessionId;
    if (!sessionId) {
      log.textContent = "create a session first";
      return;
    }
    const c = rebuildClient();
    const text = promptInput.value.trim() || "ping";
    const result = await c.call<{
      accepted: boolean;
      command?: { kind: string; text?: string };
    }>("session.prompt", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
    });
    if (result.ok && result.value.accepted && !result.value.command) {
      view.noteOptimisticPrompt(result.rpcId, text);
    }
    log.textContent = JSON.stringify(result, null, 2);
  };

  const renameSession = async (): Promise<void> => {
    const sessionId = view.activeSessionId;
    if (!sessionId) {
      log.textContent = "create a session first";
      return;
    }
    const c = rebuildClient();
    const result = await c.call("session.rename", {
      sessionId,
      title: renameInput.value,
    });
    log.textContent = JSON.stringify(result, null, 2);
  };

  const selectPreset = async (): Promise<void> => {
    const sessionId = view.activeSessionId;
    if (!sessionId) {
      log.textContent = "create a session first";
      return;
    }
    const c = rebuildClient();
    const result = await c.call("agentPreset.select", {
      sessionId,
      agentPreset,
    });
    log.textContent = JSON.stringify(result, null, 2);
  };

  slots.register(
    {
      name: "root",
      children: {
        "console.actions": { kind: "list", scope: "root" },
      },
      registrant: "face-console",
    },
    null,
  );
  slots.register(
    {
      name: "console.actions",
      id: "create",
      order: 10,
      label: "1 · create session",
    },
    () => {
      void createSession();
    },
  );
  slots.register(
    {
      name: "console.actions",
      id: "prompt",
      order: 20,
      label: "2 · prompt / slash",
    },
    () => {
      void sendPrompt();
    },
  );
  slots.register(
    {
      name: "console.actions",
      id: "rename",
      order: 30,
      label: "3 · rename",
    },
    () => {
      void renameSession();
    },
  );
  slots.register(
    {
      name: "console.actions",
      id: "preset",
      order: 40,
      label: "4 · select preset",
    },
    () => {
      void selectPreset();
    },
  );

  root.append(
    brand,
    sub,
    bootLine,
    sessionMeta,
    queueLine,
    labeled("Host base URL", baseInput),
    labeled("API key", keyInput),
    labeled("Preset", presetSelect),
    labeled("Prompt", promptInput),
    labeled("Rename", renameInput),
    actions,
    el("h2", "Trajectory"),
    trajectory,
    el("h2", "RPC log"),
    log,
  );
  render();
}
