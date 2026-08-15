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

  it("exports json schema", () => {
    expect(policyRulesetJsonSchema.$id).toContain("policy-ruleset");
    expect(policyRulesetJsonSchema.properties.version.const).toBe(1);
  });
});
