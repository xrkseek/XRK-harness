# 策略门禁 / Policy

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

有序规则引擎，覆盖 `tool.call` · `provider.use` · `mcp.connect`。

Ordered rule engine for `tool.call` · `provider.use` · `mcp.connect`.

## 裁决 / Verdicts

| 裁决 / Verdict | 含义 / Meaning |
|---------|---------|
| `allow` | 放行 / proceed |
| `deny` | 硬拒绝 / hard reject |
| `ask` | 需审批（工具路径：pre-execute → pipeline `onApproval`） / needs approval |

首条匹配规则生效；否则按 kind 默认：

The first matching rule wins; otherwise per-kind defaults apply:

| Kind | 默认 / Default |
|------|---------|
| `tool.call` | allow |
| `provider.use` | allow |
| `mcp.connect` | **deny**（M0 client 已存在；须显式 allow / M0 client exists; explicit allow required） |

## 编程 API / Programmatic API

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

## 规则集文件（JSON） / Ruleset files (JSON)

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

| API | 职责 / Role |
|-----|------|
| `parsePolicyRuleset` | 校验并转为 engine options / validate + → engine options |
| `createPolicyEngineFromRuleset` | JSON → engine |
| `loadPolicyRulesetFile` / `createPolicyEngineFromFile` | path → options / engine |
| `policyRulesetJsonSchema` | 导出 schema（`$id` …/policy-ruleset.json） / export schema |

`action`：`deny` · `ask` · `allow-only`（名单外 deny）。  
`mcp.connect` 仅支持 `deny`。无热重载——改文件后重新 `load`。

`action`: `deny` · `ask` · `allow-only` (deny outside the allow list).  
`mcp.connect` supports `deny` only. No hot reload — re-`load` after editing the file.

## Host / Face 接线 / Host / Face wiring

| 路径 / Path | 行为 / Behavior |
|------|------|
| Env `XRK_POLICY_FILE` | `loadHostConfig` → `runtime.policyFile` |
| Host spawn | `createPolicyEngineFromFile` → Face `policy` + serve 注入 preset `onPre` |
| Face `session.selectModel` | `assertPolicyAllow({ kind: "provider.use", providerId })`；否 → `policy-denied` |
| Face ask | `approval/asked|decided` + `session.respondApproval`；Host 挂 `setApprovalHandler` |
| Preset `policy?` | tool `onPre(createPolicyToolPre)` |

MCP connect 默认 deny；Client **stdio + streamable-http 能跑**；Host 可用 `XRK_MCP_SERVERS`（`command` 或 `url`）+ `XRK_MCP_ALLOW=1` 拉起。

MCP connect defaults to deny. The client **supports stdio + streamable-http**. Host may start servers via `XRK_MCP_SERVERS` (`command` or `url`) with `XRK_MCP_ALLOW=1`.

## 未交付 / Not shipped

- YAML / TOML rulesets  
- Policy 热重载 / Policy hot reload  
- 审批超时自动 decide（仅 abort→cancel） / Auto-decide on approval timeout (abort→cancel only)

参见 / See：[tool-pipeline.md](./tool-pipeline.md) · [security-checklist.md](./security-checklist.md) · [plugin-loader.md](./plugin-loader.md)。
