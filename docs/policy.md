# 策略门禁

> **读者**：集成者 · 贡献者

有序规则引擎，覆盖 `tool.call` · `provider.use` · `mcp.connect`。

## 裁决

| 裁决 | 含义 |
|------|------|
| `allow` | 放行 |
| `deny` | 硬拒绝 |
| `ask` | 需审批（工具路径：pre-execute → pipeline `onApproval`） |

首条匹配规则生效；否则按 kind 默认：

| Kind | 默认 |
|------|------|
| `tool.call` | allow |
| `provider.use` | allow |
| `mcp.connect` | **deny**（M0 client 已存在；须显式 allow） |

## 编程 API

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
// read-only denies apply_edit / write_file / bash / job_kill /
// job_kill / run_code / terminal_open / terminal_send / terminal_signal /
// terminal_close
pipeline.onGuard(createPolicyToolGuard(engine));
assertPolicyAllow(engine, { kind: "provider.use", providerId: llm.id });
```

## 规则集文件（JSON）

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

| API | 职责 |
|-----|------|
| `parsePolicyRuleset` | 校验并转为 engine options |
| `createPolicyEngineFromRuleset` | JSON → engine |
| `loadPolicyRulesetFile` / `createPolicyEngineFromFile` | path → options / engine |
| `policyRulesetJsonSchema` | 导出 schema（`$id` …/policy-ruleset.json） |

`action`：`deny` · `ask` · `allow-only`（名单外 deny）。  
`mcp.connect` 仅支持 `deny`。无热重载——改文件后重新 `load`。

## Host / Face 接线

| 路径 | 行为 |
|------|------|
| Env `XRK_POLICY_FILE` | `loadHostConfig` → `runtime.policyFile` |
| Host spawn | `createPolicyEngineFromFile` → Face `policy` + serve 注入 preset `onPre` |
| Face `session.selectModel` | `assertPolicyAllow({ kind: "provider.use", providerId })`；否 → `policy-denied` |
| Face ask | `approval/asked|decided` + `session.respondApproval`；Host 挂 `setApprovalHandler` |
| Preset `policy?` | tool `onPre(createPolicyToolPre)` |

`mcp.connect` 默认 deny。产品路径：壳内 **设置 → 插件 → MCP**（允许连接并保存）。无头 / CI 可用 `XRK_MCP_SERVERS`（`command` 或 `url`）+ `XRK_MCP_ALLOW=1`。Client 支持 **stdio + streamable-http**。

## 未交付

- YAML / TOML rulesets
- Policy 热重载
- 审批超时自动 decide（仅 abort→cancel）

参见：[tool-pipeline.md](./tool-pipeline.md) · [security-checklist.md](./security-checklist.md) · [plugin-loader.md](./plugin-loader.md)。

---

# Policy

> **Audience**: Integrators · Contributors

Ordered rule engine for `tool.call` · `provider.use` · `mcp.connect`.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `allow` | Proceed |
| `deny` | Hard reject |
| `ask` | Needs approval (tool path: pre-execute → pipeline `onApproval`) |

The first matching rule wins; otherwise per-kind defaults apply:

| Kind | Default |
|------|---------|
| `tool.call` | allow |
| `provider.use` | allow |
| `mcp.connect` | **deny** (M0 client exists; explicit allow required) |

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
// read-only denies apply_edit / write_file / bash / job_kill /
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
| `parsePolicyRuleset` | Validate and convert to engine options |
| `createPolicyEngineFromRuleset` | JSON → engine |
| `loadPolicyRulesetFile` / `createPolicyEngineFromFile` | path → options / engine |
| `policyRulesetJsonSchema` | Export schema (`$id` …/policy-ruleset.json) |

`action`: `deny` · `ask` · `allow-only` (deny outside the allow list).  
`mcp.connect` supports `deny` only. No hot reload — re-`load` after editing the file.

## Host / Face wiring

| Path | Behavior |
|------|----------|
| Env `XRK_POLICY_FILE` | `loadHostConfig` → `runtime.policyFile` |
| Host spawn | `createPolicyEngineFromFile` → Face `policy` + serve injects preset `onPre` |
| Face `session.selectModel` | `assertPolicyAllow({ kind: "provider.use", providerId })`; else → `policy-denied` |
| Face ask | `approval/asked|decided` + `session.respondApproval`; Host mounts `setApprovalHandler` |
| Preset `policy?` | tool `onPre(createPolicyToolPre)` |

`mcp.connect` defaults to deny. Product path: in-shell **Settings → Plugins → MCP** (allow connect and save). For headless / CI, use `XRK_MCP_SERVERS` (`command` or `url`) with `XRK_MCP_ALLOW=1`. The client supports **stdio + streamable-http**.

## Not shipped

- YAML / TOML rulesets
- Policy hot reload
- Auto-decide on approval timeout (abort→cancel only)

See: [tool-pipeline.md](./tool-pipeline.md) · [security-checklist.md](./security-checklist.md) · [plugin-loader.md](./plugin-loader.md).
