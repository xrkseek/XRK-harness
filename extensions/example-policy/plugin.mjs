/**
 * Example `kind: policy` — ordered PolicyRule rows for wireCompositionPolicy.
 * Denies a sample tool name so authors can see the merge path.
 * @see docs/plugin-development.md · docs/policy.md
 */
export function createPlugin() {
  return {
    id: "example-policy",
    kind: "policy",
    policyRules: [
      {
        id: "example-deny-example-deny-me",
        match(subject) {
          if (subject.kind !== "tool.call") return undefined;
          if (subject.name !== "example_deny_me") return undefined;
          return {
            verdict: "deny",
            reason: "example-policy denylist",
            ruleId: "example-deny-example-deny-me",
          };
        },
      },
    ],
  };
}
