import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  listPendingAdmits,
  readSessionEvents,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";
import type { FaceRuntime } from "../src/context.js";
import type { ExternalAgentLiveSession } from "../src/external-agent-runtime.js";
import { bindSubagentTools } from "../src/subagent-tools.js";

/** Two routable deepseek rows (one advertising reasoning efforts). */
const SETTINGS_YAML = [
  "llm-deepseek:",
  "  baseURL: https://api.deepseek.com",
  "  models:",
  "    - id: deepseek-chat",
  "      name: DeepSeek Chat",
  "      reasoning:",
  "        efforts:",
  "          - id: off",
  "            name: Off",
  "          - id: max",
  "            name: Max",
  "        defaultEffort: off",
  "    - id: deepseek-v4-flash",
  "      name: DeepSeek Flash",
  "agent-default-model:",
  "  provider: deepseek",
  "  model: deepseek-chat",
  "",
].join("\n");

function admittingResolve(
  store: ReturnType<typeof createMemorySessionStore>,
  prompted: string[],
) {
  const admit = admittingAgentResolve(store);
  return async (sessionId: string) => {
    prompted.push(sessionId);
    // A real admit lands in the child's log, so "delivered" is observable.
    return admit(sessionId);
  };
}

async function routedRuntime() {
  const dir = await mkdtemp(path.join(tmpdir(), "xrk-sa-pin-"));
  await writeFile(path.join(dir, "settings.yaml"), SETTINGS_YAML, "utf8");
  await writeFile(
    path.join(dir, ".credentials.yaml"),
    "DEEPSEEK_API_KEY: sk-test-route\n",
    "utf8",
  );
  const store = createMemorySessionStore();
  const prompted: string[] = [];
  const runtime = createBareFaceRuntime({
    store,
    productDir: dir,
    workspaceRoot: dir,
    resolveAgent: admittingResolve(store, prompted),
  });
  return { dir, store, runtime, prompted };
}

function childPair(
  runtime: FaceRuntime,
  route: { provider: string; model: string } = {
    provider: "deepseek",
    model: "deepseek-chat",
  },
) {
  const parent = runtime.ensureSession("parent");
  runtime.sessionAgentPresets.set(parent, "harness");
  const child = runtime.ensureSession("child");
  runtime.sessionAgentPresets.set(child, "harness");
  runtime.sessionModels.set(parent, { ...route });
  runtime.sessionModels.set(child, { ...route });
  runtime.subagents.attach({
    parentSessionId: parent,
    childSessionId: child,
    mode: "continuable",
    label: "child",
  });
  return { parent, child };
}

function pendingCount(
  store: ReturnType<typeof createMemorySessionStore>,
  childId: string,
): number {
  return listPendingAdmits(readSessionEvents(store, childId), childId).length;
}

describe("child route pinning from the parent", () => {
  it("followup_task repins the child route, reports it and delivers the task", async () => {
    const { runtime, store, prompted } = await routedRuntime();
    const { parent, child } = childPair(runtime);
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("followup_task")!.execute({
      agent_id: child,
      message: "keep going",
      model: "deepseek-v4-flash",
    });

    expect(out.isError).not.toBe(true);
    expect(runtime.sessionModels.get(child)).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(out.content).toContain(
      "route: deepseek/deepseek-chat → deepseek/deepseek-v4-flash",
    );
    expect(prompted).toContain(child);
    expect(pendingCount(store, child)).toBe(1);
  });

  it("followup_task refuses an unroutable pin and never prompts the child", async () => {
    const { runtime, store, prompted } = await routedRuntime();
    const { parent, child } = childPair(runtime);
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("followup_task")!.execute({
      agent_id: child,
      message: "wake up",
      provider: "ghost-provider",
      model: "ghost-model",
    });

    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/unknown provider|provider-not-found/);
    // Atomicity: a refused pin must send nothing. `resolveAgent` is only
    // reached through `subagent.prompt`, so its absence proves no delivery.
    expect(prompted).not.toContain(child);
    expect(pendingCount(store, child)).toBe(0);
    expect(runtime.sessionModels.get(child)).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("reasoning_effort alone keeps the child's current provider/model", async () => {
    const { runtime } = await routedRuntime();
    const { parent, child } = childPair(runtime, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("set_agent_model")!.execute({
      agent_id: child,
      reasoning_effort: "max",
    });

    expect(out.isError).not.toBe(true);
    expect(runtime.sessionModels.get(child)).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      reasoningEffort: "max",
    });
    expect(out.content).toContain(
      "route: deepseek/deepseek-v4-flash (unchanged) · effort default → max",
    );
  });

  it("send_message repins and reports the new route", async () => {
    const { runtime, store } = await routedRuntime();
    const { parent, child } = childPair(runtime);
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("send_message")!.execute({
      agent_id: child,
      message: "status?",
      delivery: "queue",
      model: "deepseek-v4-flash",
    });

    expect(out.isError).not.toBe(true);
    expect(out.content).toContain("sent to");
    expect(out.content).toContain("deepseek/deepseek-chat → deepseek/deepseek-v4-flash");
    expect(runtime.sessionModels.get(child)).toMatchObject({
      model: "deepseek-v4-flash",
    });
    expect(pendingCount(store, child)).toBe(1);
  });

  it("set_agent_model refuses a session this parent did not spawn", async () => {
    const { runtime } = await routedRuntime();
    const { parent } = childPair(runtime);
    const stranger = runtime.ensureSession("stranger");
    runtime.sessionModels.set(stranger, {
      provider: "deepseek",
      model: "deepseek-chat",
    });
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("set_agent_model")!.execute({
      agent_id: stranger,
      model: "deepseek-v4-flash",
    });

    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/not your child/);
    expect(runtime.sessionModels.get(stranger)).toMatchObject({
      model: "deepseek-chat",
    });
  });

  it("an external child refuses a Face-side pin and is never prompted", async () => {
    const { runtime, dir } = await routedRuntime();
    const { parent } = childPair(runtime);
    const external = runtime.ensureSession("external-child");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: external,
      mode: "continuable",
      label: "acp",
    });
    const sent: string[] = [];
    const live: ExternalAgentLiveSession = {
      kind: "acp",
      remoteId: "remote-1",
      isBusy: () => false,
      lastText: () => undefined,
      prompt: async (text) => {
        sent.push(text);
        return "ok";
      },
      interrupt: async () => {},
      dispose: () => {},
    };
    runtime.externalAgents.attach(external, live, { cwd: dir });
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("followup_task")!.execute({
      agent_id: external,
      message: "go",
      model: "deepseek-v4-flash",
    });

    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/external runtime/);
    expect(sent).toHaveLength(0);
    expect(runtime.externalAgents.has(external)).toBe(true);
  });

  it("spawn receipts carry the child's actual route, not the prediction", async () => {
    const { runtime, store } = await routedRuntime();
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    runtime.sessionModels.set(parent, {
      provider: "deepseek",
      model: "deepseek-chat",
    });
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("subagent")!.execute({
      prompt: "look around",
      run_in_background: true,
    });

    expect(out.isError).not.toBe(true);
    expect(out.content).toContain("route: deepseek/deepseek-chat");
    const childId = /`([^`]+)`/.exec(out.content)?.[1];
    expect(childId).toBeTruthy();
    expect(runtime.sessionModels.get(childId!)).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
    });
    expect(store.has(childId!)).toBe(true);
  });

  it("list_models lists routable provider/model rows within 80 lines", async () => {
    const { runtime } = await routedRuntime();
    const { parent, child } = childPair(runtime);
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("list_models")!.execute({});

    expect(out.content).toContain("- deepseek/deepseek-chat");
    expect(out.content).toContain("- deepseek/deepseek-v4-flash");
    expect(out.content).toContain("efforts: off|max");
    expect(out.content).toContain("here");
    expect(out.content).not.toContain(child);
    expect(out.content.split("\n").length).toBeLessThanOrEqual(80);
  });

  it("list_models marks the child's route as `here` when the parent is idle", async () => {
    const { runtime } = await routedRuntime();
    const { parent, child } = childPair(runtime, {
      provider: "deepseek",
      model: "deepseek-chat",
    });
    runtime.sessionModels.set(parent, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });

    const out = await tools.get("list_models")!.execute({});
    const here = out.content
      .split("\n")
      .find((line) => line.startsWith("- ") && line.includes("here"));

    expect(here).toContain("deepseek/deepseek-v4-flash");
    expect(here).not.toContain("deepseek-chat");
    expect(child).toBeTruthy();
  });
});
