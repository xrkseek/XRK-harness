import { describe, expect, it } from "vitest";
import {
  createAgentDesktopProvider,
  runAgentDesktop,
} from "../src/agent-desktop.js";

describe("createAgentDesktopProvider", () => {
  it("parses list-windows array data (v1.x)", async () => {
    const svc = createAgentDesktopProvider({
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
});
