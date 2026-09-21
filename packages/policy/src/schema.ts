/**
 * Hand-maintained JSON Schema for policy ruleset files (version 1).
 * Runtime parse: `parsePolicyRuleset` / `loadPolicyRulesetFile`.
 */

export const policyRulesetJsonSchema = {
  $id: "https://xrkseek.dev/schemas/policy-ruleset.json",
  title: "PolicyRuleset",
  description:
    "XRK-Harness policy ruleset v1. See docs/policy.md.",
  type: "object",
  required: ["version"],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        "tool.call": { enum: ["allow", "deny", "ask"] },
        "provider.use": { enum: ["allow", "deny", "ask"] },
        "mcp.connect": { enum: ["allow", "deny", "ask"] },
        "mcp.resource": { enum: ["allow", "deny", "ask"] },
        "host.open": { enum: ["allow", "deny", "ask"] },
        "sidebar.embed": { enum: ["allow", "deny", "ask"] },
        "sidebar.fs": { enum: ["allow", "deny", "ask"] },
        "office.connect": { enum: ["allow", "deny", "ask"] },
      },
    },
    rules: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "action", "match"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          action: { enum: ["deny", "ask", "allow-only"] },
          reason: { type: "string" },
          match: {
            type: "object",
            required: ["kind"],
            additionalProperties: false,
            properties: {
              kind: {
                enum: [
                  "tool.call",
                  "provider.use",
                  "mcp.connect",
                  "mcp.resource",
                  "host.open",
                  "sidebar.embed",
                  "sidebar.fs",
                  "office.connect",
                ],
              },
              names: {
                type: "array",
                items: { type: "string", minLength: 1 },
                minItems: 1,
              },
            },
          },
        },
      },
    },
  },
} as const;
