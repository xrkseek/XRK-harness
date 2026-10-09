import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createSessionCapabilityFragmentProvider,
  formatSessionCapability,
} from "../src/session-capability.js";
import {
  applySubagentSpawnPreamble,
  roleCapsHint,
} from "../src/agent-team-roles.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

describe("session_capability", () => {
  it("formats permission × tool_surface for a parent session", async () => {
    const store = createMemorySessionStore();
    const root = await mkdtemp(path.join(tmpdir(), "xrk-cap-"));
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "harness",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const text = formatSessionCapability(runtime, sessionId);
    expect(text).toMatch(/permission: .*path=/);
    expect(text).toMatch(/tool_surface: harness/);
    expect(text).toMatch(/path_allowlist: \d+ objects/);

    const provider = createSessionCapabilityFragmentProvider(runtime);
    const frags = provider.produce({ sessionId });
    expect(frags).toHaveLength(1);
    expect(frags[0]!.text).toContain("<session_capability>");
    expect(frags[0]!.priority).toBe(9);
  });

  it("preamble includes inherited permission and weakened tool_surface", () => {
    expect(roleCapsHint("researcher")).toBe("web,read-fs");
    const out = applySubagentSpawnPreamble({
      prompt: "find facts",
      parentSessionId: "p1",
      childSessionId: "c1",
      mode: "one-shot",
      label: "scout",
      role: "researcher",
      inheritContext: false,
      cwd: "/ws",
      isolatedWorktree: false,
      permissionInherit: "workspace-write (path=allowlisted) · approval=ask",
      parentToolSurface: "harness",
    });
    expect(out).toContain(
      "permission: inherited from parent · workspace-write (path=allowlisted) · approval=ask",
    );
    expect(out).toContain(
      "tool_surface: weakened from parent · badge=harness · role=researcher · caps=web,read-fs",
    );
  });
});
