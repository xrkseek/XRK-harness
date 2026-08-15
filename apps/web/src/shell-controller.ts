/**
 * AppShell session bridge — FaceClient + FaceSessionView + mux + list/create/prompt.
 */

import {
  BootGate,
  FaceSessionView,
  SlotRegistry,
} from "@xrkseek/web-runtime";
import { FaceClient } from "./face-client.js";
import { defaultBaseUrl } from "./dom.js";

export interface SessionListItem {
  readonly sessionId: string;
  readonly title: string | null;
  readonly updatedAt: number;
  readonly running: boolean;
  readonly blank: boolean;
}

export type MuxState = "closed" | "connecting" | "open";

export class ShellController {
  readonly gate = new BootGate();
  readonly view = new FaceSessionView();
  readonly slots = new SlotRegistry();

  client: FaceClient;
  mux: WebSocket | undefined;
  muxState: MuxState = "closed";
  baseUrl: string;
  apiKey = "";
  agentPreset = "minimal";
  sessionItems: SessionListItem[] = [];
  lastLog = "";

  private readonly listeners = new Set<() => void>();

  constructor(baseUrl = defaultBaseUrl()) {
    this.baseUrl = baseUrl;
    this.client = new FaceClient({ baseUrl });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    for (const l of this.listeners) l();
  }

  setLog(message: string): void {
    this.lastLog = message;
    this.emit();
  }

  setConnection(baseUrl: string, apiKey: string): void {
    this.baseUrl = baseUrl.trim() || defaultBaseUrl();
    this.apiKey = apiKey.trim();
    this.rebuildClient();
    this.emit();
  }

  rebuildClient(): FaceClient {
    this.client = new FaceClient({
      baseUrl: this.baseUrl || defaultBaseUrl(),
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
    });
    return this.client;
  }

  /** Declare chrome.* children under root (layout-slots boot entry). */
  declareChromeSlots(): void {
    this.slots.register(
      {
        name: "root",
        registrant: "app-shell",
        children: {
          "chrome.sidebar": { kind: "list", scope: "root" },
          "chrome.main": { kind: "keyed", scope: "session-maybe" },
          "chrome.status": { kind: "list", scope: "root" },
        },
      },
      null,
    );
  }

  connectMux(sessionId: string): void {
    this.mux?.close();
    this.muxState = "connecting";
    this.view.attach(sessionId);
    this.pendingApprovals = this.pendingApprovals.filter(
      (a) => a.sessionId === sessionId,
    );
    this.emit();
    const ws = this.rebuildClient().openMux((frame) => {
      this.view.handleMux(frame);
      this.ingestApprovalMux(frame);
    });
    this.mux = ws;
    ws.addEventListener("open", () => {
      this.muxState = "open";
      this.emit();
    });
    ws.addEventListener("close", () => {
      if (this.mux === ws) {
        this.muxState = "closed";
        this.emit();
      }
    });
    ws.addEventListener("error", () => {
      if (this.mux === ws) {
        this.muxState = "closed";
        this.emit();
      }
    });
  }

  pendingApprovals: {
    approvalId: string;
    sessionId: string;
    toolName: string;
    reason: string;
    argsSummary?: string;
  }[] = [];

  private ingestApprovalMux(frame: unknown): void {
    if (!frame || typeof frame !== "object") return;
    const f = frame as {
      type?: string;
      sessionId?: string;
      items?: unknown[];
      event?: { type?: string; approvalId?: string; toolName?: string; reason?: string; argsSummary?: string };
    };
    if (f.type === "session/approvals" && typeof f.sessionId === "string") {
      const items = Array.isArray(f.items) ? f.items : [];
      this.pendingApprovals = items
        .map((raw) => {
          if (!raw || typeof raw !== "object") return undefined;
          const it = raw as Record<string, unknown>;
          if (
            typeof it.approvalId !== "string" ||
            typeof it.toolName !== "string" ||
            typeof it.reason !== "string"
          ) {
            return undefined;
          }
          return {
            approvalId: it.approvalId,
            sessionId: f.sessionId!,
            toolName: it.toolName,
            reason: it.reason,
            ...(typeof it.argsSummary === "string"
              ? { argsSummary: it.argsSummary }
              : {}),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
      this.emit();
      return;
    }
    if (
      f.type === "session/event" &&
      f.event?.type === "approval/asked" &&
      typeof f.sessionId === "string" &&
      typeof f.event.approvalId === "string"
    ) {
      const next = {
        approvalId: f.event.approvalId,
        sessionId: f.sessionId,
        toolName: f.event.toolName ?? "?",
        reason: f.event.reason ?? "",
        ...(f.event.argsSummary ? { argsSummary: f.event.argsSummary } : {}),
      };
      if (!this.pendingApprovals.some((a) => a.approvalId === next.approvalId)) {
        this.pendingApprovals = [...this.pendingApprovals, next];
        this.emit();
      }
    }
    if (
      f.type === "session/event" &&
      f.event?.type === "approval/decided" &&
      typeof f.event.approvalId === "string"
    ) {
      this.pendingApprovals = this.pendingApprovals.filter(
        (a) => a.approvalId !== f.event!.approvalId,
      );
      this.emit();
    }
  }

  async respondApproval(
    approvalId: string,
    decision: "allow" | "deny",
  ): Promise<void> {
    const sessionId = this.view.activeSessionId;
    if (!sessionId) {
      this.setLog("select a session first");
      return;
    }
    const c = this.rebuildClient();
    const result = await c.call("session.respondApproval", {
      sessionId,
      approvalId,
      decision,
    });
    this.setLog(JSON.stringify(result, null, 2));
    if (result.ok) {
      this.pendingApprovals = this.pendingApprovals.filter(
        (a) => a.approvalId !== approvalId,
      );
      this.emit();
    }
  }

  async refreshList(): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call<{ items: SessionListItem[] }>(
      "session.list",
      {},
    );
    if (!result.ok) {
      this.setLog(JSON.stringify(result, null, 2));
      return;
    }
    this.sessionItems = [...result.value.items].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    this.emit();
  }

  async selectSession(sessionId: string): Promise<void> {
    const c = this.rebuildClient();
    this.connectMux(sessionId);
    const history = await c.call<{
      events: readonly { event: unknown; seq: number; view?: unknown }[];
      projections?: {
        asOfSeq: number;
        values: Record<string, unknown>;
      };
    }>("session.history", { sessionId, maxMessages: 200 });
    if (history.ok) {
      this.view.seedHistory(history.value);
    }
    this.setLog(
      JSON.stringify(
        {
          selected: sessionId,
          historyOk: history.ok,
          projections: history.ok ? history.value.projections : undefined,
        },
        null,
        2,
      ),
    );
    await this.refreshList();
  }

  async createSession(): Promise<void> {
    const c = this.rebuildClient();
    this.setLog("…");
    const describe = await c.call<{ version: string; cwd: string }>(
      "host.describe",
      {},
    );
    if (!describe.ok) {
      this.setLog(JSON.stringify(describe, null, 2));
      return;
    }
    const created = await c.call<{ sessionId: string; agentPreset?: string }>(
      "session.create",
      { agentPreset: this.agentPreset },
    );
    if (!created.ok) {
      this.setLog(JSON.stringify({ describe, created }, null, 2));
      return;
    }
    if (created.value.agentPreset) {
      this.agentPreset = created.value.agentPreset;
    }
    const sessionId = created.value.sessionId;
    this.connectMux(sessionId);
    const history = await c.call<{
      events: readonly { event: unknown; seq: number; view?: unknown }[];
      projections?: {
        asOfSeq: number;
        values: Record<string, unknown>;
      };
    }>("session.history", { sessionId, maxMessages: 200 });
    if (history.ok) {
      this.view.seedHistory(history.value);
    }
    this.setLog(
      JSON.stringify(
        {
          describe,
          created,
          historyOk: history.ok,
          projections: history.ok ? history.value.projections : undefined,
          sessionId,
        },
        null,
        2,
      ),
    );
    await this.refreshList();
  }

  async prompt(text: string): Promise<void> {
    const sessionId = this.view.activeSessionId;
    if (!sessionId) {
      this.setLog("create or select a session first");
      return;
    }
    const c = this.rebuildClient();
    const content = text.trim() || "ping";
    const result = await c.call<{
      accepted: boolean;
      command?: { kind: string; text?: string };
    }>("session.prompt", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: content }],
    });
    if (result.ok && result.value.accepted && !result.value.command) {
      this.view.noteOptimisticPrompt(result.rpcId, content);
    }
    this.setLog(JSON.stringify(result, null, 2));
  }

  async rename(title: string): Promise<void> {
    const sessionId = this.view.activeSessionId;
    if (!sessionId) {
      this.setLog("create or select a session first");
      return;
    }
    const c = this.rebuildClient();
    const result = await c.call("session.rename", { sessionId, title });
    this.setLog(JSON.stringify(result, null, 2));
    await this.refreshList();
  }

  async selectPreset(): Promise<void> {
    const sessionId = this.view.activeSessionId;
    if (!sessionId) {
      this.setLog("create or select a session first");
      return;
    }
    const c = this.rebuildClient();
    const result = await c.call("agentPreset.select", {
      sessionId,
      agentPreset: this.agentPreset,
    });
    this.setLog(JSON.stringify(result, null, 2));
  }

  workspace: {
    root?: string;
    productDir?: string;
    productExists?: boolean;
    seedTemplates: string[];
    entries: { path: string; kind: string; bytes?: number }[];
    truncated?: boolean;
    inject?: {
      blockCount: number;
      totalChars: number;
      blocks: { heading: string; chars: number }[];
    };
  } = { seedTemplates: [], entries: [] };

  async refreshWorkspace(): Promise<void> {
    const c = this.rebuildClient();
    const desc = await c.call<{
      root: string;
      productDir: string;
      productExists: boolean;
      seedTemplates: string[];
    }>("workspace.describe", {});
    if (!desc.ok) {
      this.setLog(JSON.stringify(desc, null, 2));
      return;
    }
    const list = await c.call<{
      exists: boolean;
      truncated: boolean;
      entries: { path: string; kind: string; bytes?: number }[];
    }>("workspace.listProduct", {});
    const preview = await c.call<{
      blockCount: number;
      totalChars: number;
      blocks: { heading: string; chars: number }[];
    }>("workspace.previewInject", {});

    this.workspace = {
      root: desc.value.root,
      productDir: desc.value.productDir,
      productExists: desc.value.productExists,
      seedTemplates: desc.value.seedTemplates ?? [],
      entries: list.ok ? [...list.value.entries] : [],
      truncated: list.ok ? list.value.truncated : undefined,
      inject: preview.ok
        ? {
            blockCount: preview.value.blockCount,
            totalChars: preview.value.totalChars,
            blocks: [...preview.value.blocks],
          }
        : undefined,
    };
    this.setLog(
      JSON.stringify(
        {
          describe: desc.value,
          listOk: list.ok,
          previewOk: preview.ok,
          inject: this.workspace.inject,
        },
        null,
        2,
      ),
    );
  }

  async syncWorkspaceSeeds(template = "office-agent"): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call("workspace.syncSeeds", { template });
    this.setLog(JSON.stringify(result, null, 2));
    if (result.ok) await this.refreshWorkspace();
  }

  settings: {
    theme: string;
    locale: string;
    hostPreset?: string;
    hostPort?: number;
  } = { theme: "system", locale: "en" };

  credentials: {
    slots: {
      id: string;
      label: string;
      configured: boolean;
      source: string;
      envVar?: string;
    }[];
  } = { slots: [] };

  async refreshSettings(): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call<{
      values: {
        ui: { theme: string; locale: string };
        host: { preset: string; port: number } | null;
      };
    }>("settings.get", {});
    if (!result.ok) {
      this.setLog(JSON.stringify(result, null, 2));
      return;
    }
    this.settings = {
      theme: result.value.values.ui.theme,
      locale: result.value.values.ui.locale,
      ...(result.value.values.host
        ? {
            hostPreset: result.value.values.host.preset,
            hostPort: result.value.values.host.port,
          }
        : {}),
    };
    this.emit();
  }

  async setUiSettings(patch: {
    theme?: string;
    locale?: string;
  }): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call("settings.set", { scope: "ui", patch });
    this.setLog(JSON.stringify(result, null, 2));
    if (result.ok) await this.refreshSettings();
  }

  async refreshCredentials(): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call<{
      slots: {
        id: string;
        label: string;
        configured: boolean;
        source: string;
        envVar?: string;
      }[];
    }>("credentials.list", {});
    if (!result.ok) {
      this.setLog(JSON.stringify(result, null, 2));
      return;
    }
    this.credentials = { slots: [...result.value.slots] };
    this.emit();
  }

  async setCredential(slotId: string, value: string): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call("credentials.set", { slotId, value });
    this.setLog(JSON.stringify(result, null, 2));
    if (result.ok) await this.refreshCredentials();
  }

  async clearCredential(slotId: string): Promise<void> {
    const c = this.rebuildClient();
    const result = await c.call("credentials.set", { slotId, clear: true });
    this.setLog(JSON.stringify(result, null, 2));
    if (result.ok) await this.refreshCredentials();
  }

  async forkSession(beforeSeq?: number): Promise<void> {
    const sessionId = this.view.activeSessionId;
    if (!sessionId) {
      this.setLog("select a session first");
      return;
    }
    const c = this.rebuildClient();
    const result = await c.call<{
      sessionId: string;
      parentSessionId: string;
      eventCount: number;
    }>("session.fork", {
      sessionId,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    });
    this.setLog(JSON.stringify(result, null, 2));
    if (result.ok) {
      await this.selectSession(result.value.sessionId);
    }
  }

  /** Display title for a list row: prefer live projection when active. */
  displayTitle(item: SessionListItem): string {
    if (item.sessionId === this.view.activeSessionId) {
      const live = this.view.title();
      if (live) return live;
    }
    if (item.title) return item.title;
    return item.sessionId.slice(0, 8);
  }
}
