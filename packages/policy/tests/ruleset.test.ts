import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PolicyRulesetParseError,
  createPolicyEngineFromFile,
  createPolicyEngineFromRuleset,
  parsePolicyRuleset,
  policyRulesetJsonSchema,
} from "../src/index.js";

const sample = {
  version: 1 as const,
  defaults: { "mcp.connect": "deny" as const },
  rules: [
    {
      id: "ask-bash",
      action: "ask" as const,
      match: { kind: "tool.call" as const, names: ["bash"] },
    },
    {
      id: "deny-x",
      action: "deny" as const,
      match: { kind: "tool.call" as const, names: ["danger"] },
    },
    {
      id: "providers",
      action: "allow-only" as const,
      match: { kind: "provider.use" as const, names: ["replay"] },
    },
  ],
};

describe("policy ruleset", () => {
  it("parses deny/ask/allow-only rules", () => {
    const opts = parsePolicyRuleset(sample);
    expect(opts.rules?.length).toBe(3);
    const engine = createPolicyEngineFromRuleset(sample);
    expect(engine.evaluate({ kind: "tool.call", name: "bash" }).verdict).toBe(
      "ask",
    );
    expect(
      engine.evaluate({ kind: "tool.call", name: "danger" }).verdict,
    ).toBe("deny");
    expect(
      engine.evaluate({ kind: "provider.use", providerId: "other" }).verdict,
    ).toBe("deny");
    expect(
      engine.evaluate({ kind: "provider.use", providerId: "replay" }).verdict,
    ).toBe("allow");
  });

  it("rejects bad version and actions", () => {
    expect(() => parsePolicyRuleset({ version: 99 })).toThrow(
      PolicyRulesetParseError,
    );
    expect(() =>
      parsePolicyRuleset({
        version: 1,
        rules: [
          {
            id: "x",
            action: "allow",
            match: { kind: "tool.call", names: ["a"] },
          },
        ],
      }),
    ).toThrow(/action/);
  });

  it("loads from file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-pol-"));
    const file = path.join(dir, "policy.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "d",
            action: "deny",
            match: { kind: "tool.call", names: ["rm"] },
          },
        ],
      }),
      "utf8",
    );
    const engine = await createPolicyEngineFromFile(file);
    expect(engine.evaluate({ kind: "tool.call", name: "rm" }).verdict).toBe(
      "deny",
    );
  });

  it("loads YAML and TOML into the same engine schema", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-pol-fmt-"));
    const yamlFile = path.join(dir, "policy.yaml");
    const tomlFile = path.join(dir, "policy.toml");
    await writeFile(
      yamlFile,
      [
        "version: 1",
        "rules:",
        "  - id: d",
        "    action: deny",
        "    match:",
        "      kind: tool.call",
        "      names: [rm]",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      tomlFile,
      [
        "version = 1",
        "",
        "[[rules]]",
        'id = "d"',
        'action = "deny"',
        'match = { kind = "tool.call", names = ["rm"] }',
        "",
      ].join("\n"),
      "utf8",
    );
    for (const file of [yamlFile, tomlFile]) {
      const engine = await createPolicyEngineFromFile(file);
      expect(engine.evaluate({ kind: "tool.call", name: "rm" }).verdict).toBe(
        "deny",
      );
      expect(
        engine.evaluate({ kind: "tool.call", name: "bash" }).verdict,
      ).toBe("allow");
    }
  });

  it("parses mcp.resource deny by server names", () => {
    const engine = createPolicyEngineFromRuleset({
      version: 1,
      rules: [
        {
          id: "deny-res",
          action: "deny",
          match: { kind: "mcp.resource", names: ["secret"] },
        },
      ],
    });
    expect(
      engine.evaluate({
        kind: "mcp.resource",
        serverId: "secret",
        action: "list",
      }).verdict,
    ).toBe("deny");
  });

  it("parses host/sidebar/office preview kinds", () => {
    const engine = createPolicyEngineFromRuleset({
      version: 1,
      defaults: { "office.connect": "deny" },
      rules: [
        {
          id: "ask-url",
          action: "ask",
          match: { kind: "host.open", names: ["url"] },
        },
        {
          id: "deny-http",
          action: "deny",
          match: { kind: "sidebar.embed", names: ["http"] },
        },
        {
          id: "deny-write",
          action: "deny",
          match: { kind: "sidebar.fs", names: ["write"] },
        },
        {
          id: "deny-office",
          action: "deny",
          match: { kind: "office.connect" },
        },
      ],
    });
    expect(
      engine.evaluate({ kind: "host.open", action: "url" }).verdict,
    ).toBe("ask");
    expect(
      engine.evaluate({
        kind: "sidebar.embed",
        url: "http://x",
        scheme: "http",
      }).verdict,
    ).toBe("deny");
    expect(
      engine.evaluate({ kind: "sidebar.fs", op: "write" }).verdict,
    ).toBe("deny");
    expect(engine.evaluate({ kind: "office.connect" }).verdict).toBe("deny");
  });
});
