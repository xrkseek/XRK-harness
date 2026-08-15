/**
 * SlotRegistry-driven chrome: sidebar | main | status.
 */

import type { ShellController } from "../shell-controller.js";
import { mountSidebar } from "./panels/sidebar.js";
import { mountConversation } from "./panels/conversation.js";
import { mountWorkspacePanel } from "./panels/workspace.js";
import { mountSettingsPanel } from "./panels/settings.js";
import { mountStatusLine } from "./panels/status.js";

export function mountShell(root: HTMLElement, ctl: ShellController): void {
  root.innerHTML = "";
  root.className = "xrk-app-shell";

  const layout = document.createElement("div");
  layout.className = "shell-layout";

  const sidebarHost = document.createElement("aside");
  sidebarHost.className = "shell-chrome-sidebar";
  const mainHost = document.createElement("main");
  mainHost.className = "shell-chrome-main";
  const statusHost = document.createElement("footer");
  statusHost.className = "shell-chrome-status";

  layout.append(sidebarHost, mainHost, statusHost);
  root.append(layout);

  ctl.slots.register(
    {
      name: "chrome.sidebar",
      id: "sessions",
      order: 10,
      label: "Sessions",
      registrant: "shell-sidebar",
    },
    (host: HTMLElement) => mountSidebar(host, ctl),
  );
  ctl.slots.register(
    {
      name: "chrome.sidebar",
      id: "workspace",
      order: 20,
      label: "Workspace",
      registrant: "shell-workspace",
    },
    (host: HTMLElement) => mountWorkspacePanel(host, ctl),
  );
  ctl.slots.register(
    {
      name: "chrome.sidebar",
      id: "settings",
      order: 30,
      label: "Settings",
      registrant: "shell-settings",
    },
    (host: HTMLElement) => mountSettingsPanel(host, ctl),
  );
  ctl.slots.register(
    {
      name: "chrome.main",
      key: "conversation",
      label: "Conversation",
      registrant: "shell-conversation",
    },
    (host: HTMLElement) => mountConversation(host, ctl),
  );
  for (const [id, order] of [
    ["boot", 10],
    ["connection", 20],
    ["queue", 30],
    ["workspace", 40],
  ] as const) {
    ctl.slots.register(
      {
        name: "chrome.status",
        id,
        order,
        label: id,
        registrant: `shell-status-${id}`,
      },
      (host: HTMLElement) => mountStatusLine(host, ctl, id),
    );
  }

  const mounted = new Set<string>();

  const paint = (): void => {
    for (const entry of ctl.slots.entriesOfSlot("chrome.sidebar")) {
      const key = `sidebar:${entry.options.id ?? ""}`;
      if (mounted.has(key)) continue;
      mounted.add(key);
      const cell = document.createElement("div");
      sidebarHost.append(cell);
      const mount = entry.contribution as (h: HTMLElement) => () => void;
      mount(cell);
    }
    for (const entry of ctl.slots.entriesOfSlot("chrome.main")) {
      const key = `main:${entry.options.key ?? ""}`;
      if (mounted.has(key)) continue;
      mounted.add(key);
      const mount = entry.contribution as (h: HTMLElement) => () => void;
      mount(mainHost);
    }
    for (const entry of ctl.slots.entriesOfSlot("chrome.status")) {
      const key = `status:${entry.options.id ?? ""}`;
      if (mounted.has(key)) continue;
      mounted.add(key);
      const cell = document.createElement("div");
      statusHost.append(cell);
      const mount = entry.contribution as (h: HTMLElement) => () => void;
      mount(cell);
    }
  };

  ctl.slots.onMutate(() => paint());
  paint();
}
