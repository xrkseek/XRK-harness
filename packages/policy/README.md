# @xrkseek/policy

Policy plane: `tool.call` · `provider.use` · `mcp.connect` → allow | deny | ask.

## Shipped

- `createPolicyEngine` — ordered rules  
- Rule helpers + pipeline bridges (`createPolicyToolPre` / `Guard`)  
- **Ruleset JSON**: `parsePolicyRuleset` · `loadPolicyRulesetFile` · `policyRulesetJsonSchema`  

See `docs/policy.md`.

## Not shipped

Hot reload · YAML · approval UI · live MCP connect.
