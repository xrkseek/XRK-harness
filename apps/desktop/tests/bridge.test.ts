import { describe, expect, it, vi } from "vitest";
import { createXrkDesktopBridgeApi } from "../src/bridge.js";
import { registerDesktopIpcHandlers } from "../src/desktop-ipc.js";
import { installDesktopApplicationMenu } from "../src/desktop-update-shell.js";
import {
  DESKTOP_BRIDGE_PROTOCOL_VERSION,
  DESKTOP_IPC,
  type DesktopUpdateState,
} from "../src/ipc.js";
import { formatDesktopMessage, resolveDesktopLocale, en, zh } from "../src/locale.js";

describe("desktop application menu", () => {
  it("hides the menu bar on Windows/Linux", () => {
    const setApplicationMenu = vi.fn();
    installDesktopApplicationMenu({
      menu: {
        setApplicationMenu,
        buildFromTemplate: vi.fn(() => ({ kind: "menu" })),
      },
      getLocale: () => "zh-CN",
      onCheckUpdates: () => undefined,
      platform: "win32",
    });
    expect(setApplicationMenu).toHaveBeenCalledWith(null);
  });

  it("installs Check for Updates on macOS", () => {
    const built = { kind: "menu" };
    const setApplicationMenu = vi.fn();
    const buildFromTemplate = vi.fn(() => built);
    installDesktopApplicationMenu({
      menu: { setApplicationMenu, buildFromTemplate },
      getLocale: () => "zh-CN",
      onCheckUpdates: () => undefined,
      platform: "darwin",
    });
    expect(buildFromTemplate).toHaveBeenCalledOnce();
    const template = buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label: string;
      submenu: Array<{ label: string }>;
    }>;
    expect(template[0]?.label).toBe(zh.application);
    expect(template[0]?.submenu[0]?.label).toBe(zh.checkUpdatesMenu);
    expect(setApplicationMenu).toHaveBeenCalledWith(built);
  });
});

describe("desktop locale", () => {
  it("ships matching English and Chinese key sets with English fallback", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(resolveDesktopLocale("zh-Hans-CN")).toEqual({
      id: "zh-CN",
      messages: zh,
    });
    expect(resolveDesktopLocale("en-US")).toEqual({ id: "en", messages: en });
    expect(resolveDesktopLocale("fr-FR")).toEqual({ id: "en", messages: en });
    expect(en.checkUpdatesMenu.length).toBeGreaterThan(0);
    expect(zh.checkUpdatesMenu).toContain("检查");
  });

  it("formats named placeholders", () => {
    expect(
      formatDesktopMessage("Desktop {version}", { version: "1.2.3" }),
    ).toBe("Desktop 1.2.3");
    expect(
      formatDesktopMessage("{name}@{version} {missing}", {
        name: "plugin",
        version: "1.2.3",
      }),
    ).toBe("plugin@1.2.3 {missing}");
  });
});

describe("desktop preload bridge", () => {
  it("exposes locale and update subscribe without plugin CRUD", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>
    >();
    const listeners = new Map<
      string,
      Set<(event: unknown, ...args: unknown[]) => void>
    >();

    registerDesktopIpcHandlers(
      {
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
      },
      {
        getLocale: () => "zh-CN",
        checkUpdates: async () =>
          ({ phase: "available", version: "0.0.1" }) satisfies DesktopUpdateState,
      },
    );

    const api = createXrkDesktopBridgeApi({
      invoke: async (channel, ...args) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`missing ${channel}`);
        return handler({}, ...args);
      },
      on: (channel, listener) => {
        const set = listeners.get(channel) ?? new Set();
        set.add(listener);
        listeners.set(channel, set);
      },
      off: (channel, listener) => {
        listeners.get(channel)?.delete(listener);
      },
    });

    expect(api.protocolVersion).toBe(DESKTOP_BRIDGE_PROTOCOL_VERSION);
    expect(api.platform).toBe(process.platform);
    expect("plugins" in api).toBe(false);
    const locale = await api.locale();
    expect(locale.id).toBe("zh-CN");
    expect(locale.messages.checkUpdatesMenu).toContain("检查更新");

    const state = await api.updates.check();
    expect(state).toEqual({ phase: "available", version: "0.0.1" });

    const seen: DesktopUpdateState[] = [];
    const unsubscribe = api.updates.subscribe((next) => {
      seen.push(next);
    });
    const push = listeners.get(DESKTOP_IPC.updatesState);
    expect(push?.size).toBe(1);
    for (const listener of push ?? []) {
      listener({}, { phase: "checking" });
    }
    expect(seen).toEqual([{ phase: "checking" }]);
    unsubscribe();
    expect(listeners.get(DESKTOP_IPC.updatesState)?.size ?? 0).toBe(0);
  });

  it("exposes frameless window chrome + reload", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>
    >();
    let maximized = false;
    const reload = vi.fn();
    const win = {
      minimize: vi.fn(),
      maximize: vi.fn(() => {
        maximized = true;
      }),
      unmaximize: vi.fn(() => {
        maximized = false;
      }),
      close: vi.fn(),
      isMaximized: () => maximized,
      isDestroyed: () => false,
      webContents: { reload, send: vi.fn() },
      on: vi.fn(),
    };
    registerDesktopIpcHandlers(
      {
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
      },
      {
        getLocale: () => "en",
        windowFromEvent: () => win,
      },
    );
    const api = createXrkDesktopBridgeApi({
      invoke: async (channel, ...args) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`missing ${channel}`);
        return handler({ sender: {} }, ...args);
      },
      on: () => undefined,
      off: () => undefined,
    });

    await api.window.minimize();
    expect(win.minimize).toHaveBeenCalledOnce();
    await api.window.toggleMaximize();
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(await api.window.isMaximized()).toBe(true);
    await api.window.toggleMaximize();
    expect(win.unmaximize).toHaveBeenCalledOnce();
    await api.window.reload();
    expect(reload).toHaveBeenCalledOnce();
    await api.window.close();
    expect(win.close).toHaveBeenCalledOnce();
  });
});
