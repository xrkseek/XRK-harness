/**
 * Face session.checkpoint.* + /rollback (workspace shadow git).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import type { GitResult } from "@xrkseek/checkpoint";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  clearWorkspaceCheckpointStores,
  setWorkspaceCheckpointGitRunner,
} from "../src/workspace-checkpoint.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

function scriptedGit(calls: string[][]): (args: readonly string[]) => Promise<GitResult> {
  let i = 0;
  return async (args) => {
    calls.push([...args]);
    const joined = args.join(" ");
    if (joined.includes(" init ") || joined.endsWith(" init") || args.includes("init")) {
      i += 1;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("add")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("commit")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("rev-parse")) {
      return { code: 0, stdout: `deadbeef${String(i++).padStart(4, "0")}\n`, stderr: "" };
    }
    if (args.includes("ls-files")) {
      return { code: 0, stdout: "file.txt\n", stderr: "" };
    }
    if (args.includes("ls-tree")) {
      return { code: 0, stdout: "file.txt\n", stderr: "" };
    }
    if (args.includes("checkout")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("clean") && args.includes("-nd")) {
      return { code: 0, stdout: "Would remove scratch.txt\n", stderr: "" };
    }
    if (args.includes("clean")) {
      return { code: 0, stdout: "Removing scratch.txt\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
}

describe("session.checkpoint + /rollback", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-face-home-"));
    dirs.push(home);
    // Sandbox the checkpoint root so store construction never touches the
    // operator's real ~/.xrk (excludes-file mkdir happens even with a fake
    // git runner).
    vi.stubEnv("XRK_HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setWorkspaceCheckpointGitRunner(undefined);
    clearWorkspaceCheckpointStores();
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("snapshots, lists, plans, and restores via Face RPC", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-face-"));
    dirs.push(ws);
    const calls: string[][] = [];
    setWorkspaceCheckpointGitRunner(scriptedGit(calls));

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      workspaceRoot: ws,
      resolveAgent: admittingAgentResolve(store),
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const snap = await dispatchFaceMethod(
      runtime,
      "session.checkpoint.snapshot",
      "s1",
      { sessionId, seq: 0, label: "test" },
    );
    expect(snap.result.ok).toBe(true);
    if (!snap.result.ok) return;
    const id = (snap.result.value as { id: string }).id;
    expect(id).toMatch(/^deadbeef/);

    const listed = await dispatchFaceMethod(
      runtime,
      "session.checkpoint.list",
      "l1",
      { sessionId },
    );
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const items = (listed.result.value as { items: { id: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(id);
    }

    const plan = await dispatchFaceMethod(
      runtime,
      "session.checkpoint.planRestore",
      "p1",
      { sessionId, id },
    );
    expect(plan.result.ok).toBe(true);
    if (plan.result.ok) {
      const value = plan.result.value as { extra: string[]; fileCount: number };
      expect(value.fileCount).toBe(1);
      expect(value.extra).toContain("scratch.txt");
    }

    const restored = await dispatchFaceMethod(
      runtime,
      "session.checkpoint.restore",
      "r1",
      { sessionId, atSeq: 0 },
    );
    expect(restored.result.ok).toBe(true);
  });

  it("lists rollback in commands/list and executes /rollback", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-slash-"));
    dirs.push(ws);
    setWorkspaceCheckpointGitRunner(scriptedGit([]));

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      workspaceRoot: ws,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const listed = await dispatchFaceMethod(runtime, "commands/list", "l", {
      args: { agentId: sessionId },
    });
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const names = (listed.result.value as { name: string }[]).map((c) => c.name);
      expect(names).toContain("rollback");
    }

    await dispatchFaceMethod(runtime, "session.checkpoint.snapshot", "s", {
      sessionId,
      seq: 1,
    });

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/rollback" },
    });
    expect(exec.result.ok).toBe(true);
    if (exec.result.ok) {
      const text = (exec.result.value as { result: { text?: string } }).result
        ?.text;
      expect(text).toMatch(/Workspace checkpoints|No workspace checkpoints/i);
    }
  });

  it("restores via /rollback seq:N (message Restore button path)", async () => {
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-seq-"));
    dirs.push(ws);
    setWorkspaceCheckpointGitRunner(scriptedGit([]));

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      workspaceRoot: ws,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    await dispatchFaceMethod(runtime, "session.checkpoint.snapshot", "s", {
      sessionId,
      seq: 3,
      label: "pre-turn",
    });

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/rollback seq:17" },
    });
    expect(exec.result.ok).toBe(true);
    if (!exec.result.ok) return;
    const value = exec.result.value as {
      result: { kind: string; text?: string };
    };
    expect(value.result.kind).toBe("success");
    expect(value.result.text).toMatch(/Restored workspace from/i);
  });
});
