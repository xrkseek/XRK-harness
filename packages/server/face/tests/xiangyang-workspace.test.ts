/**
 * 向阳空间 default workspace + 奇创 lock + dedicated skills seed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { AgentHandle } from "@xrkseek/core-agent";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  QICHUANG_AGENT_PRESET_ID,
  XIANGYANG_WORKSPACE_ID,
  XIANGYANG_WORKSPACE_TITLE,
  xiangyangWorkspacePath,
} from "../src/xiangyang-workspace.js";
import { seedXiangyangSkills } from "../src/xiangyang-skills.js";
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

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("向阳空间 workspace", () => {
  it("boots as 向阳空间 under product home and rejects delete/rename", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-ws-"));
    homes.push(home);
    const launch = path.join(home, "project");
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: launch,
      productDir: home,
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const row = runtime.workspaces.get(XIANGYANG_WORKSPACE_ID);
    expect(row?.title).toBe(XIANGYANG_WORKSPACE_TITLE);
    expect(path.resolve(row!.path)).toBe(
      path.resolve(xiangyangWorkspacePath(home)),
    );
    expect(
      runtime.workspaces
        .list(runtime.store.list())
        .items.some((w) => path.resolve(w.path) === path.resolve(launch)),
    ).toBe(true);

    const del = await dispatchFaceMethod(runtime, "workspace.delete", "d1", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    expect(del.result.ok).toBe(false);

    const ren = await dispatchFaceMethod(runtime, "workspace.rename", "r1", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
      title: "other",
    });
    expect(ren.result.ok).toBe(false);
  });

  it("skips Linux guest /root as coding workspace (mobile first boot)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-guest-home-"));
    homes.push(home);
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: "/root",
      productDir: home,
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const items = runtime.workspaces.list(runtime.store.list()).items;
    expect(items.map((w) => w.workspaceId)).toEqual([XIANGYANG_WORKSPACE_ID]);
    expect(
      items.some((w) => path.resolve(w.path) === path.resolve("/root")),
    ).toBe(false);
  });

  it("pins 奇创 on session.create and rejects preset switch", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-pin-"));
    homes.push(home);
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: xiangyangWorkspacePath(home),
      productDir: home,
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {
      sessionId: "xy-1",
      workspaceId: XIANGYANG_WORKSPACE_ID,
      agentPreset: "harness",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    expect(
      (created.result.value as { agentPreset?: string }).agentPreset,
    ).toBe(QICHUANG_AGENT_PRESET_ID);

    const sel = await dispatchFaceMethod(runtime, "agentPreset.select", "s1", {
      sessionId: "xy-1",
      agentPreset: "harness",
    });
    expect(sel.result.ok).toBe(false);
  });

  it("coding mode may dispatch into 向阳 (求助通道); im/qichuang still refuse", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-dispatch-"));
    homes.push(home);
    const stubAgent = (id: string): AgentHandle =>
      ({
        tools: createToolRegistry(),
        admit: () => ({
          admitId: `a-${id}`,
          sessionId: id,
          content: "",
          delivery: "queue",
        }),
        pendingAdmits: () => [],
        abort: () => {},
        isBusy: () => false,
        setApprovalHandler: () => {},
        continueTurn: async () => ({ text: "", events: [] }),
        run: async () => ({ text: "", events: [] }),
      }) as unknown as AgentHandle;
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: xiangyangWorkspacePath(home),
      productDir: home,
      resolveAgent: async () => stubAgent("coding-orch"),
    });
    expect(runtime.workspaces.get(XIANGYANG_WORKSPACE_ID)).toBeTruthy();

    const codingTools = createToolRegistry();
    const { bindWorkspaceOrchestrateTools } = await import(
      "../src/workspace-orchestrate-tools.js"
    );
    bindWorkspaceOrchestrateTools(codingTools, {
      runtime,
      sessionId: "coding-orch",
      mode: "coding",
    });
    const codingTool = codingTools.get("workspace_session_prompt");
    expect(codingTool).toBeTruthy();
    const out = await codingTool!.execute(
      {
        workspace_id: XIANGYANG_WORKSPACE_ID,
        prompt: "配置求助：这个字段改哪个 ns",
        wait: false,
      },
      new AbortController().signal,
    );
    const body = JSON.parse(String(out.content)) as {
      workspaceId?: string;
      ok?: boolean;
      sessionId?: string;
    };
    expect(out.isError).toBeFalsy();
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe(XIANGYANG_WORKSPACE_ID);
    expect(body.sessionId).toBeTruthy();

    const xyTools = createToolRegistry();
    bindWorkspaceOrchestrateTools(xyTools, {
      runtime,
      sessionId: "qichuang-orch",
      mode: "qichuang",
    });
    const refused = await xyTools
      .get("workspace_session_prompt")!
      .execute(
        { workspace_id: XIANGYANG_WORKSPACE_ID, prompt: "hi", wait: false },
        new AbortController().signal,
      );
    expect(refused.isError).toBe(true);
    expect(String(refused.content)).toMatch(/refuse Xiangyang/);
  });

  it("bindSessionAgent mounts workspace_session_prompt without subagent", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-bind-"));
    homes.push(home);
    const tools = createToolRegistry();
    const agent = {
      tools,
      admit() {
        return {
          admitId: "a",
          sessionId: "xy",
          content: "",
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
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: xiangyangWorkspacePath(home),
      productDir: home,
      resolveAgent: async () => agent,
    });
    const sid = runtime.ensureSession("xy-bind");
    runtime.workspaces.attachSession(sid, XIANGYANG_WORKSPACE_ID);
    await runtime.resolveAgent(sid);
    expect(tools.get("workspace_list")).toBeTruthy();
    expect(tools.get("workspace_create")).toBeTruthy();
    expect(tools.get("workspace_session_prompt")).toBeTruthy();
    expect(tools.get("thread_list")).toBeTruthy();
    expect(tools.get("thread_message")).toBeTruthy();
    expect(tools.get("thread_upsert")).toBeTruthy();
    expect(tools.get("team_list")).toBeTruthy();
    expect(tools.get("presence_set")).toBeTruthy();
    expect(tools.get("subagent")).toBeFalsy();
  });

  it("seeds dedicated skills only under 向阳空间", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-sk-"));
    homes.push(home);
    const root = xiangyangWorkspacePath(home);
    const first = await seedXiangyangSkills(root);
    expect(first.installed.length).toBeGreaterThan(0);
    expect(first.revision).toBeGreaterThanOrEqual(2);
    expect(first.installed).toContain("xrk-demand-translate");
    expect(first.installed).toContain("xrk-plugin-dev-care");
    expect(first.installed).toContain("xrk-home-config");
    expect(first.installed).toContain("xrk-memory-polish");
    expect(first.installed).toContain("xrk-mainline-sideline");
    const pluginBody = await readFile(
      path.join(root, ".xrk", "skills", "xrk-plugin-dev-care", "SKILL.md"),
      "utf8",
    );
    expect(pluginBody).toMatch(/createPlugin/);
    expect(pluginBody).toMatch(/xrkh plugin add/);
    const second = await seedXiangyangSkills(root);
    expect(second.installed).toEqual([]);
  });

  it("refreshes product skill bodies when the seed text changes", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-sk-refresh-"));
    homes.push(home);
    const root = xiangyangWorkspacePath(home);
    await seedXiangyangSkills(root);
    const file = path.join(root, ".xrk", "skills", "xrk-memory-polish", "SKILL.md");
    await writeFile(file, "---\nname: stale\n---\n", "utf8");
    const refreshed = await seedXiangyangSkills(root);
    expect(refreshed.installed).toContain("xrk-memory-polish");
    const body = await readFile(file, "utf8");
    expect(body).toMatch(/scope=global\|workspace\|session\|agent/);
  });
});
