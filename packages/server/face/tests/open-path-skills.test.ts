import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { canOpenNativePath } from "../src/host-open-path.js";
import { listSkillsFromWorkspace } from "../src/skill-list.js";

function bareRuntime(workspaceRoot: string) {
  return createFaceRuntime({
    store: createMemorySessionStore(),
    workspaceRoot,
    version: "test",
    registry: createProviderRegistry(),
    drain: {
      wake: () => {},
      cancel: () => {},
      isActive: () => false,
    },
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

describe("host.openPath + skill.list", () => {
  it("host.describe reports canOpenPath for desktop platforms", async () => {
    const runtime = bareRuntime(process.cwd());
    const d = await dispatchFaceMethod(runtime, "host.describe", "r1", {});
    expect(d.result.ok).toBe(true);
    if (d.result.ok) {
      expect((d.result.value as { canOpenPath: boolean }).canOpenPath).toBe(
        canOpenNativePath(),
      );
    }
  });

  it("host.openPath rejects relative paths", async () => {
    const runtime = bareRuntime(process.cwd());
    const res = await dispatchFaceMethod(runtime, "host.openPath", "r2", {
      path: "relative.txt",
    });
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) {
      expect(res.result.error.code).toBe("invalid-payload");
    }
  });

  it("lists skills from .xrk/skills/*/SKILL.md", async () => {
    const ws = path.join(os.tmpdir(), `xrk-ws-${Date.now()}`);
    const skillDir = path.join(ws, ".xrk", "skills", "office-ping");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: office-ping
description: Ping skill for tests
whenToUse: when testing skill.list
---
# Office ping
`,
      "utf8",
    );

    const listed = await listSkillsFromWorkspace(ws);
    expect(listed).toEqual([
      {
        name: "office-ping",
        description: "Ping skill for tests",
        whenToUse: "when testing skill.list",
        modelInvocable: true,
      },
    ]);

    const runtime = bareRuntime(ws);
    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const res = await dispatchFaceMethod(runtime, "skill.list", "s1", {
      sessionId,
    });
    expect(res.result.ok).toBe(true);
    if (res.result.ok) {
      expect((res.result.value as { skills: unknown[] }).skills).toHaveLength(1);
    }
  });
});
