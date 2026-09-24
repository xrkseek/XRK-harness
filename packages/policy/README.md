# @xrkseek/policy

Policy plane: `tool.call` · `provider.use` · `mcp.connect` → allow | deny | ask.

## Shipped

- `createPolicyEngine` — ordered rules  
- Rule helpers + pipeline bridges (`createPolicyToolPre` / `Guard`)  
- Write-path floor: `createWritePathSecurityPre` / `Post` (sensitive path deny + content pattern advisory)  
- **Ruleset JSON**: `parsePolicyRuleset` · `loadPolicyRulesetFile` · `policyRulesetJsonSchema`  

Hardline argv floor lives in `@xrkseek/exec-sandbox` (`createHardlineArgvPre`) and is wired **before** policy in the harness preset.

See `docs/policy.md`.

## Not shipped

Hot reload · YAML · approval UI · live MCP connect.
