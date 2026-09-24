# 策略门禁

> **读者**：集成者 · 贡献者

有序规则引擎，覆盖 `tool.call` · `provider.use` · `mcp.connect` · `mcp.resource` · `host.open` · `sidebar.embed` · `sidebar.fs` · `office.connect`。

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
| `mcp.resource` | **allow**（连上后的 list/templates/read；可用 ruleset deny 服务器） |
| `host.open` | **allow**（侧栏 `open.external` / 本机打开；Host 仍校验目标） |
| `sidebar.embed` | **allow**（URL 嵌入探活；非 http(s) 由 Host 拒绝） |
| `sidebar.fs` | **allow**（侧栏读/写/html；cwd 沙箱仍是硬边界） |
| `office.connect` | **deny**（对齐 `mcp.connect`；`/office` 连接器） |

侧栏预览契约类型见 `@xrkseek/protocol`（`BrowserEmbedProbe` · `SubagentPreviewSummary` · `PlanPreviewSummary` · `OfficePreviewStatus`）。`/sidebar` 门禁 `host.open` / `sidebar.embed` / `sidebar.fs`；`/office` 门禁 `office.connect`（mutation）。`ask` 走 Face 审批缝，无缝时返回诚实 `policy-ask`（不再硬映射 deny）。

## 编程 API

```ts
import {
  createPolicyEngine,
  denyToolNames,
  askToolNames,
  createPolicyToolPre,
  createPolicyToolGuard,
  createSessionReadOnlyToolPre,
  assertPolicyAllow,
} from "@xrkseek/policy";

const engine = createPolicyEngine({
  rules: [
    askToolNames(["bash"]),
    denyToolNames(["danger"]),
  ],
});

pipeline.onPre(createPolicyToolPre(engine));
// Face `/permission` · Settings live defaultPreset — re-read session sandbox:
pipeline.onPre(
  createSessionReadOnlyToolPre(
    () => effectiveSandboxMode(readSessionEvents(store, sessionId)) === "read-only",
  ),
);
// read-only denies apply_edit / write_file / bash / job_kill /
// run_code / terminal_open / terminal_send / terminal_signal /
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
`mcp.connect` / `office.connect` 仅支持 `deny`。`mcp.resource` · `sidebar.embed` · `sidebar.fs` 仅支持 `deny`（`names` = 服务器 id / URL scheme / FS op）。`host.open` 支持 `deny` · `ask`（`names` = `path` \| `url`）。文件格式：`.json` / `.yaml` / `.yml` / `.toml` 同构 v1（解码后仍走 `parsePolicyRuleset`）。热重载：Host 监听 `XRK_POLICY_FILE`，变更后 `loadPolicyRulesetFile` → `composeHostPolicyEngine`（坏文件保留旧引擎）。

## Host / Face 接线

| 路径 | 行为 |
|------|------|
| Env `XRK_POLICY_FILE` | `loadHostConfig` → `runtime.policyFile`；Host `watchPolicyFile` 热重载（任意支持扩展名） |
| Host spawn | `loadPolicyRulesetFile`（有 `XRK_POLICY_FILE`）或默认 → `composeHostPolicyEngine`（文件规则优先，再并 `kind:policy` 插件）→ 始终注入 Face / 侧栏 / dsh-compat |
| Face `session.selectModel` | `assertPolicyAllow({ kind: "provider.use", providerId })`；否 → **`policy-denied`**（`{ code, message, details: { kind, reason, ruleId? } }`；不再折成 `model-unavailable`） |
| Face ask | `approval/asked|decided` + `session.respondApproval`；Host 挂 `setApprovalHandler`；Host policy `ask` 走同一 broker（`requestHostGate`） |
| Preset `policy?` | tool `onPre(createPolicyToolPre)` |
| 写路径安全地板（policy **前**） | harness：`createHardlineArgvPre`（argv hardline deny）+ `createWritePathSecurityPre/Post`（敏感路径 deny；内容 pattern 默认结果后提示；`XRK_SECURITY_GUIDANCE_BLOCK=1` 拒写；`XRK_SECURITY_GUIDANCE_DISABLE=1` 关闭） |
| 侧栏 `/sidebar` | `browser.probe` → `sidebar.embed`；`open.external` → `host.open`；`/sidebar/html` → `sidebar.fs` `html`（`ask`→审批缝 / 无缝→**`policy-ask`**；与 Face 同形 `details`） |
| Office `/office` | `configure` / `reconnect` / `test` / `remove` → `office.connect`；`connection.status` 不门禁；拒绝走 cordis `rpcErr` |

`mcp.connect` 默认 deny。产品路径：壳内 **设置 → 插件 → MCP**（允许连接并保存）。无头 / CI 可用 `XRK_MCP_SERVERS`（`command` 或 `url`）+ `XRK_MCP_ALLOW=1`。Client 支持 **stdio + streamable-http**。

## 未交付

- 审批超时自动 decide（仅 abort→cancel）

参见：[tool-pipeline.md](./tool-pipeline.md) · [security-checklist.md](./security-checklist.md) · [plugin-loader.md](./plugin-loader.md)。

---

# Policy

> **Audience**: Integrators · Contributors

Ordered rule engine for `tool.call` · `provider.use` · `mcp.connect` · `mcp.resource` · `host.open` · `sidebar.embed` · `sidebar.fs` · `office.connect`.

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
| `mcp.resource` | **allow** (list/templates/read after connect; ruleset may deny servers) |
| `host.open` | **allow** (sidebar `open.external` / native open; Host still validates targets) |
| `sidebar.embed` | **allow** (URL embed probe; non-http(s) rejected by Host) |
| `sidebar.fs` | **allow** (sidebar read/write/html; cwd sandbox remains the hard fence) |
| `office.connect` | **deny** (align `mcp.connect`; `/office` connector) |

Sidebar preview payload types live in `@xrkseek/protocol` (`BrowserEmbedProbe` · `SubagentPreviewSummary` · `PlanPreviewSummary` · `OfficePreviewStatus`). `/sidebar` gates `host.open` / `sidebar.embed` / `sidebar.fs`; `/office` gates `office.connect` (mutations). `ask` uses the Face approval seam; without a seam the honest code is `policy-ask` (not a hard deny).

## Programmatic API

```ts
import {
  createPolicyEngine,
  denyToolNames,
  askToolNames,
  createPolicyToolPre,
  createPolicyToolGuard,
  createSessionReadOnlyToolPre,
  assertPolicyAllow,
} from "@xrkseek/policy";

const engine = createPolicyEngine({
  rules: [
    askToolNames(["bash"]),
    denyToolNames(["danger"]),
  ],
});

pipeline.onPre(createPolicyToolPre(engine));
// Face `/permission` · Settings live defaultPreset — re-read session sandbox:
pipeline.onPre(
  createSessionReadOnlyToolPre(
    () => effectiveSandboxMode(readSessionEvents(store, sessionId)) === "read-only",
  ),
);
// read-only denies apply_edit / write_file / bash / job_kill /
// run_code / terminal_open / terminal_send / terminal_signal /
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
`mcp.connect` / `office.connect` support `deny` only. `mcp.resource` · `sidebar.embed` · `sidebar.fs` support `deny` only (`names` = server ids / URL schemes / FS ops). `host.open` supports `deny` · `ask` (`names` = `path` \| `url`). File formats: `.json` / `.yaml` / `.yml` / `.toml` isomorphic v1 (still `parsePolicyRuleset` after decode). Hot reload: Host watches `XRK_POLICY_FILE`, then `loadPolicyRulesetFile` → `composeHostPolicyEngine` (bad files keep the prior engine).

## Host / Face wiring

| Path | Behavior |
|------|----------|
| Env `XRK_POLICY_FILE` | `loadHostConfig` → `runtime.policyFile`; Host `watchPolicyFile` hot reload (any supported extension) |
| Host spawn | `loadPolicyRulesetFile` (when `XRK_POLICY_FILE` is set) or defaults → `composeHostPolicyEngine` (file rules first, then `kind:policy` plugins) → always inject into Face / sidebar / dsh-compat |
| Face `session.selectModel` | `assertPolicyAllow({ kind: "provider.use", providerId })`; else → **`policy-denied`** (`{ code, message, details: { kind, reason, ruleId? } }`; no longer folded into `model-unavailable`) |
| Face ask | `approval/asked|decided` + `session.respondApproval`; Host mounts `setApprovalHandler`; Host policy `ask` uses the same broker (`requestHostGate`) |
| Preset `policy?` | tool `onPre(createPolicyToolPre)` |
| Write-path security floor (**before** policy) | harness: `createHardlineArgvPre` (argv hardline deny) + `createWritePathSecurityPre/Post` (sensitive-path deny; content patterns append advisory by default; `XRK_SECURITY_GUIDANCE_BLOCK=1` refuses writes; `XRK_SECURITY_GUIDANCE_DISABLE=1` kill switch) |
| Sidebar `/sidebar` | `browser.probe` → `sidebar.embed`; `open.external` → `host.open`; `/sidebar/html` → `sidebar.fs` `html` (`ask`→approval seam / no seam→**`policy-ask`**; same `details` shape as Face) |
| Office `/office` | `configure` / `reconnect` / `test` / `remove` → `office.connect`; `connection.status` ungated; deny/ask map to cordis `rpcErr` |

`mcp.connect` defaults to deny. Product path: in-shell **Settings → Plugins → MCP** (allow connect and save). For headless / CI, use `XRK_MCP_SERVERS` (`command` or `url`) with `XRK_MCP_ALLOW=1`. The client supports **stdio + streamable-http**.

## Not shipped

- Auto-decide on approval timeout (abort→cancel only)

See: [tool-pipeline.md](./tool-pipeline.md) · [security-checklist.md](./security-checklist.md) · [plugin-loader.md](./plugin-loader.md).
