import { describe, expect, it, vi } from "vitest";
import type {
  SubprocessHandle,
  SubprocessResult,
  SubprocessService,
} from "@xrkseek/exec-subprocess";
import {
  createFsSshProvider,
  createSshSession,
  createSshSubprocess,
  listSshDirectory,
  createSshDirectory,
  normalizeRemoteAbs,
  resolveSshConfigFromEnv,
  resolveWithinRemoteRoot,
  shQuote,
} from "../src/index.js";

function ok(stdout = "", stderr = ""): SubprocessResult {
  return {
    stdout,
    stderr,
    exitCode: 0,
    signal: null,
    killed: false,
  };
}

function mockLocal(
  handler: (argv: readonly string[]) => Promise<SubprocessResult>,
): SubprocessService {
  return {
    async spawn(argv) {
      return handler(argv);
    },
    start(argv): SubprocessHandle {
      const p = handler(argv);
      return {
        kill() {},
        result: () => p,
      };
    },
  };
}

describe("resolveSshConfigFromEnv", () => {
  it("requires host and absolute workspace", () => {
    expect(resolveSshConfigFromEnv({})).toBeUndefined();
    expect(
      resolveSshConfigFromEnv({
        XRK_SSH_HOST: "box",
        XRK_SSH_WORKSPACE: "/work",
      }),
    ).toEqual({ host: "box", workspace: "/work" });
    expect(() =>
      resolveSshConfigFromEnv({
        XRK_SSH_HOST: "box",
        XRK_SSH_WORKSPACE: "relative",
      }),
    ).toThrow(/absolute/);
  });
});

describe("remote paths", () => {
  it("jails under workspace", () => {
    expect(normalizeRemoteAbs("/a/b/")).toBe("/a/b");
    expect(resolveWithinRemoteRoot("/work", "src/a.ts")).toBe("/work/src/a.ts");
    expect(resolveWithinRemoteRoot("/work", "/work/x")).toBe("/work/x");
    expect(() => resolveWithinRemoteRoot("/work", "/etc/passwd")).toThrow(
      /escapes/,
    );
  });
});

describe("createSshSession", () => {
  it("wraps remote commands with BatchMode ssh", async () => {
    const seen: string[][] = [];
    const local = mockLocal(async (argv) => {
      seen.push([...argv]);
      return ok("hi");
    });
    const session = createSshSession({
      config: { host: "dev", workspace: "/repo", user: "me", port: 2222 },
      local,
      platform: "win32",
    });
    const r = await session.exec("echo hi");
    expect(r.stdout).toBe("hi");
    expect(seen[0]?.[0]).toBe("ssh");
    expect(seen[0]).toContain("BatchMode=yes");
    expect(seen[0]).toContain("-p");
    expect(seen[0]).toContain("2222");
    expect(seen[0]).toContain("me@dev");
    const remote = seen[0]?.[seen[0].length - 1] ?? "";
    expect(remote).toContain("cd '/repo'");
    expect(remote).toContain(shQuote("echo hi"));
  });
});

describe("createSshSubprocess", () => {
  it("quotes argv for remote bash", async () => {
    const seen: string[] = [];
    const local = mockLocal(async (argv) => {
      seen.push(argv[argv.length - 1]!);
      return ok("ok");
    });
    const session = createSshSession({
      config: { host: "h", workspace: "/w" },
      local,
      platform: "win32",
    });
    await createSshSubprocess(session).spawn(["printf", "%s", "a b"]);
    expect(seen[0]).toContain("'printf'");
    expect(seen[0]).toContain("'a b'");
  });
});

describe("createFsSshProvider", () => {
  it("reads via remote python base64", async () => {
    const payload = Buffer.from("hello", "utf8").toString("base64");
    const local = mockLocal(async (argv) => {
      const remote = argv[argv.length - 1]!;
      if (remote.includes("base64.b64encode") && remote.includes("open(p")) {
        return ok(`0${payload}`);
      }
      return ok();
    });
    const session = createSshSession({
      config: { host: "h", workspace: "/w" },
      local,
      platform: "win32",
    });
    const fs = createFsSshProvider({ session });
    const r = await fs.read("a.txt");
    expect(r.content).toBe("hello");
  });

  it("rejects path escape", async () => {
    const session = createSshSession({
      config: { host: "h", workspace: "/w" },
      local: mockLocal(async () => ok()),
      platform: "win32",
    });
    const fs = createFsSshProvider({ session });
    await expect(fs.read("/etc/passwd")).rejects.toThrow(/escapes/);
  });
});

describe("shQuote", () => {
  it("escapes single quotes", () => {
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe("listSshDirectory / createSshDirectory", () => {
  it("lists child dirs under remote root via python", async () => {
    const local = mockLocal(async (argv) => {
      const remote = argv[argv.length - 1] ?? "";
      if (remote.includes("os.listdir")) {
        return ok(JSON.stringify(["src", ".hidden", "pkg"]));
      }
      return ok();
    });
    const session = createSshSession({
      config: { host: "box", workspace: "/work" },
      local,
      platform: "linux",
    });
    const listed = await listSshDirectory(session, "/work");
    expect(listed.path).toBe("/work");
    expect(listed.home).toBe("/work");
    expect(listed.entries.map((e) => e.name)).toEqual([
      "src",
      ".hidden",
      "pkg",
    ]);
    expect(listed.entries.find((e) => e.name === ".hidden")?.hidden).toBe(true);
    expect(listed.crumbs.at(-1)?.path).toBe("/work");
  });

  it("rejects paths outside workspace", async () => {
    const session = createSshSession({
      config: { host: "box", workspace: "/work" },
      local: mockLocal(async () => ok()),
      platform: "linux",
    });
    await expect(listSshDirectory(session, "/work", "/etc")).rejects.toThrow(
      /outside remote workspace/,
    );
  });

  it("creates a child directory under parent", async () => {
    const seen: string[] = [];
    const local = mockLocal(async (argv) => {
      seen.push(argv[argv.length - 1] ?? "");
      return ok();
    });
    const session = createSshSession({
      config: { host: "box", workspace: "/work" },
      local,
      platform: "linux",
    });
    const created = await createSshDirectory(
      session,
      "/work",
      "/work/src",
      "new-box",
    );
    expect(created.path).toBe("/work/src/new-box");
    expect(seen.some((c) => c.includes("os.mkdir"))).toBe(true);
  });
});

// silence unused vi in case of future spies
void vi;
