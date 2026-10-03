import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { resolveSubagentModelSetting } from "../src/model-catalog.js";
import { buildSessionStatusSnapshot } from "../src/session-status.js";
import { bindSubagentTools } from "../src/subagent-tools.js";
import { createToolRegistry } from "@xrkseek/core-tools";

/** Seed the `agent-loop` user layer the way Settings → Plugins would. */
function setAgentLoop(
  runtime: ReturnType<typeof createBareFaceRuntime>,
  user: Record<string, unknown>,
): void {
  const slot = runtime.settingsNamespaces.ensure("agent-loop");
  slot.user = user;
  slot.revision += 1;
}

describe("subagent model route", () => {
  it("reads agent-loop.subagentModel as provider/model, effort optional", () => {
    const runtime = createBareFaceRuntime();
    expect(resolveSubagentModelSetting(runtime)).toBeUndefined();

    setAgentLoop(runtime, { subagentModel: "  " });
    expect(resolveSubagentModelSetting(runtime)).toBeUndefined();

    setAgentLoop(runtime, { subagentModel: "deepseek/deepseek-flash" });
    expect(resolveSubagentModelSetting(runtime)).toEqual({
      provider: "deepseek",
      model: "deepseek-flash",
    });

    setAgentLoop(runtime, { subagentModel: "openrouter/vendor/model (high)" });
    expect(resolveSubagentModelSetting(runtime)).toEqual({
      provider: "openrouter",
      model: "vendor/model",
      reasoningEffort: "high",
    });

    // A draft that is not a route resolves to "inherit" rather than a
    // half-parsed selection — the card blocks saving such text in the first place.
    setAgentLoop(runtime, { subagentModel: "deepseek-flash" });
    expect(resolveSubagentModelSetting(runtime)).toBeUndefined();
  });

  it("freezes the parent's effective route into the child at spawn", async () => {
    const runtime = createBareFaceRuntime({ store: createMemorySessionStore() });
    const parent = runtime.ensureSession("parent-route");
    // Parent never called selectModel: it resolves through the default chain.
    const parentRoute = resolveSubagentModelSetting(runtime);
    expect(parentRoute).toBeUndefined();

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parent,
      label: "child",
    });
    expect(created.result.ok).toBe(true);
    const childId = String(
      (created.result.value as { sessionId: string }).sessionId,
    );

    // The parent never pinned anything — the case that used to leave the child
    // to re-resolve later and drift onto a different `agent-default-model`.
    expect(runtime.sessionModels.get(parent)).toBeUndefined();
    const childRoute = runtime.sessionModels.get(childId);
    expect(childRoute?.provider).toBeTruthy();
    expect(childRoute?.model).toBeTruthy();
  });

  it("reports each child's effective route in the catalog and Status", async () => {
    const runtime = createBareFaceRuntime({ store: createMemorySessionStore() });
    const parent = runtime.ensureSession("parent-visible");
    runtime.sessionModels.set(parent, {
      provider: "deepseek",
      model: "deepseek-chat",
    });
    const child = runtime.ensureSession("child-visible");
    runtime.sessionModels.set(child, { provider: "deepseek", model: "deepseek-flash" });
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });

    const listed = await dispatchFaceMethod(runtime, "subagent.list", "l", {
      parentSessionId: parent,
    });
    expect(listed.result.ok).toBe(true);
    const entries = (
      listed.result.value as { entries: Array<{ id: string; model?: string }> }
    ).entries;
    expect(entries.find((e) => e.id === child)?.model).toBe(
      "deepseek/deepseek-flash",
    );

    const live = buildSessionStatusSnapshot(runtime, parent).subagents.live;
    expect(live.find((row) => row.id === child)?.model).toBe(
      "deepseek/deepseek-flash",
    );

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const agents = await tools.get("list_agents")!.execute({});
    expect(agents.content).toContain("deepseek/deepseek-flash");
    const analytics = await tools.get("analytics")!.execute({});
    expect(analytics.content).toContain("deepseek/deepseek-flash");
  });
});
