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
  createDefaultPolicyEngine,
  createPolicyEngine,
  createPolicyToolCallGuard,
  createPolicyToolPre,
  createReadOnlyToolPre,
  createSessionReadOnlyToolPre,
  DEFAULT_POLICY_VERDICTS,
  denyMcpConnect,
  denyMcpResourceServers,
  denyOfficeConnect,
  denySidebarEmbedSchemes,
  denySidebarFsOps,
  denyToolNames,
  PolicyGateError,
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
  it("defaults: tool allow, mcp.connect/office deny, sidebar host allow", () => {
    const engine = createPolicyEngine();
    expect(engine.evaluate({ kind: "tool.call", name: "echo" }).verdict).toBe(
      "allow",
    );
    expect(
      engine.evaluate({ kind: "mcp.connect", serverId: "x" }).verdict,
    ).toBe("deny");
    expect(
      engine.evaluate({
        kind: "mcp.resource",
        serverId: "x",
        action: "list",
      }).verdict,
    ).toBe("allow");
    expect(
      engine.evaluate({ kind: "host.open", action: "url" }).verdict,
    ).toBe("allow");
    expect(
      engine.evaluate({
        kind: "sidebar.embed",
        url: "https://example.com",
      }).verdict,
    ).toBe("allow");
    expect(
      engine.evaluate({ kind: "sidebar.fs", op: "html" }).verdict,
    ).toBe("allow");
    expect(engine.evaluate({ kind: "office.connect" }).verdict).toBe("deny");
  });

  it("createDefaultPolicyEngine matches DEFAULT_POLICY_VERDICTS", () => {
    const engine = createDefaultPolicyEngine();
    for (const [kind, verdict] of Object.entries(DEFAULT_POLICY_VERDICTS)) {
      const subject =
        kind === "tool.call"
          ? { kind: "tool.call" as const, name: "x" }
          : kind === "provider.use"
            ? { kind: "provider.use" as const, providerId: "p" }
            : kind === "mcp.connect"
              ? { kind: "mcp.connect" as const, serverId: "s" }
              : kind === "mcp.resource"
                ? {
                    kind: "mcp.resource" as const,
                    serverId: "s",
                    action: "list" as const,
                  }
                : kind === "host.open"
                  ? { kind: "host.open" as const, action: "path" as const }
                  : kind === "sidebar.embed"
                    ? {
                        kind: "sidebar.embed" as const,
                        url: "https://x.example",
                      }
                    : kind === "sidebar.fs"
                      ? { kind: "sidebar.fs" as const, op: "read" as const }
                      : { kind: "office.connect" as const };
      expect(engine.evaluate(subject).verdict).toBe(verdict);
    }
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
    try {
      assertPolicyAllow(engine, { kind: "tool.call", name: "danger" });
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyGateError);
      if (err instanceof PolicyGateError) {
        expect(err.code).toBe("policy-denied");
        expect(err.details.kind).toBe("tool.call");
      }
    }
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

  it("denyMcpResourceServers rule", () => {
    const engine = createPolicyEngine({
      rules: [denyMcpResourceServers(["blocked"])],
    });
    expect(
      engine.evaluate({
        kind: "mcp.resource",
        serverId: "blocked",
        action: "read",
        uri: "x://y",
      }).verdict,
    ).toBe("deny");
    expect(
      engine.evaluate({
        kind: "mcp.resource",
        serverId: "ok",
        action: "list",
      }).verdict,
    ).toBe("allow");
  });

  it("sidebar preview policy subjects", () => {
    const engine = createPolicyEngine({
      rules: [
        denySidebarEmbedSchemes(["http"]),
        denySidebarFsOps(["write"]),
        denyOfficeConnect(),
      ],
      defaults: { "office.connect": "allow" },
    });
    expect(
      engine.evaluate({
        kind: "sidebar.embed",
        url: "http://insecure.example",
      }).verdict,
    ).toBe("deny");
    expect(
      engine.evaluate({
        kind: "sidebar.embed",
        url: "https://ok.example",
      }).verdict,
    ).toBe("allow");
    expect(
      engine.evaluate({ kind: "sidebar.fs", op: "write" }).verdict,
    ).toBe("deny");
    expect(engine.evaluate({ kind: "office.connect" }).verdict).toBe("deny");
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

  it("createSessionReadOnlyToolPre follows live isReadOnly()", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "apply_edit",
      description: "w",
      parameters: {},
      async execute() {
        return { content: "wrote" };
      },
    });
    let readOnly = false;
    const pipeline = createToolPipeline();
    pipeline.onPre(createSessionReadOnlyToolPre(() => readOnly));

    const open = await runToolDetailed({
      registry,
      call: { id: "a", name: "apply_edit", arguments: {} },
      pipeline,
    });
    expect(open.result.content).toBe("wrote");

    readOnly = true;
    const blocked = await runToolDetailed({
      registry,
      call: { id: "b", name: "apply_edit", arguments: {} },
      pipeline,
    });
    expect(blocked.result.isError).toBe(true);
  });

  it("createReadOnlyToolPre always denies listed tools", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "bash",
      description: "b",
      parameters: {},
      async execute() {
        return { content: "no" };
      },
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(createReadOnlyToolPre());
    const out = await runToolDetailed({
      registry,
      call: { id: "c", name: "bash", arguments: {} },
      pipeline,
    });
    expect(out.result.isError).toBe(true);
  });
});
