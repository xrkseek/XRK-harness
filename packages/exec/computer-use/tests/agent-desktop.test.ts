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
  it("surfaces ok=false envelopes", async () => {
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
    ).rejects.toMatchObject({ message: /ref gone/ });
  });
});
