import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createBashTerminalBackend } from "../src/backend.js";
import { defaultPtyBackendConfig } from "../src/config.js";
import { resolvePtyCwd } from "../src/cwd.js";
import { TerminalError } from "../src/types.js";

describe("resolvePtyCwd", () => {
  it("accepts the workspace root itself", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-pty-root-"));
    expect(resolvePtyCwd(root, root)).toBe(path.resolve(root));
  });

  it("rejects a sibling project when the jail root is Host-wide", () => {
    const hostRoot = mkdtempSync(path.join(tmpdir(), "xrk-pty-host-"));
    const project = mkdtempSync(path.join(tmpdir(), "xrk-pty-proj-"));
    expect(() => resolvePtyCwd(hostRoot, project)).toThrow(TerminalError);
  });
});

describe("createBashTerminalBackend resolveWorkspaceRoot", () => {
  it("jails cwd against the per-session root before spawn", async () => {
    const hostRoot = mkdtempSync(path.join(tmpdir(), "xrk-pty-host-"));
    const sessionRoot = mkdtempSync(path.join(tmpdir(), "xrk-pty-sess-"));
    let resolvedFor: string | undefined;
    const backend = createBashTerminalBackend({
      config: defaultPtyBackendConfig({}),
      workspaceRoot: hostRoot,
      resolveWorkspaceRoot: (ownerSessionId) => {
        resolvedFor = ownerSessionId;
        return ownerSessionId === "sess-a" ? sessionRoot : hostRoot;
      },
      spawnTerminal: async () => {
        throw new Error("spawnTerminal must not run when cwd escapes");
      },
    });

    await expect(
      backend.spawn({
        sessionId: "pty-1",
        cwd: sessionRoot,
        ownerSessionId: "sess-other",
      }),
    ).rejects.toThrow(/resolves outside the workspace/);
    expect(resolvedFor).toBe("sess-other");

    // Matching session root: jail passes; spawnTerminal is reached.
    let spawnedCwd: string | undefined;
    const okBackend = createBashTerminalBackend({
      config: defaultPtyBackendConfig({}),
      workspaceRoot: hostRoot,
      resolveWorkspaceRoot: (ownerSessionId) =>
        ownerSessionId === "sess-a" ? sessionRoot : hostRoot,
      spawnTerminal: async (req) => {
        spawnedCwd = req.cwd;
        throw new Error("probe-after-jail");
      },
    });
    await expect(
      okBackend.spawn({
        sessionId: "pty-2",
        cwd: sessionRoot,
        ownerSessionId: "sess-a",
      }),
    ).rejects.toThrow(/probe-after-jail/);
    expect(spawnedCwd).toBe(path.resolve(sessionRoot));
  });
});
