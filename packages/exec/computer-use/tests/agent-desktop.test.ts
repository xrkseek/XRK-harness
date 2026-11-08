import { describe, expect, it } from "vitest";
import {
  createAgentDesktopProvider,
  runAgentDesktop,
} from "../src/agent-desktop.js";

/** Unit tests mock CLI argv; disable durable session so mocks need not handle `session start`. */
const testOpts = { enableSession: false as const, cursorOverlay: false as const };

describe("createAgentDesktopProvider", () => {
  it("parses list-windows array data (v1.x)", async () => {
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        if (args[0] === "list-windows") {
          return {
            stdout: JSON.stringify({
              version: "2.6",
              ok: true,
              command: "list-windows",
              data: [
                {
                  title: "Notepad",
                  pid: 42,
                  app_name: "notepad.exe",
                },
              ],
            }),
            stderr: "",
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    const windows = await svc.listWindows();
    expect(windows).toEqual([
      { title: "Notepad", pid: 42, app: "notepad.exe" },
    ]);
  });

  it("keeps snapshot-qualified refs and clicks them", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        calls.push([...args]);
        if (args[0] === "snapshot") {
          return {
            stdout: JSON.stringify({
              ok: true,
              command: "snapshot",
              data: {
                app: "Demo",
                snapshot_id: "s1",
                tree: {
                  children: [
                    {
                      role: "button",
                      name: "OK",
                      ref_id: "@s1:e1",
                      bounds: { x: 1, y: 2, width: 3, height: 4 },
                    },
                  ],
                },
              },
            }),
            stderr: "",
          };
        }
        if (args[0] === "click") {
          return {
            stdout: JSON.stringify({ ok: true, command: "click", data: {} }),
            stderr: "",
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    const snap = await svc.capture({ mode: "ax" });
    expect(snap.elements[0]?.elementToken).toBe("@s1:e1");
    expect(snap.elements[0]?.bounds).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    await svc.act({ action: "click", element: 1 });
    expect(calls.some((c) => c[0] === "click" && c[1] === "@s1:e1")).toBe(
      true,
    );
  });

  it("decodes screenshot data.data base64 for vision", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        if (args[0] === "snapshot") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: { app: "Demo", snapshot_id: "s1", tree: { children: [] } },
            }),
            stderr: "",
          };
        }
        if (args[0] === "screenshot") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                data: png.toString("base64"),
                format: "png",
                width: 1,
                height: 1,
              },
            }),
            stderr: "",
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    const snap = await svc.capture({ mode: "vision" });
    expect(snap.screenshotPng).toEqual(Uint8Array.from(png));
  });
});

describe("runAgentDesktop", () => {
  it("surfaces ok=false envelopes with STALE_REF hint", async () => {
    await expect(
      runAgentDesktop(["click", "@s1:e1"], {
        async run() {
          return {
            stdout: JSON.stringify({
              ok: false,
              error: { code: "STALE_REF", message: "ref gone" },
            }),
            stderr: "",
          };
        },
      }),
    ).rejects.toMatchObject({
      message: /ref gone.*Capture again/i,
      code: "COMPUTER_USE_STALE_ELEMENT",
    });
  });
});

describe("agent-desktop headed + clipboard", () => {
  it("rejects coordinate click without headed=true", async () => {
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run() {
        throw new Error("should not run CLI");
      },
    });
    await expect(
      svc.act({ action: "click", coordinate: [10, 20] }),
    ).rejects.toMatchObject({ code: "COMPUTER_USE_BAD_ARGS" });
  });

  it("uses clipboard-set + ctrl+v for CJK type", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        calls.push([...args]);
        if (args[0] === "snapshot") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                app: "Demo",
                snapshot_id: "s1",
                tree: {
                  children: [
                    { role: "textbox", name: "In", ref_id: "@s1:e1" },
                  ],
                },
              },
            }),
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({ ok: true, command: args[0], data: {} }),
          stderr: "",
        };
      },
    });
    await svc.capture({ mode: "ax" });
    const result = await svc.act({ action: "type", element: 1, text: "测试" });
    expect(result.message).toContain("clipboard");
    expect(calls.some((c) => c[0] === "clipboard-set" && c[1] === "测试")).toBe(
      true,
    );
    expect(calls.some((c) => c[0] === "press" && c[1] === "ctrl+v")).toBe(true);
  });

  it("notes hollow AX trees", async () => {
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        if (args[0] === "snapshot") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                app: "Weixin",
                snapshot_id: "s1",
                tree: {
                  children: [
                    { role: "pane", name: "Weixin", ref_id: "@s1:e1" },
                    { role: "pane", name: "Sub", ref_id: "@s1:e2" },
                  ],
                },
              },
            }),
            stderr: "",
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    const snap = await svc.capture({ mode: "ax" });
    expect(snap.note).toMatch(/hollow/i);
  });

  it("find maps matches into act indices", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        calls.push([...args]);
        if (args[0] === "find") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                snapshot_id: "sx",
                total_matches: 2,
                truncated: false,
                matches: [
                  {
                    role: "button",
                    name: "Send",
                    ref_id: "@sx:e9",
                  },
                  {
                    role: "button",
                    name: "Cancel",
                    ref_id: "@sx:e10",
                  },
                ],
              },
            }),
            stderr: "",
          };
        }
        if (args[0] === "click") {
          return {
            stdout: JSON.stringify({ ok: true, data: {} }),
            stderr: "",
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    const snap = await svc.find!({ role: "button", name: "Send", limit: 5 });
    expect(snap.elements).toHaveLength(2);
    expect(snap.elements[0]?.index).toBe(1);
    expect(snap.elements[0]?.elementToken).toBe("@sx:e9");
    expect(snap.note).toMatch(/find/i);
    expect(calls[0]?.[0]).toBe("find");
    expect(calls[0]).toContain("--role");
    expect(calls[0]).toContain("button");
    const clicked = await svc.act({ action: "click", element: 1 });
    expect(clicked.ok).toBe(true);
    expect(calls.some((c) => c[0] === "click" && c[1] === "@sx:e9")).toBe(true);
  });

  it("starts a CLI session with --cursor and scopes later calls", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      enableSession: true,
      cursorOverlay: true,
      async run(args) {
        calls.push([...args]);
        if (args[0] === "session" && args[1] === "start") {
          expect(args).toContain("--cursor");
          return {
            stdout: JSON.stringify({
              ok: true,
              data: { session_id: "sess-test-1" },
            }),
            stderr: "",
          };
        }
        if (args.includes("list-windows") || args[0] === "list-windows") {
          return {
            stdout: JSON.stringify({ ok: true, data: [] }),
            stderr: "",
          };
        }
        if (args.includes("focus-window") || args[0] === "focus-window") {
          return {
            stdout: JSON.stringify({ ok: true, data: {} }),
            stderr: "",
          };
        }
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    await svc.listWindows();
    expect(calls[0]?.[0]).toBe("session");
    expect(calls[0]).toContain("--cursor");
    const listCall = calls.find((c) => c.includes("list-windows"));
    expect(listCall).toBeTruthy();
    expect(listCall).toContain("--session");
    expect(listCall).toContain("sess-test-1");
    await svc.act({ action: "focus_window", app: "Weixin" });
    const focusCall = calls.find((c) => c.includes("focus-window"));
    expect(focusCall).toContain("--session");
    expect(focusCall).toContain("Weixin");
  });

  it("maps launch / wait / overlay onto CLI argv", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        calls.push([...args]);
        return {
          stdout: JSON.stringify({ ok: true, data: {} }),
          stderr: "",
        };
      },
    });
    await svc.act({ action: "launch", app: "notepad.exe", predicate: "activate" });
    expect(
      calls.some((c) => c[0] === "launch" && c.includes("--activate")),
    ).toBe(true);
    await svc.act({ action: "wait", amount: 200 });
    const waitCall = calls.find((c) => c[0] === "wait");
    expect(waitCall).toBeTruthy();
    expect(waitCall?.[1]).toBe("200");
    expect(waitCall).not.toContain("--time");
    await svc.act({ action: "overlay", label: "sending" });
    expect(
      calls.some(
        (c) =>
          c[0] === "cursor-overlay" &&
          c[1] === "enable" &&
          c.includes("sending"),
      ),
    ).toBe(true);
  });

  it("uses --property for get/is and correct window/drag flags", async () => {
    const calls: string[][] = [];
    const svc = createAgentDesktopProvider({
      ...testOpts,
      async run(args) {
        calls.push([...args]);
        if (args[0] === "snapshot") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                app: "Demo",
                snapshot_id: "s1",
                tree: {
                  children: [
                    { role: "button", name: "A", ref_id: "@s1:e1" },
                    { role: "button", name: "B", ref_id: "@s1:e2" },
                  ],
                },
              },
            }),
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({ ok: true, data: { ok: true } }),
          stderr: "",
        };
      },
    });
    await svc.capture({ mode: "ax" });
    await svc.act({ action: "get", element: 1, property: "bounds" });
    expect(
      calls.some(
        (c) =>
          c[0] === "get" &&
          c.includes("@s1:e1") &&
          c.includes("--property") &&
          c.includes("bounds"),
      ),
    ).toBe(true);
    await svc.act({ action: "is", element: 1, property: "enabled" });
    expect(
      calls.some(
        (c) =>
          c[0] === "is" &&
          c.includes("--property") &&
          c.includes("enabled"),
      ),
    ).toBe(true);
    await svc.act({
      action: "resize_window",
      app: "Demo",
      coordinate: [800, 600],
    });
    expect(
      calls.some(
        (c) =>
          c[0] === "resize-window" &&
          c.includes("--width") &&
          c.includes("800") &&
          c.includes("--height") &&
          c.includes("600"),
      ),
    ).toBe(true);
    await svc.act({
      action: "move_window",
      app: "Demo",
      coordinate: [10, 20],
    });
    expect(
      calls.some(
        (c) =>
          c[0] === "move-window" &&
          c.includes("--x") &&
          c.includes("10") &&
          c.includes("--y") &&
          c.includes("20"),
      ),
    ).toBe(true);
    await svc.act({
      action: "drag",
      element: 1,
      amount: 2,
      headed: true,
    });
    expect(
      calls.some(
        (c) =>
          c.includes("drag") &&
          c.includes("--from") &&
          c.includes("@s1:e1") &&
          c.includes("--to") &&
          c.includes("@s1:e2") &&
          c.includes("--headed"),
      ),
    ).toBe(true);
    await svc.act({
      action: "mouse_wheel",
      coordinate: [100, 200],
      amount: -5,
      headed: true,
    });
    expect(
      calls.some(
        (c) =>
          c.includes("mouse-wheel") &&
          c.includes("--dy") &&
          c.includes("-5") &&
          c.includes("--headed"),
      ),
    ).toBe(true);
    await svc.act({ action: "open_system_surface", text: "start-menu" });
    expect(
      calls.some(
        (c) =>
          c[0] === "open-system-surface" &&
          c.includes("--surface") &&
          c.includes("start-menu"),
      ),
    ).toBe(true);
  });
});
