/** session.tools + skill.list source classification. */

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { classifySkillSource } from "../src/skill-source.js";
import { classifySessionToolName } from "../src/session-tools.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

describe("classifySkillSource", () => {
  it("tags workspace .xrk/skills vs home .claude/skills", () => {
    const ws = path.join(os.tmpdir(), "xrk-skill-src-ws");
    const homeSkill = path.join(
      os.tmpdir(),
      "xrk-skill-src-home",
      ".claude",
      "skills",
      "ping",
    );
    const wsSkill = path.join(ws, ".xrk", "skills", "office");
    expect(classifySkillSource(wsSkill, ws)).toMatchObject({
      layer: "workspace",
      vendor: "xrk",
      root: ".xrk/skills",
    });
    expect(classifySkillSource(homeSkill, ws)).toMatchObject({
      layer: "home",
      vendor: "claude",
      root: "~/.claude/skills",
    });
  });
});

describe("classifySessionToolName", () => {
  it("splits mcp__* from preset tools", () => {
    expect(classifySessionToolName("read_file")).toBe("preset");
    expect(classifySessionToolName("mcp__demo__search")).toBe("mcp");
  });
});

describe("session.tools Face RPC", () => {
  it("lists bound agent tools with groups", async () => {
    const tools = createToolRegistry();
    tools.register({
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    tools.register({
      name: "mcp__demo__search",
      description: "MCP search",
      parameters: { type: "object", properties: {} },
      exposure: "deferred",
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    tools.register({
      name: "hidden_internal",
      description: "hidden",
      parameters: { type: "object", properties: {} },
      exposure: "hidden",
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    });

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      registry: createProviderRegistry(),
      resolveAgent: async () =>
        ({
          tools,
          continueTurn: async () => ({ ok: true }),
          run: async () => ({ ok: true }),
          admit: () => ({ admitId: "a" }),
          pendingAdmits: () => [],
          abort: () => {},
          isBusy: () => false,
          setApprovalHandler: () => {},
        }) as never,
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const res = await dispatchFaceMethod(runtime, "session.tools", "t1", {
      sessionId,
    });
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("tools failed");
    const value = res.result.value as {
      agentPreset: string;
      cwd: string;
      workspaceLabel: string;
      tools: readonly {
        name: string;
        group: string;
        surface: string;
        mcpServer?: string;
        exposure: string;
      }[];
    };
    expect(value.agentPreset).toBeTruthy();
    expect(value.cwd).toBeTruthy();
    expect(value.workspaceLabel).toBeTruthy();
    const names = value.tools.map((t) => t.name);
    // Face bindSessionAgent also mounts presence / canvas / team / … — assert ours.
    expect(names).toContain("read_file");
    expect(names).toContain("mcp__demo__search");
    expect(names).not.toContain("hidden_internal");
    expect(value.tools.find((t) => t.name === "mcp__demo__search")).toMatchObject({
      group: "mcp",
      surface: "mcp",
      mcpServer: "demo",
      exposure: "deferred",
    });
    expect(value.tools.find((t) => t.name === "read_file")).toMatchObject({
      group: "preset",
      surface: "filesystem",
      exposure: "direct",
    });
    // MCP rows sort after preset within the catalog.
    expect(names.indexOf("read_file")).toBeLessThan(names.indexOf("mcp__demo__search"));
  });
});

describe("skill.list source field", () => {
  it("returns source on each skill row", async () => {
    const ws = path.join(os.tmpdir(), `xrk-ws-src-${Date.now()}`);
    const skillDir = path.join(ws, ".xrk", "skills", "src-ping");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: src-ping
description: Source field test
---
# ping
`,
      "utf8",
    );

    const runtime = createBareFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: ws,
      registry: createProviderRegistry(),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const res = await dispatchFaceMethod(runtime, "skill.list", "s1", {
      sessionId,
    });
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("list failed");
    const value = res.result.value as {
      skills: readonly {
        name: string;
        source: { layer: string; vendor: string; root: string };
      }[];
      workspace: { cwd: string; label: string };
      documents: readonly { path: string; layer: string; bytes: number }[];
    };
    const hit = value.skills.find((s) => s.name === "src-ping");
    expect(hit?.source).toMatchObject({
      layer: "workspace",
      vendor: "xrk",
      root: ".xrk/skills",
    });
    expect(value.workspace.cwd).toBeTruthy();
    expect(value.workspace.label).toBeTruthy();
    expect(Array.isArray(value.documents)).toBe(true);

    const read = await dispatchFaceMethod(runtime, "skill.read", "r1", {
      sessionId,
      name: "src-ping",
    });
    expect(read.result.ok).toBe(true);
    if (!read.result.ok) throw new Error("read failed");
    expect(read.result.value).toMatchObject({
      kind: "skill",
      name: "src-ping",
    });
    expect(String((read.result.value as { content: string }).content)).toContain("ping");
  });
});
