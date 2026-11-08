import { describe, expect, it } from "vitest";
import { createAgentDesktopProvider } from "../src/agent-desktop.js";

/** Unit tests mock CLI argv; disable durable session so mocks need not handle `session start`. */
const testOpts = { enableSession: false as const, cursorOverlay: false as const };

const SNAPSHOT_TREE = {
  role: "window",
  name: "Demo",
  bounds: { x: 100, y: 200, width: 800, height: 600 },
  children: [
    {
      role: "button",
      name: "OK",
      ref_id: "@s1:e1",
      bounds: { x: 120, y: 220, width: 40, height: 20 },
    },
  ],
};

/** 1x1 PNG bytes — the provider never decodes pixels, only sizes them. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface Recorded {
  readonly calls: string[][];
}

function mockCli(overrides?: {
  readonly screenshot?: Record<string, unknown>;
}): Recorded & {
  run: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
} {
  const calls: string[][] = [];
  const envelope = (command: string, data: unknown) =>
    JSON.stringify({ version: "2.6", ok: true, command, data });

  return {
    calls,
    async run(args) {
      calls.push([...args]);
      // headedArgs() prefixes `--headed` before the subcommand.
      const command = args[0] === "--headed" ? args[1] : args[0];
      switch (command) {
        case "snapshot":
          return {
            stdout: envelope("snapshot", {
              app: "Demo",
              snapshot_id: "s1",
              complete: true,
              ref_count: 1,
              tree: SNAPSHOT_TREE,
            }),
            stderr: "",
          };
        case "screenshot":
          return {
            stdout: envelope("screenshot", {
              format: "png",
              data: PNG_B64,
              width: 780,
              height: 580,
              scale_factor: 1.5,
              ...overrides?.screenshot,
            }),
            stderr: "",
          };
        case "focus-window":
          return { stdout: envelope("focus-window", { focused: { title: "Demo" } }), stderr: "" };
        case "mouse-click":
        case "mouse-move":
        case "hover":
          return { stdout: envelope(command, { action: command }), stderr: "" };
        default:
          throw new Error(`unexpected ${args.join(" ")}`);
      }
    },
  };
}

describe("capture geometry", () => {
  it("returns the window frame and the screenshot inset", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    const cap = await svc.capture({ app: "Demo", mode: "vision" });

    expect(cap.frame).toEqual({ x: 100, y: 200, width: 800, height: 600 });
    // 800-780 = 20 split evenly → 10; 600-580 = 20 hangs from the top.
    expect(cap.screenshot).toEqual({
      width: 780,
      height: 580,
      scaleFactor: 1.5,
      offsetX: 10,
      offsetY: 20,
    });
    expect(cap.text).toContain("frame: origin=100,200 size=800x600");
    expect(cap.text).toContain("screenshot: 780x580 inset=10,20 scale=1.5");
  });

  it("omits geometry for mode=ax (no screenshot)", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    const cap = await svc.capture({ app: "Demo", mode: "ax" });

    expect(cap.frame).toEqual({ x: 100, y: 200, width: 800, height: 600 });
    expect(cap.screenshot).toBeUndefined();
    expect(cap.screenshotPng).toBeUndefined();
  });
});

describe("coordinate conversion", () => {
  it("adds frame origin + client inset for coordinateSpace=window", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    await svc.capture({ app: "Demo", mode: "vision" });
    const result = await svc.act({
      action: "click",
      coordinate: [50, 60],
      headed: true,
    });

    const clickCall = cli.calls.find((c) => c.includes("mouse-click"));
    expect(clickCall).toBeDefined();
    // 100 + 10 + 50 = 160, 200 + 20 + 60 = 280
    expect(clickCall).toContain("160,280");
    expect(result.message).toContain("160,280");
    // Injected runners never touch the real desktop, so no cursor round-trip.
    expect(result.message).not.toContain("cursor-restored");
  });

  it("passes screen coordinates through untouched", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    await svc.capture({ app: "Demo", mode: "vision" });
    await svc.act({
      action: "click",
      coordinate: [500, 400],
      coordinateSpace: "screen",
      headed: true,
    });

    const clickCall = cli.calls.find((c) => c.includes("mouse-click"));
    expect(clickCall).toContain("500,400");
  });

  it("fetches a frame on a cold provider instead of failing", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    // No capture first: the provider must snapshot for the frame.
    const result = await svc.act({
      action: "click",
      app: "Demo",
      coordinate: [5, 6],
      headed: true,
    });

    expect(cli.calls.some((c) => c[0] === "snapshot")).toBe(true);
    const clickCall = cli.calls.find((c) => c.includes("mouse-click"));
    // No screenshot yet → inset 0 → 100+5, 200+6
    expect(clickCall).toContain("105,206");
    expect(result.message).toContain("105,206");
  });

  it("refuses a window-space click when no frame can be resolved", async () => {
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run() {
        throw new Error("app not found");
      },
    });

    await expect(
      svc.act({ action: "click", coordinate: [1, 2], headed: true }),
    ).rejects.toThrow(/could not resolve a window frame/);
  });
});

describe("focus_window target routing", () => {
  it("routes a CJK app label through --title", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    const result = await svc.act({ action: "focus_window", app: "微信" });

    const call = cli.calls.find((c) => c[0] === "focus-window");
    expect(call).toEqual(["focus-window", "--title", "微信"]);
    expect(result.message).toBe("focused:title:微信");
  });

  it("routes a process identity through --app", async () => {
    const cli = mockCli();
    const svc = createAgentDesktopProvider({ ...testOpts, run: cli.run });

    const result = await svc.act({ action: "focus_window", app: "Weixin.exe" });

    const call = cli.calls.find((c) => c[0] === "focus-window");
    expect(call).toEqual(["focus-window", "--app", "Weixin.exe"]);
    expect(result.message).toBe("focused:app:Weixin.exe");
  });

  it("falls back to --app when the title reading fails", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        calls.push([...args]);
        if (args[0] === "focus-window" && args.includes("--title")) {
          throw new Error("No matching window found");
        }
        return {
          stdout: JSON.stringify({ ok: true, command: "focus-window", data: {} }),
          stderr: "",
        };
      },
    });

    const result = await svc.act({ action: "focus_window", app: "微信" });

    expect(calls.filter((c) => c[0] === "focus-window")).toEqual([
      ["focus-window", "--title", "微信"],
      ["focus-window", "--app", "微信"],
    ]);
    expect(result.message).toBe("focused:app:微信");
  });
});
