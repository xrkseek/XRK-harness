import { describe, expect, it } from "vitest";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
  type ToolDefinition,
} from "@xrkseek/core-tools";
import {
  allowProviderIdsOnly,
  assertPolicyAllow,
  askToolNames,
  createPolicyEngine,
  createPolicyToolCallGuard,
  createPolicyToolPre,
  denyMcpConnect,
  denyToolNames,
} from "../src/index.js";

const echo: ToolDefinition = {
  name: "echo",
  description: "echo",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: "ok" };
  },
};

const danger: ToolDefinition = {
  name: "danger",
  description: "danger",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: "should-not-run" };
  },
};

describe("policy engine", () => {
  it("defaults: tool allow, mcp.connect deny", () => {
    const engine = createPolicyEngine();
    expect(engine.evaluate({ kind: "tool.call", name: "echo" }).verdict).toBe(
      "allow",
    );
    expect(
      engine.evaluate({ kind: "mcp.connect", serverId: "x" }).verdict,
    ).toBe("deny");
  });

  it("first matching rule wins", () => {
    const engine = createPolicyEngine({
      rules: [
        askToolNames(["danger"]),
        denyToolNames(["danger"]),
      ],
    });
    expect(
      engine.evaluate({ kind: "tool.call", name: "danger" }).verdict,
    ).toBe("ask");
  });

  it("denyToolNames + assertPolicyAllow", () => {
    const engine = createPolicyEngine({
      rules: [denyToolNames(["danger"])],
    });
    expect(() =>
      assertPolicyAllow(engine, { kind: "tool.call", name: "danger" }),
    ).toThrow(/policy deny/);
    assertPolicyAllow(engine, { kind: "tool.call", name: "echo" });
  });

  it("provider allowlist", () => {
    const engine = createPolicyEngine({
      rules: [allowProviderIdsOnly(["replay"])],
    });
    expect(
      engine.evaluate({ kind: "provider.use", providerId: "replay" }).verdict,
    ).toBe("allow");
    expect(
      engine.evaluate({ kind: "provider.use", providerId: "other" }).verdict,
    ).toBe("deny");
  });

  it("denyMcpConnect rule", () => {
    const engine = createPolicyEngine({
      rules: [denyMcpConnect()],
      defaults: { "mcp.connect": "allow" },
    });
    expect(
      engine.evaluate({ kind: "mcp.connect", serverId: "s" }).verdict,
    ).toBe("deny");
  });
});

describe("policy pipeline bridge", () => {
  it("createPolicyToolCallGuard denies denylist tools", async () => {
    const registry = createToolRegistry();
    registry.register(echo);
    registry.register(danger);
    const pipeline = createToolPipeline();
    pipeline.onGuard(createPolicyToolCallGuard(["danger"]));

    const ok = await runToolDetailed({
      registry,
      call: { id: "1", name: "echo", arguments: {} },
      pipeline,
    });
    expect(ok.result.content).toBe("ok");

    const blocked = await runToolDetailed({
      registry,
      call: { id: "2", name: "danger", arguments: {} },
      pipeline,
    });
    expect(blocked.result.isError).toBe(true);
    expect(blocked.result.content).toMatch(/denylist|denied by policy/i);
  });

  it("createPolicyToolPre ask uses approval hook", async () => {
    const registry = createToolRegistry();
    registry.register(danger);
    const engine = createPolicyEngine({
      rules: [askToolNames(["danger"])],
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(createPolicyToolPre(engine));

    const denied = await runToolDetailed({
      registry,
      call: { id: "a", name: "danger", arguments: {} },
      pipeline,
    });
    expect(denied.result.isError).toBe(true);

    pipeline.setApprovalHandler(() => true);
    const allowed = await runToolDetailed({
      registry,
      call: { id: "b", name: "danger", arguments: {} },
      pipeline,
    });
    expect(allowed.result.content).toBe("should-not-run");
  });
});
