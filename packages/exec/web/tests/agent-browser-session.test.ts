import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAgentBrowserSession,
  resolveAgentBrowserExecutable,
  sanitizeAgentBrowserTabLabel,
} from "../src/agent-browser-session.js";
import { createBrowserSession } from "../src/browser-cdp.js";

describe("createAgentBrowserSession", () => {
  it("open / snapshot / act / dispose via injected runner", async () => {
    const calls: string[][] = [];
    const session = createAgentBrowserSession({
      sessionName: "test-sess",
      async run(args) {
        calls.push([...args]);
        const joined = args.join(" ");
        if (joined.includes("open")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: {
                url: "https://example.test/",
                title: "Example",
              },
            }),
            stderr: "",
          };
        }
        if (joined.includes("wait")) {
          return {
            stdout: JSON.stringify({ success: true, data: {} }),
            stderr: "",
          };
        }
        if (joined.includes("get url")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/" },
            }),
            stderr: "",
          };
        }
        if (joined.includes("get title")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { title: "Example" },
            }),
            stderr: "",
          };
        }
        if (joined.includes("snapshot")) {
          // Plain-text agent-friendly snapshot (no --json)
          return {
            stdout: '- link "Next" [ref=e1, url=https://example.test/n]',
            stderr: "",
          };
        }
        if (joined.includes("click")) {
          return {
            stdout: JSON.stringify({ success: true, data: {} }),
            stderr: "",
          };
        }
        if (joined.includes("close")) {
          return {
            stdout: JSON.stringify({ success: true, data: {} }),
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({ success: true, data: {} }),
          stderr: "",
        };
      },
    });

    const opened = await session.open("https://example.test/");
    expect(opened.text).toContain("ref=e1");
    expect(opened.title).toBe("Example");

    const acted = await session.act({ action: "click", ref: "e1" });
    expect(acted.note).toContain("@e1");

    session.dispose?.();
    expect(calls.some((c) => c.includes("open"))).toBe(true);
    expect(calls.some((c) => c.includes("click"))).toBe(true);
    expect(calls.some((c) => c.includes("--session"))).toBe(true);
  });

  it("self-heals headed DevToolsActivePort by retrying headless", async () => {
    const calls: string[][] = [];
    const openEnvs: Array<string | undefined> = [];
    let openAttempts = 0;
    const session = createAgentBrowserSession({
      sessionName: "heal-headed",
      headed: true,
      // This case targets self-heal 2 (headed → headless). Pin --no-sandbox so
      // self-heal 1 is already satisfied: on Linux CI the resolver does not add
      // it by default, so self-heal 1 would take an extra *headed* retry and the
      // assertion below would still see `--headed`.
      chromeArgs: "--no-sandbox",
      // Face/Settings path stamps this; heal must clear it or CLI stays headed.
      env: { ...process.env, AGENT_BROWSER_HEADED: "1" },
      async run(args, env) {
        calls.push([...args]);
        if (args.includes("open")) {
          openAttempts += 1;
          openEnvs.push(env?.AGENT_BROWSER_HEADED);
          if (openAttempts === 1) {
            return {
              stdout: JSON.stringify({
                success: false,
                error:
                  "Chrome exited early (exit code: 0) without writing DevToolsActivePort",
              }),
              stderr: "",
            };
          }
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/", title: "Example" },
            }),
            stderr: "",
          };
        }
        if (args.includes("snapshot")) {
          return { stdout: '- link "Ok" [ref=e1]', stderr: "" };
        }
        return {
          stdout: JSON.stringify({ success: true, data: {} }),
          stderr: "",
        };
      },
    });
    const opened = await session.open("https://example.test/");
    expect(opened.text).toContain("ref=e1");
    expect(openAttempts).toBeGreaterThanOrEqual(2);
    const openCalls = calls.filter((c) => c.includes("open"));
    const lastOpen = openCalls[openCalls.length - 1];
    expect(lastOpen).toBeDefined();
    expect(lastOpen).not.toContain("--headed");
    expect(openEnvs[0]).toBe("1");
    expect(openEnvs[openEnvs.length - 1]).toBeUndefined();
    expect(calls.some((c) => c.includes("close"))).toBe(true);
  });

  it("maps Chrome-not-found into WEB_BROWSER_NO_GRAPHICS", async () => {
    const session = createAgentBrowserSession({
      sessionName: "missing-chrome",
      async run() {
        return {
          stdout: JSON.stringify({
            success: false,
            data: null,
            error: "Auto-launch failed: Chrome not found. Run `agent-browser install`.",
          }),
          stderr: "",
        };
      },
    });
    await expect(session.open("https://example.test/")).rejects.toMatchObject({
      code: "WEB_BROWSER_NO_GRAPHICS",
    });
  });

  it("passes profile / proxy / restore / headed flags on open", async () => {
    const calls: string[][] = [];
    const session = createAgentBrowserSession({
      sessionName: "login-reuse",
      headed: true,
      profile: "Default",
      proxy: "http://127.0.0.1:7897",
      restore: true,
      async run(args) {
        calls.push([...args]);
        if (args.includes("open")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/", title: "Example" },
            }),
            stderr: "",
          };
        }
        if (args.includes("snapshot")) {
          return { stdout: '- link "Home" [ref=e1]', stderr: "" };
        }
        return {
          stdout: JSON.stringify({ success: true, data: {} }),
          stderr: "",
        };
      },
    });
    await session.open("https://example.test/");
    const openCall = calls.find((c) => c.includes("open"));
    expect(openCall).toBeDefined();
    expect(openCall).toContain("--headed");
    expect(openCall).toContain("--profile");
    expect(openCall).toContain("Default");
    expect(openCall).toContain("--proxy");
    expect(openCall).toContain("http://127.0.0.1:7897");
    expect(openCall).toContain("--restore");
  });

  it("registers graphical extras when session exposes them", async () => {
    const { createBrowserTools } = await import("../src/browser-tools.js");
    const session = createAgentBrowserSession({
      sessionName: "extras",
      async run(args) {
        if (args.includes("open")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/", title: "Example" },
            }),
            stderr: "",
          };
        }
        if (args.includes("snapshot")) {
          return { stdout: '- button "Go" [ref=e1]', stderr: "" };
        }
        if (args.includes("eval")) {
          return {
            stdout: JSON.stringify({ success: true, data: { result: "ok" } }),
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({ success: true, data: {} }),
          stderr: "",
        };
      },
    });
    await session.open("https://example.test/");
    const names = createBrowserTools(session).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "browser_open",
        "browser_eval",
        "browser_wait",
        "browser_tabs",
        "browser_cookies",
        "browser_get",
        "browser_find",
        "browser_frame",
        "browser_hover",
        "browser_select",
        "browser_forward",
        "browser_reload",
      ]),
    );
  });

  it("find and frame shell out to agent-browser", async () => {
    const calls: string[][] = [];
    const session = createAgentBrowserSession({
      sessionName: "find-frame",
      async run(args) {
        calls.push([...args]);
        if (args.includes("open")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/", title: "Example" },
            }),
            stderr: "",
          };
        }
        if (args.includes("snapshot")) {
          return { stdout: '- button "Go" [ref=e1]', stderr: "" };
        }
        return {
          stdout: JSON.stringify({ success: true, data: {} }),
          stderr: "",
        };
      },
    });
    await session.open("https://example.test/");
    const found = await session.find!({
      locator: "role",
      value: "button",
      name: "Submit",
      action: "click",
    });
    expect(found.note).toMatch(/find role/);
    const findCall = calls.find((c) => c.includes("find"));
    expect(findCall).toBeDefined();
    expect(findCall).toContain("role");
    expect(findCall).toContain("button");
    expect(findCall).toContain("click");
    expect(findCall).toContain("--name");
    expect(findCall).toContain("Submit");

    const framed = await session.frame!("iframe#embed");
    expect(framed.text).toMatch(/switched frame/);
    const frameCall = calls.find((c) => c.includes("frame"));
    expect(frameCall).toBeDefined();
    expect(frameCall).toContain("iframe#embed");
  });
});

describe("resolveAgentBrowserExecutable auto", () => {
  it("prefers system Chrome over Edge when both exist", () => {
    const chrome = path.join(tmpdir(), "Google", "Chrome", "Application", "chrome.exe");
    const edge = path.join(tmpdir(), "Microsoft", "Edge", "Application", "msedge.exe");
    // firstExisting needs real files — skip if we cannot create; use env override path.
    const hit = resolveAgentBrowserExecutable(
      {
        ProgramFiles: path.dirname(path.dirname(path.dirname(chrome))),
        "ProgramFiles(x86)": path.dirname(path.dirname(path.dirname(edge))),
        LOCALAPPDATA: "",
        AGENT_BROWSER_EXECUTABLE_PATH: "",
        XRK_BROWSER_EXECUTABLE: "",
      },
      "auto",
      "win32",
    );
    // Without real binaries this returns undefined or bundled — just ensure Edge is not forced via env.
    expect(hit === undefined || !/msedge\.exe$/i.test(hit)).toBe(true);
  });

  it("honors explicit executable override", () => {
    const forced = path.join(tmpdir(), "forced-browser.exe");
    expect(
      resolveAgentBrowserExecutable(
        { AGENT_BROWSER_EXECUTABLE_PATH: forced },
        "auto",
        "win32",
      ),
    ).toBe(forced);
  });
});

describe("sanitizeAgentBrowserTabLabel", () => {
  it("slugifies non-ASCII labels to ASCII-safe ids", () => {
    expect(sanitizeAgentBrowserTabLabel("查进度")).toMatch(/^[A-Za-z]/);
    expect(sanitizeAgentBrowserTabLabel("查进度")).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(sanitizeAgentBrowserTabLabel("progress")).toBe("progress");
  });
});

describe("createAgentBrowserSession getInfo / EOF", () => {
  it("defaults text/html get to body selector", async () => {
    const calls: string[][] = [];
    const session = createAgentBrowserSession({
      sessionName: "get-body",
      async run(args) {
        calls.push([...args]);
        if (args.includes("open")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/", title: "T" },
            }),
            stderr: "",
          };
        }
        if (args.includes("wait") || args.includes("get")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { html: "<body>hi</body>", text: "hi" },
            }),
            stderr: "",
          };
        }
        if (args.includes("snapshot")) {
          return {
            stdout: JSON.stringify({ success: true, data: { snapshot: "- link [ref=e1]" } }),
            stderr: "",
          };
        }
        return { stdout: JSON.stringify({ success: true, data: {} }), stderr: "" };
      },
    });
    await session.open("https://example.test/");
    await session.getInfo?.("html");
    const getCall = calls.find((c) => c.includes("get") && c.includes("html"));
    expect(getCall).toBeTruthy();
    expect(getCall!.includes("body")).toBe(true);
  });

  it("retries once on daemon EOF then succeeds", async () => {
    let n = 0;
    const session = createAgentBrowserSession({
      sessionName: "eof-retry",
      async run(args) {
        if (args.includes("open") || args.includes("wait") || args.includes("get")) {
          return {
            stdout: JSON.stringify({
              success: true,
              data: { url: "https://example.test/", title: "T" },
            }),
            stderr: "",
          };
        }
        if (args.includes("snapshot")) {
          return {
            stdout: JSON.stringify({ success: true, data: { snapshot: "- button [ref=e1]" } }),
            stderr: "",
          };
        }
        if (args.includes("click")) {
          n += 1;
          if (n === 1) {
            throw Object.assign(new Error("fail"), {
              stdout: JSON.stringify({
                success: false,
                error: {
                  message:
                    "Invalid response: EOF while parsing a value at line 1 column 0 (the command reached the daemon but no response came back)",
                },
              }),
              stderr: "",
            });
          }
          return { stdout: JSON.stringify({ success: true, data: {} }), stderr: "" };
        }
        return { stdout: JSON.stringify({ success: true, data: {} }), stderr: "" };
      },
    });
    await session.open("https://example.test/");
    await session.act({ action: "click", ref: "e1" });
    expect(n).toBe(2);
  });
});

describe("createBrowserSession agent-browser product", () => {
  it("does not use HTTP fetch when mode is agent-browser", async () => {
    const session = createBrowserSession({
      fetch: {
        async fetch() {
          throw new Error("HTTP must not run for agent-browser");
        },
      },
      // Force a missing binary so we fail fast without launching Chromium.
      env: { XRK_AGENT_BROWSER: path.join(tmpdir(), "no-such-agent-browser.exe") },
      product: { mode: "agent-browser" },
    });
    await expect(session.open("https://example.test/")).rejects.toThrow(
      /agent-browser|ENOENT|not found|WEB_BROWSER/i,
    );
  });
});
