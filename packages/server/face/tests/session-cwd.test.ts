import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentHandle } from "@xrkseek/core-agent";
import { createMemorySessionStore } from "@xrkseek/core-session";
import type { FaceDrain } from "../src/context.js";
import { createFaceRuntime } from "../src/runtime.js";
import {
  ensureSessionWorkingDirectory,
  resolveSessionCwd,
  setSessionWorkingDirectory,
} from "../src/session-cwd.js";

function stubAgent(): AgentHandle {
  return {
    admit() {
      return {
        admitId: "a",
        sessionId: "s",
        content: [],
        delivery: "queue",
      };
    },
    pendingAdmits() {
      return [];
    },
    abort() {},
    isBusy() {
      return false;
    },
    setApprovalHandler() {},
    async continueTurn() {
      return { text: "", events: [] };
    },
    async run() {
      return { text: "", events: [] };
    },
  } as AgentHandle;
}

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function runtimeAt(root: string) {
  const productDir = mkdtempSync(path.join(tmpdir(), "xrk-cwd-prod-"));
  const store = createMemorySessionStore();
  const runtime = createFaceRuntime({
    store,
    workspaceRoot: root,
    productDir,
    drain: drain(),
    resolveAgent: async () => stubAgent(),
  });
  const sessionId = runtime.ensureSession("s1");
  runtime.sessionCwds.set(sessionId, root);
  return { runtime, store, sessionId, productDir };
}

describe("session working directory", () => {
  it("set appends working-directory/change and updates sessionCwds", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-cwd-root-"));
    const nested = path.join(root, "nested");
    mkdirSync(nested, { recursive: true });
    const { runtime, store, sessionId, productDir } = runtimeAt(root);

    const out = await setSessionWorkingDirectory(runtime, sessionId, nested);
    expect(out).toEqual({ ok: true, cwd: path.resolve(nested), changed: true });
    expect(resolveSessionCwd(runtime, sessionId)).toBe(path.resolve(nested));
    const events = store.get(sessionId).events;
    expect(events.some((e) => e.type === "working-directory/change")).toBe(true);
    const change = events.find((e) => e.type === "working-directory/change");
    expect(change && "cwd" in change ? change.cwd : undefined).toBe(
      path.resolve(nested),
    );

    rmSync(productDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("ensure recovers when mapped worktree path vanishes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-cwd-wt-"));
    const wt = path.join(root, "wt");
    mkdirSync(wt, { recursive: true });
    const { runtime, sessionId, productDir } = runtimeAt(root);
    await setSessionWorkingDirectory(runtime, sessionId, wt);
    expect(resolveSessionCwd(runtime, sessionId)).toBe(path.resolve(wt));
    rmSync(wt, { recursive: true, force: true });
    const ensured = await ensureSessionWorkingDirectory(runtime, sessionId);
    expect(ensured.ok).toBe(true);
    if (ensured.ok) {
      expect(ensured.changed).toBe(true);
      expect(ensured.cwd).toBe(path.resolve(root));
    }
    rmSync(productDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("serializes concurrent set calls for one session", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-cwd-serial-"));
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const { runtime, sessionId, productDir } = runtimeAt(root);

    const [ra, rb] = await Promise.all([
      setSessionWorkingDirectory(runtime, sessionId, a),
      setSessionWorkingDirectory(runtime, sessionId, b),
    ]);
    expect(ra.ok && rb.ok).toBe(true);
    const final = resolveSessionCwd(runtime, sessionId);
    expect([path.resolve(a), path.resolve(b)]).toContain(final);

    rmSync(productDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects missing directories and ensure restores when cwd vanishes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-cwd-root2-"));
    const { runtime, sessionId, productDir } = runtimeAt(root);

    const missing = await setSessionWorkingDirectory(
      runtime,
      sessionId,
      path.join(root, "nope"),
    );
    expect(missing.ok).toBe(false);

    const ghost = path.join(root, "ghost");
    mkdirSync(ghost, { recursive: true });
    await setSessionWorkingDirectory(runtime, sessionId, ghost);
    rmSync(ghost, { recursive: true, force: true });
    const ensured = await ensureSessionWorkingDirectory(runtime, sessionId);
    expect(ensured.ok).toBe(true);
    if (ensured.ok) {
      expect(ensured.cwd).toBe(path.resolve(root));
    }

    rmSync(productDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
});
