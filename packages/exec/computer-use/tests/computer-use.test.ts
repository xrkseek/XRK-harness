import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureScript,
  COMPUTER_USE_PROMPT_TEXT,
  createComputerUseTools,
  createDefaultComputerUseAccess,
  createMemoryComputerUseProvider,
  createWindowsUiAutomationProvider,
  escapeSendKeys,
  formatAxSnapshot,
  isComputerUseEnabled,
  mapKeysToSendKeys,
  pinAgentDesktopEnv,
  type ComputerUseService,
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

  it("includes mode and elementToken for SOM honesty", () => {
    const text = formatAxSnapshot({
      app: "Demo",
      windowTitle: "Win",
      mode: "som",
      elements: [
        {
          index: 1,
          role: "button",
          name: "OK",
          elementToken: "mem-1-1",
        },
      ],
      note: "memory provider has no screenshot; AX elements only",
    });
    expect(text).toContain("mode: som");
    expect(text).toContain("token=mem-1-1");
    expect(text).toContain("no screenshot");
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

  it("mode=som keeps AX tokens and honesty note", async () => {
    const svc = createMemoryComputerUseProvider();
    const snap = await svc.capture({ mode: "som" });
    expect(snap.mode).toBe("som");
    expect(snap.text).toContain("mode: som");
    expect(snap.text).toContain("token=mem-");
    expect(snap.note ?? snap.text).toMatch(/no screenshot/i);
  });
});

describe("createComputerUseTools", () => {
  it("fails honestly without a Provider", async () => {
    const [tool] = createComputerUseTools({ env: {} });
    const result = await tool!.execute({ action: "capture" });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain("computer_use");
  });

  it("capture via memory Provider", async () => {
    const svc = createMemoryComputerUseProvider();
    const [tool] = createComputerUseTools({ service: svc });
    const result = await tool!.execute({ action: "capture", mode: "ax" });
    expect(result.isError).toBeFalsy();
    expect(String(result.content)).toContain("elements:");
  });

  it("mode=vision returns multimodal content when saveScreenshot is wired", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const svc = createMemoryComputerUseProvider({ screenshotPng: png });
    const [tool] = createComputerUseTools({
      service: svc,
      saveScreenshot: async (bytes) => ({
        attachmentId: "sha256:cu-shot",
        mediaType: "image/png",
        bytes: bytes.byteLength,
        width: 1,
        height: 1,
        name: "computer-use-snapshot.png",
      }),
    });
    const result = await tool!.execute({ action: "capture", mode: "vision" });
    expect(result.isError).toBeFalsy();
    const blocks = result.content as {
      type: string;
      text?: string;
      attachment?: { attachmentId: string };
    }[];
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.some((b) => b.type === "text" && b.text?.includes("mode: vision"))).toBe(
      true,
    );
    expect(
      blocks.some(
        (b) =>
          b.type === "text" &&
          b.text?.includes("attachmentId=sha256:cu-shot") &&
          b.text?.includes("not a disk path"),
      ),
    ).toBe(true);
    expect(
      blocks.some(
        (b) => b.type === "image" && b.attachment?.attachmentId === "sha256:cu-shot",
      ),
    ).toBe(true);
  });

  it("mode=vision fails honestly without attachment store", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const svc = createMemoryComputerUseProvider({ screenshotPng: png });
    const [tool] = createComputerUseTools({ service: svc });
    const result = await tool!.execute({ action: "capture", mode: "vision" });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toMatch(/attachment store/i);
  });

  it("mode=vision soft-degrades on text-only routes", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const svc = createMemoryComputerUseProvider({ screenshotPng: png });
    const [tool] = createComputerUseTools({
      service: svc,
      routeAllowsImage: () => false,
      saveScreenshot: async (bytes) => ({
        attachmentId: "sha256:cu-text-only",
        mediaType: "image/png",
        bytes: bytes.byteLength,
        width: 1,
        height: 1,
      }),
    });
    const result = await tool!.execute({ action: "capture", mode: "vision" });
    expect(result.isError).toBeFalsy();
    expect((result.meta as { textOnlyRoute?: boolean } | undefined)?.textOnlyRoute).toBe(
      true,
    );
    const blocks = result.content as {
      type: string;
      text?: string;
      attachment?: { attachmentId: string };
    }[];
    const text = blocks.find((b) => b.type === "text")?.text ?? "";
    expect(text).toMatch(/text-only/i);
    expect(text).toMatch(/pixels off wire/i);
    expect(text).not.toContain("screenshot inline");
    expect(
      blocks.some(
        (b) =>
          b.type === "image" && b.attachment?.attachmentId === "sha256:cu-text-only",
      ),
    ).toBe(true);
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

  it("composes UIA capture with background act", async () => {
    const { composeBackgroundWithCapture, createBackgroundInputProvider } =
      await import("../src/background.js");
    const sent: string[] = [];
    const act = createBackgroundInputProvider({
      installed: true,
      send: async (request) => {
        sent.push(request.action);
      },
    });
    const capture = createMemoryComputerUseProvider();
    const svc = composeBackgroundWithCapture(act, capture);
    const snap = await svc.capture({ mode: "ax" });
    expect(snap.text).toContain("[1]");
    expect(svc.delivery).toBe("background");
    const acted = await svc.act({ action: "click", element: 1 });
    expect(acted.delivery).toBe("background");
    expect(sent).toEqual(["click"]);
  });

  it("routes focus_window / clipboard to capture Provider on background compose", async () => {
    const { composeBackgroundWithCapture, createBackgroundInputProvider } =
      await import("../src/background.js");
    const helperActs: string[] = [];
    const captureActs: string[] = [];
    const act = createBackgroundInputProvider({
      installed: true,
      send: async (request) => {
        helperActs.push(request.action);
      },
    });
    const capture: ComputerUseService = {
      providerId: "uia",
      delivery: "uia",
      async capture() {
        return {
          mode: "ax",
          app: "Demo",
          windowTitle: "Demo",
          elements: [],
          text: "ok",
        };
      },
      async listWindows() {
        return [];
      },
      async act(request) {
        captureActs.push(request.action);
        return {
          ok: true,
          action: request.action,
          message: "uia",
          delivery: "uia",
        };
      },
    };
    const svc = composeBackgroundWithCapture(act, capture);
    await svc.act({ action: "focus_window", app: "WeChat" });
    await svc.act({ action: "clipboard_set", text: "hi" });
    await svc.act({ action: "click", element: 1 });
    expect(captureActs).toEqual(["focus_window", "clipboard_set"]);
    expect(helperActs).toEqual(["click"]);
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

  it("uses Face product when env unset", () => {
    const access = createDefaultComputerUseAccess({
      env: {},
      product: { mode: "background" },
    });
    expect(access.providerName).toBe("background");
  });

  it("env XRK_COMPUTER_USE bypasses product", () => {
    const access = createDefaultComputerUseAccess({
      env: { XRK_COMPUTER_USE: "memory" },
      product: { mode: "uia" },
    });
    expect(access.service?.providerId).toBe("memory");
  });

  it("bare XRK_COMPUTER_USE=1 prefers Settings product over forced UIA", () => {
    const access = createDefaultComputerUseAccess({
      env: { XRK_COMPUTER_USE: "1" },
      product: { mode: "agent-desktop" },
    });
    expect(access.providerName).toBe("agent-desktop");
    expect(access.service?.delivery).toBe("agent-desktop");
  });

  it("explicit XRK_COMPUTER_USE=uia still forces UIA over product", () => {
    const access = createDefaultComputerUseAccess({
      env: { XRK_COMPUTER_USE: "uia" },
      product: { mode: "agent-desktop" },
    });
    // UIA Provider is Windows-only; Linux CI must not invent a desktop backend.
    if (process.platform === "win32") {
      expect(access.providerName).toBe("uia");
    } else {
      expect(access.providerName).toBeUndefined();
      expect(access.service).toBeUndefined();
    }
  });

  it("product off leaves no service", () => {
    const access = createDefaultComputerUseAccess({
      env: {},
      product: { mode: "off" },
    });
    expect(access.service).toBeUndefined();
  });

  it("product agent-desktop mounts agent-desktop provider", () => {
    const access = createDefaultComputerUseAccess({
      env: {},
      product: { mode: "agent-desktop" },
    });
    expect(access.providerName).toBe("agent-desktop");
    expect(access.service?.providerId).toBe("agent-desktop");
  });

  it("pins AGENT_DESKTOP_HOME under XRK_HOME (avoids polluted ~/.agent-desktop)", () => {
    const env: NodeJS.ProcessEnv = {
      XRK_HOME: path.join(os.tmpdir(), `xrk-ad-home-${process.pid}`),
    };
    const access = createDefaultComputerUseAccess({
      env,
      product: { mode: "agent-desktop" },
    });
    expect(access.providerName).toBe("agent-desktop");
    expect(env.AGENT_DESKTOP_HOME).toBe(
      path.join(env.XRK_HOME!, "agent-desktop"),
    );
    expect(existsSync(env.AGENT_DESKTOP_HOME!)).toBe(true);
  });

  it("keeps an explicit AGENT_DESKTOP_HOME override", () => {
    const home = path.join(os.tmpdir(), `xrk-ad-override-${process.pid}`);
    const env: NodeJS.ProcessEnv = {
      XRK_HOME: path.join(os.tmpdir(), "xrk-unused-home"),
      AGENT_DESKTOP_HOME: home,
    };
    pinAgentDesktopEnv(env);
    expect(path.resolve(env.AGENT_DESKTOP_HOME!)).toBe(path.resolve(home));
  });

  it.skipIf(process.platform !== "win32")(
    "UIA tool schema does not advertise agent-desktop-only actions",
    () => {
      const access = createDefaultComputerUseAccess({
        env: {},
        product: { mode: "uia" },
      });
      expect(access.providerName).toBe("uia");
      const [tool] = createComputerUseTools({ service: access.service });
      const actionEnum = (
        tool!.parameters as { properties: { action: { enum: string[] } } }
      ).properties.action.enum;
      expect(actionEnum).toContain("focus_window");
      expect(actionEnum).toContain("click");
      expect(actionEnum).not.toContain("launch");
      expect(actionEnum).not.toContain("overlay");
      expect(actionEnum).not.toContain("list_apps");
      expect(String(tool!.description)).toMatch(/delivery=uia/);
    },
  );

  it.skipIf(process.platform === "win32")(
    "product uia stays unavailable off Windows",
    () => {
      const access = createDefaultComputerUseAccess({
        env: {},
        product: { mode: "uia" },
      });
      expect(access.providerName).toBeUndefined();
      expect(access.service).toBeUndefined();
    },
  );
});

describe("isComputerUseEnabled", () => {
  it("is false when product off and env unset", () => {
    expect(isComputerUseEnabled({ env: {}, product: { mode: "off" } })).toBe(
      false,
    );
  });

  it("is true for agent-desktop product", () => {
    expect(
      isComputerUseEnabled({
        env: {},
        product: { mode: "agent-desktop" },
      }),
    ).toBe(true);
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

  it("sends key via SendKeys mapping without element", async () => {
    const scripts: string[] = [];
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        scripts.push(script);
        return "keyed";
      },
    });
    const acted = await svc.act({ action: "key", keys: "ctrl+s" });
    expect(acted.ok).toBe(true);
    expect(acted.delivery).toBe("uia");
    expect(scripts[0]).toContain("SendWait");
    expect(scripts[0]).toContain("^s");
  });

  it("focus_window / status / list_displays do not require element", async () => {
    const scripts: string[] = [];
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        scripts.push(script);
        if (script.includes("AllScreens")) {
          return JSON.stringify({
            displays: [
              {
                index: 0,
                primary: true,
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                device: "\\\\.\\DISPLAY1",
              },
            ],
          });
        }
        return "focused:Weixin|微信";
      },
    });
    const focused = await svc.act({ action: "focus_window", app: "Weixin" });
    expect(focused.ok).toBe(true);
    expect(focused.message).toContain("Weixin");
    expect(scripts.some((s) => s.includes("SetForegroundWindow"))).toBe(true);

    // element= is ignored for window-level focus (session regression: was unsupported)
    const focusedWithEl = await svc.act({
      action: "focus_window",
      app: "Weixin",
      element: 1,
    });
    expect(focusedWithEl.ok).toBe(true);

    const status = await svc.act({ action: "status" });
    expect(status.ok).toBe(true);
    expect(status.message).toContain("windows-uia");

    const displays = await svc.act({ action: "list_displays" });
    expect(displays.ok).toBe(true);
    expect(displays.message).toContain("1920");
  });

  it("rejects focus_window without app or title", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        return "";
      },
    });
    await expect(svc.act({ action: "focus_window" })).rejects.toThrow(
      /app=|title/,
    );
  });

  it("scrolls with ScrollPattern script and optional element", async () => {
    const scripts: string[] = [];
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        if (script.includes("ConvertTo-Json") && script.includes("elements")) {
          return JSON.stringify({
            app: "List",
            windowTitle: "List",
            elements: [{ index: 1, role: "List", name: "Items", runtimeId: "9,1" }],
          });
        }
        scripts.push(script);
        return "scrolled-pattern";
      },
    });
    await svc.capture();
    const acted = await svc.act({
      action: "scroll",
      element: 1,
      direction: "down",
      amount: 2,
    });
    expect(acted.ok).toBe(true);
    expect(acted.message).toContain("scrolled");
    expect(scripts[0]).toContain("ScrollPattern");
    expect(scripts[0]).toContain("9,1");
  });

  it("rejects unknown key tokens", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        return "";
      },
    });
    await expect(svc.act({ action: "key", keys: "win+r" })).rejects.toThrow(
      /win\/meta|not supported/,
    );
  });
});

describe("captureScript", () => {
  it("guards int overflow and CJK output encoding", () => {
    const script = captureScript({ app: "QQ", maxElements: 20 });
    // Chromium/Electron report ±Infinity BoundingRectangles; a bare [int] cast killed the run.
    expect(script).toContain("XrkSafeInt");
    expect(script).not.toMatch(/\[int\]\$r\./);
    // Windows PowerShell writes the OEM codepage, which mangles CJK element names.
    expect(script).toContain("[Console]::OutputEncoding");
    expect(script).toContain("$max = 20");
  });

  it("embeds app filters as single-quoted PowerShell literals", () => {
    const script = captureScript({ app: "it's $env:X" });
    expect(script).toContain("$appFilter = 'it''s $env:X'");
  });

  it("embeds screenshot + SOM annotation flags for mode=vision|som", () => {
    const ax = captureScript({ maxElements: 10 });
    expect(ax).toContain("$includeScreenshot = $false");
    expect(ax).toContain("$annotateSom = $false");
    const vision = captureScript({ includeScreenshot: true });
    expect(vision).toContain("$includeScreenshot = $true");
    expect(vision).toContain("CopyFromScreen");
    expect(vision).toContain("$annotateSom = $false");
    const som = captureScript({ includeScreenshot: true, annotateSom: true });
    expect(som).toContain("$annotateSom = $true");
    expect(som).toContain("DrawString");
  });
});

describe("createWindowsUiAutomationProvider hardening", () => {
  it("reads the wrapped windows list instead of {value,Count}", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        // What PowerShell 5.1 emits for a bare piped array — must not look like one window.
        return JSON.stringify({
          windows: [
            { title: "QQ", pid: 25324, app: "QQ" },
            { title: "Clash Verge", pid: 2460, app: "clash-verge" },
          ],
        });
      },
    });
    const windows = await svc.listWindows();
    expect(windows).toHaveLength(2);
    expect(windows[0]?.title).toBe("QQ");
    expect(windows[1]?.app).toBe("clash-verge");
  });

  it("reports open windows when the app filter matches nothing", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        return JSON.stringify({
          error: "app-not-found",
          app: "",
          windowTitle: "",
          elements: [],
          candidates: ["QQ [QQ]", "Edge [msedge]"],
        });
      },
    });
    await expect(svc.capture({ app: "WeChat" })).rejects.toThrow(
      /no window matches "WeChat".*QQ \[QQ\]/,
    );
  });

  it("retries once with offscreen nodes when the first tree is empty", async () => {
    const scripts: string[] = [];
    let first = true;
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        scripts.push(script);
        if (scripts.length === 1) {
          return JSON.stringify({ app: "QQ", windowTitle: "QQ", elements: [] });
        }
        return JSON.stringify({
          app: "QQ",
          windowTitle: "QQ",
          elements: [{ index: 1, role: "Edit", name: "输入", x: 1, y: 2, width: 3, height: 4, runtimeId: "7,1" }],
        });
      },
    });
    const snap = await svc.capture({ app: "QQ" });
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).toContain("$keepOffscreen = $true");
    expect(snap.elements[0]?.name).toBe("输入");
  });

  it("drops bounds when the element rectangle is offscreen", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        return JSON.stringify({
          app: "Edge",
          windowTitle: "Edge",
          elements: [
            { index: 1, role: "Edit", name: "off", x: null, y: null, width: null, height: null, runtimeId: "8,1" },
          ],
        });
      },
    });
    const snap = await svc.capture();
    expect(snap.elements[0]?.bounds).toBeUndefined();
  });

  it("decodes mode=vision screenshotBase64 into screenshotPng", async () => {
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let seenScript = "";
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        seenScript = script;
        return JSON.stringify({
          app: "Notepad",
          windowTitle: "Untitled",
          elements: [
            {
              index: 1,
              role: "Edit",
              name: "body",
              x: 10,
              y: 20,
              width: 100,
              height: 40,
              runtimeId: "1,2",
            },
          ],
          screenshotBase64: b64,
        });
      },
    });
    const snap = await svc.capture({ mode: "vision" });
    expect(seenScript).toContain("$includeScreenshot = $true");
    expect(seenScript).toContain("$annotateSom = $false");
    expect(snap.mode).toBe("vision");
    expect(snap.screenshotPng?.byteLength).toBeGreaterThan(0);
    expect(snap.note ?? "").toMatch(/screenshot=png \(vision\)/);
  });

  it("mode=som requests annotateSom and notes SOM labels", async () => {
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let seenScript = "";
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        seenScript = script;
        return JSON.stringify({
          app: "Notepad",
          windowTitle: "Untitled",
          elements: [
            {
              index: 1,
              role: "Button",
              name: "OK",
              x: 1,
              y: 2,
              width: 3,
              height: 4,
              runtimeId: "9,1",
            },
          ],
          screenshotBase64: b64,
        });
      },
    });
    const snap = await svc.capture({ mode: "som" });
    expect(seenScript).toContain("$annotateSom = $true");
    expect(snap.mode).toBe("som");
    expect(snap.screenshotPng?.byteLength).toBeGreaterThan(0);
    expect(snap.note ?? "").toMatch(/SOM index labels/);
  });

  it("mode=vision notes screenshot failure without dropping AX", async () => {
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell() {
        return JSON.stringify({
          app: "Notepad",
          windowTitle: "Untitled",
          elements: [
            {
              index: 1,
              role: "Edit",
              name: "body",
              x: 1,
              y: 2,
              width: 3,
              height: 4,
              runtimeId: "1,1",
            },
          ],
          screenshotBase64: "",
          screenshotError: "window has no on-screen bounds for screenshot",
        });
      },
    });
    const snap = await svc.capture({ mode: "vision" });
    expect(snap.screenshotPng).toBeUndefined();
    expect(snap.elements).toHaveLength(1);
    expect(snap.note ?? "").toMatch(/screenshot unavailable/);
  });

  it("escapes SendKeys punctuation and quotes on the type fallback", async () => {
    const scripts: string[] = [];
    const svc = createWindowsUiAutomationProvider({
      async runPowerShell(script) {
        if (script.includes("ConvertTo-Json") && script.includes("elements")) {
          return JSON.stringify({
            app: "QQ",
            windowTitle: "QQ",
            elements: [{ index: 1, role: "Edit", name: "chat", runtimeId: "3,1" }],
          });
        }
        scripts.push(script);
        return "typed-paste";
      },
    });
    await svc.capture();
    const acted = await svc.act({ action: "type", element: 1, text: "it's 100%(a)" });
    expect(acted.message).toContain("typed");
    expect(scripts[0]).toContain("$text = 'it''s 100%(a)'");
    expect(scripts[0]).toContain("{%}");
    expect(scripts[0]).toContain("{(}");
    // clipboard path keeps CJK out of SendKeys entirely
    expect(scripts[0]).toContain("Set-Clipboard");
  });

  it.skipIf(process.platform !== "win32")(
    "times out a wedged UIA script instead of hanging forever",
    async () => {
      const svc = createWindowsUiAutomationProvider({
        timeoutMs: 1_000,
      });
      await expect(
        svc.capture({ app: "no-such-app-anywhere" }),
      ).rejects.toThrow(/COMPUTER_USE_BACKEND|timed out|no window matches/);
    },
  );
});

describe("mapKeysToSendKeys", () => {
  it("maps common combos", () => {
    expect(mapKeysToSendKeys("return")).toBe("{ENTER}");
    expect(mapKeysToSendKeys("ctrl+shift+s")).toBe("^+s");
    expect(mapKeysToSendKeys("alt+f4")).toBe("%{F4}");
  });
});

describe("escapeSendKeys", () => {
  it("braces every reserved SendKeys character", () => {
    expect(escapeSendKeys("a+b%c~d(e)f{g}")).toBe("a{+}b{%}c{~}d{(}e{)}f{{}g{}}");
    expect(escapeSendKeys("中文 hello")).toBe("中文 hello");
  });
});

describe("COMPUTER_USE_PROMPT_TEXT", () => {
  it("stays orthogonal (page-vs-desktop routing lives in web family)", () => {
    expect(COMPUTER_USE_PROMPT_TEXT).toMatch(/native/i);
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("list_windows");
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("coordinate");
    expect(COMPUTER_USE_PROMPT_TEXT).toMatch(/click|type|key|scroll/);
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("invalidates");
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("headless");
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("headed=true");
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("Ladder:");
    expect(COMPUTER_USE_PROMPT_TEXT).toContain("find");
    expect(COMPUTER_USE_PROMPT_TEXT).toMatch(/multimodal/i);
    expect(COMPUTER_USE_PROMPT_TEXT).toMatch(/soft-degrade/i);
    expect(COMPUTER_USE_PROMPT_TEXT).not.toContain("browser_open");
  });

  it("does not name discrete browser_* tool ids in computer_use guidance", async () => {
    const { formatComputerUseGuidance } = await import("../src/format.js");
    const text = formatComputerUseGuidance([
      "computer_use",
      "browser_open",
      "browser_act",
    ]);
    expect(text).toContain("list_windows");
    expect(text).toContain("Ladder:");
    expect(text).toContain("find");
    expect(text).not.toContain("browser_open");
  });

  it("forks escalation for text-only vs multimodal routes", async () => {
    const { formatComputerUseGuidance } = await import("../src/format.js");
    const textOnly = formatComputerUseGuidance(["computer_use"], {
      multimodal: false,
    });
    expect(textOnly).toContain("text-only");
    expect(textOnly).toMatch(/soft-degrade/i);
    expect(textOnly).not.toContain("browser_open");

    const multi = formatComputerUseGuidance(["computer_use"], {
      multimodal: true,
    });
    expect(multi).toContain("multimodal");
    expect(multi).toContain("vision/som");
  });

  it("UIA guidance scopes ladder away from agent-desktop-only verbs", async () => {
    const { formatComputerUseGuidance } = await import("../src/format.js");
    const text = formatComputerUseGuidance(["computer_use"], {
      delivery: "uia",
    });
    expect(text).toContain("delivery=uia");
    expect(text).toContain("Usual loop: list_windows → focus_window →");
    expect(text).not.toContain("focus_window or launch");
    expect(text).toMatch(/do not call launch/i);
    expect(text).toMatch(/Settings → Computer use → agent-desktop/);
  });

  it("memory find filters and reindexes for act", async () => {
    const { createMemoryComputerUseProvider } = await import("../src/memory.js");
    const { createComputerUseTools } = await import("../src/tools.js");
    const service = createMemoryComputerUseProvider({
      elements: [
        { index: 1, role: "button", name: "OK" },
        { index: 2, role: "textbox", name: "Search" },
        { index: 3, role: "button", name: "Cancel" },
      ],
    });
    const tools = createComputerUseTools({ service });
    const tool = tools[0]!;
    const found = await tool.execute(
      { action: "find", role: "button", name: "OK" },
      undefined,
    );
    expect(String(found.content)).toContain("[1]");
    expect(String(found.content)).toContain("OK");
    expect(String(found.content)).not.toContain("Search");
    const clicked = await tool.execute(
      { action: "click", element: 1 },
      undefined,
    );
    expect(String(clicked.content)).toMatch(/clicked/i);
  });
});

describe("formatCaptureEnvelope / formatActResult", () => {
  it("labels inline screenshot and next act step", async () => {
    const { formatActResult, formatCaptureEnvelope } = await import(
      "../src/format.js"
    );
    const text = formatCaptureEnvelope({
      snapshotText: "app: X\nwindow: Y\nmode: vision\nelements:\n  [1] [button] OK",
      mode: "vision",
      attachmentId: "sha256:abc",
      elementCount: 1,
    });
    expect(text).toContain("attachmentId=sha256:abc");
    expect(text).toContain("not a disk path");
    expect(text).toContain("next=click|type");

    const act = formatActResult({
      ok: true,
      action: "click",
      message: "clicked [1] OK",
      delivery: "memory",
    });
    expect(act).toContain("ok=true");
    expect(act).toContain("capture again");
    expect(act).not.toContain("background delivery");

    const bg = formatActResult({
      ok: true,
      action: "key",
      message: "background key",
      delivery: "background",
    });
    expect(bg).toContain("delivery=background");
    expect(bg).toContain("background delivery");
  });
});

describe("coordinate click", () => {
  it("rejects coordinate click without headed=true", async () => {
    const svc = createMemoryComputerUseProvider();
    const [tool] = createComputerUseTools({ service: svc });
    const result = await tool!.execute({
      action: "click",
      coordinate: [120, 80],
    });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toMatch(/headed=true|real mouse/i);
  });

  it("clicks screen pixels when headed=true", async () => {
    const svc = createMemoryComputerUseProvider();
    const [tool] = createComputerUseTools({ service: svc });
    const result = await tool!.execute({
      action: "click",
      coordinate: [120, 80],
      headed: true,
    });
    expect(result.isError).toBeFalsy();
    expect(String(result.content)).toContain("coordinate (120,80)");
    expect(String(result.content)).toContain("next=capture again");
  });
});
