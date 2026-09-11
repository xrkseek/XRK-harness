import { describe, expect, it, vi } from "vitest";
import { createXrkDesktopBridgeApi } from "../src/bridge.js";
import { registerDesktopIpcHandlers } from "../src/desktop-ipc.js";
import {
  DESKTOP_BRIDGE_PROTOCOL_VERSION,
  DESKTOP_IPC,
  type DesktopUpdateState,
} from "../src/ipc.js";
import { formatDesktopMessage, resolveDesktopLocale, en, zh } from "../src/locale.js";

describe("desktop locale", () => {
  it("ships matching English and Chinese key sets with English fallback", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(resolveDesktopLocale("zh-Hans-CN")).toEqual({
      id: "zh-CN",
      messages: zh,
    });
    expect(resolveDesktopLocale("en-US")).toEqual({ id: "en", messages: en });
    expect(resolveDesktopLocale("fr-FR")).toEqual({ id: "en", messages: en });
    expect(en.pluginsMenu.length).toBeGreaterThan(0);
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
});
