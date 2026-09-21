import { describe, expect, it } from "vitest";
import {
  createComputerUseTools,
  createDefaultComputerUseAccess,
  createMemoryComputerUseProvider,
  createWindowsUiAutomationProvider,
  formatAxSnapshot,
} from "../src/index.js";

describe("formatAxSnapshot", () => {
  it("lists numbered elements", () => {
    const text = formatAxSnapshot({
      app: "Demo",
      windowTitle: "Win",
      elements: [{ index: 1, role: "button", name: "OK" }],
    });
    expect(text).toContain("[1] [button] OK");
    expect(text).toContain("app: Demo");
  });
});

describe("createMemoryComputerUseProvider", () => {
  it("capture → click by element index", async () => {
    const svc = createMemoryComputerUseProvider();
    const snap = await svc.capture({ mode: "ax" });
    expect(snap.text).toContain("[1]");
    const acted = await svc.act({ action: "click", element: 1 });
    expect(acted.ok).toBe(true);
    expect(acted.delivery).toBe("memory");
  });

  it("type updates element name in later capture", async () => {
    const svc = createMemoryComputerUseProvider();
    await svc.capture();
    await svc.act({ action: "type", element: 2, text: "hello" });
    const snap = await svc.capture();
    expect(snap.text).toContain("hello");
  });
});

describe("createComputerUseTools", () => {
  it("fails honestly without a Provider", async () => {
    const [tool] = createComputerUseTools({ env: {} });
    const result = await tool!.execute({ action: "capture" });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain("computer-use");
  });

  it("capture via memory Provider", async () => {
    const svc = createMemoryComputerUseProvider();
    const [tool] = createComputerUseTools({ service: svc });
    const result = await tool!.execute({ action: "capture", mode: "ax" });
    expect(result.isError).toBeFalsy();
    expect(String(result.content)).toContain("elements:");
  });
});

describe("computer-use provider registry", () => {
  it("keeps one named provider and rejects a second", async () => {
    const { createComputerUseProviderRegistry } = await import("../src/registry.js");
    const registry = createComputerUseProviderRegistry();
    const release = registry.register("uia");
    expect(registry.providerName).toBe("uia");
    expect(() => registry.register("background")).toThrow(/already registered: uia/);
    release();
    registry.register("memory");
    expect(registry.providerName).toBe("memory");
  });
});

describe("background input provider", () => {
  it("returns unavailable when the helper is not installed", async () => {
    const access = createDefaultComputerUseAccess({
      env: { XRK_COMPUTER_USE: "background" },
    });
    expect(access.providerName).toBe("background");
    expect(access.service?.delivery).toBe("background");
    await expect(access.service!.act({ action: "click", element: 1 })).rejects.toThrow(
      /unavailable/,
    );
    const [tool] = createComputerUseTools({ service: access.service });
    const result = await tool!.execute({ action: "key", keys: "return" });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain("unavailable");
    expect(String(result.content)).not.toContain("browser_open");
  });

  it("sends input when a helper is injected", async () => {
    const { createBackgroundInputProvider } = await import("../src/background.js");
    const sent: string[] = [];
    const svc = createBackgroundInputProvider({
      installed: true,
      send: async (request) => {
        sent.push(request.action);
      },
    });
    const acted = await svc.act({ action: "key", keys: "ctrl+s" });
    expect(acted.delivery).toBe("background");
    expect(sent).toEqual(["key"]);
  });
});

describe("createDefaultComputerUseAccess", () => {
  it("enables memory when XRK_COMPUTER_USE=memory", () => {
    const access = createDefaultComputerUseAccess({
      env: { XRK_COMPUTER_USE: "memory" },
    });
    expect(access.service?.providerId).toBe("memory");
  });

  it("stays unavailable without flag", () => {
    const access = createDefaultComputerUseAccess({ env: {} });
    expect(access.service).toBeUndefined();
  });
});

describe("createWindowsUiAutomationProvider", () => {
  it("parses capture JSON from injected runner", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        return JSON.stringify({
          app: "Notepad",
          windowTitle: "Untitled",
          elements: [
            {
              index: 1,
              role: "Edit",
              name: "Text Editor",
              x: 0,
              y: 0,
              width: 100,
              height: 20,
              runtimeId: "42,1",
            },
          ],
        });
      },
    });
    const snap = await svc.capture();
    expect(snap.app).toBe("Notepad");
    expect(snap.elements[0]?.index).toBe(1);
    const acted = await svc.act({ action: "click", element: 1 });
    expect(acted.delivery).toBe("uia");
  });
});
