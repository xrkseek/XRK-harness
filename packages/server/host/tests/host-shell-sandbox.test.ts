import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { SandboxDenyError } from "@xrkseek/exec-sandbox";
import { createHostShellPrepareArgv } from "../src/index.js";

/**
 * P0-3 regression: the Host-wide shared shell must confine bash argv through
 * the sandbox stack (the harness preset's `sharedShell ?? createLocalShell`
 * branch skips its own confident prepareArgv when a shared shell is passed).
 * The prepareArgv resolves per-session sandboxMode lazily — danger-full-access
 * unlocks, any other mode confines, and no ownerSessionId falls back to the
 * default workspace-write posture.
 */
describe("createHostShellPrepareArgv", () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "xrk-sb-"));

  const make = (overrides: {
    mode?: (sessionId?: string) => "workspace-write" | "danger-full-access";
    settings?: Record<string, unknown>;
  } = {}) =>
    createHostShellPrepareArgv({
      workspaceRoot,
      readSandboxSettings: () => overrides.settings,
      readSandboxMode:
        overrides.mode ??
        (() => "workspace-write" as "workspace-write" | "danger-full-access"),
      remoteExecution: false,
      env: {},
    });

  it("confines workspace-write bash through the deny list", async () => {
    const prepare = make();
    await expect(
      prepare(["bash", "-lc", "rm -rf /"], workspaceRoot, undefined, {}),
    ).rejects.toThrow(SandboxDenyError);
  });

  it("keeps benign argv unchanged under workspace-write", async () => {
    const prepare = make();
    const argv = ["bash", "-lc", "echo hi"];
    const out = await prepare(argv, workspaceRoot, undefined, {});
    expect(out).toEqual(argv);
  });

  it("unlocks bash entirely for danger-full-access", async () => {
    const prepare = make({
      mode: () => "danger-full-access",
    });
    const argv = ["bash", "-lc", "rm -rf /"];
    // Not confined: deny list must NOT trigger.
    const out = await prepare(argv, workspaceRoot, undefined, {
      ownerSessionId: "sess-danger",
    });
    expect(out).toEqual(argv);
  });

  it("falls back to workspace-write when no ownerSessionId is given", async () => {
    const prepare = make();
    await expect(
      prepare(["bash", "-lc", "rm -rf /"], workspaceRoot, undefined, undefined),
    ).rejects.toThrow(SandboxDenyError);
  });

  it("per-session danger-full-access does not leak into other sessions", async () => {
    const prepare = make({
      mode: (sessionId) =>
        sessionId === "sess-danger" ? "danger-full-access" : "workspace-write",
    });
    // First call (no session) confines.
    await expect(
      prepare(["bash", "-lc", "rm -rf /"], workspaceRoot, undefined, undefined),
    ).rejects.toThrow(SandboxDenyError);
    // A danger session unlocks…
    const argv = ["bash", "-lc", "rm -rf /"];
    await expect(
      prepare(argv, workspaceRoot, undefined, {
        ownerSessionId: "sess-danger",
      }),
    ).resolves.toEqual(argv);
    // …and a normal session still confines.
    await expect(
      prepare(["bash", "-lc", "rm -rf /"], workspaceRoot, undefined, {
        ownerSessionId: "sess-normal",
      }),
    ).rejects.toThrow(SandboxDenyError);
  });

  it("re-resolves the stack when Face sandbox settings change", async () => {
    let settings: Record<string, unknown> | undefined;
    const prepare = createHostShellPrepareArgv({
      workspaceRoot,
      readSandboxSettings: () => settings,
      readSandboxMode: () => "workspace-write",
      remoteExecution: false,
      env: {},
    });
    // Default backend = workspace; benign argv passes.
    const argv = ["bash", "-lc", "echo hi"];
    await expect(
      prepare(argv, workspaceRoot, undefined, {}),
    ).resolves.toEqual(argv);
    // Switch to docker without an image → stack construction throws loudly.
    settings = { backend: "docker" };
    await expect(
      prepare(argv, workspaceRoot, undefined, {}),
    ).rejects.toThrow(/docker sandbox requires/);
  });
});