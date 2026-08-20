# Policy

> **读者**：集成者 · 贡献者。

Ordered rule engine for `tool.call` · `provider.use` · `mcp.connect`.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `allow` | proceed |
| `deny` | hard reject |
| `ask` | needs approval (tool path: pre-execute → pipeline `onApproval`) |

First matching rule wins; else per-kind defaults:

| Kind | Default |
|------|---------|
| `tool.call` | allow |
| `provider.use` | allow |
| `mcp.connect` | **deny**（M0 client 已存在；须显式 allow） |

## Programmatic API

```ts
import {
  createPolicyEngine,
  denyToolNames,
  askToolNames,
  createPolicyToolPre,
  createPolicyToolGuard,
  createReadOnlyToolPre,
  assertPolicyAllow,
} from "@xrkseek/policy";

const engine = createPolicyEngine({
  rules: [
    askToolNames(["bash"]),
    denyToolNames(["danger"]),
  ],
});

pipeline.onPre(createPolicyToolPre(engine));
// Face `/permission read-only` → harness/minimal also mount:
pipeline.onPre(createReadOnlyToolPre());
// read-only denies apply_edit / write_file / bash / bash_jobs / bash_kill /
// job_kill / run_code / terminal_open / terminal_send / terminal_signal /
// terminal_close
pipeline.onGuard(createPolicyToolGuard(engine));
assertPolicyAllow(engine, { kind: "provider.use", providerId: llm.id });
```

## Ruleset files (JSON)

```json
{
  "version": 1,
  "defaults": { "mcp.connect": "deny" },
  "rules": [
    {
      "id": "ask-bash",
      "action": "ask",
      "match": { "kind": "tool.call", "names": ["bash"] }
    },
    {
      "id": "deny-danger",
      "action": "deny",
      "match": { "kind": "tool.call", "names": ["danger"] }
    },
    {
      "id": "providers",
      "action": "allow-only",
      "match": { "kind": "provider.use", "names": ["replay"] }
    }
  ]
}
```

| API | Role |
|-----|------|
| `parsePolicyRuleset` | validate + → engine options |
| `createPolicyEngineFromRuleset` | JSON → engine |
| `loadPolicyRulesetFile` / `createPolicyEngineFromFile` | path → options / engine |
| `policyRulesetJsonSchema` | export schema (`$id` …/policy-ruleset.json) |

`action`: `deny` · `ask` · `allow-only`（名单外 deny）。  
`mcp.connect` 仅支持 `deny`。无热重载——改文件后重新 `load`。

## Host / Face wiring

| 路径 | 行为 |
|------|------|
| Env `XRK_POLICY_FILE` | `loadHostConfig` → `runtime.policyFile` |
| Host spawn | `createPolicyEngineFromFile` → Face `policy` + serve 注入 preset `onPre` |
| Face `session.selectModel` | `assertPolicyAllow({ kind: "provider.use", providerId })`；否 → `policy-denied` |
| Face ask | `approval/asked|decided` + `session.respondApproval`；Host 挂 `setApprovalHandler` |
| Preset `policy?` | tool `onPre(createPolicyToolPre)` |

MCP connect 默认 deny；Client **stdio + streamable-http 能跑**；Host 可用 `XRK_MCP_SERVERS`（`command` 或 `url`）+ `XRK_MCP_ALLOW=1` 拉起。
## Not shipped

- YAML / TOML rulesets  
- Policy 热重载  
- 审批超时自动 decide（仅 abort→cancel）

See [tool-pipeline.md](./tool-pipeline.md) · [security-checklist.md](./security-checklist.md) · [plugin-loader.md](./plugin-loader.md).
