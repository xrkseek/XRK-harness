# 安全清单 / Security Checklist

> **读者 / Audience**：集成者 · 维护者 / Integrators · Maintainers

只列 **仓库已实现** 的控制；未做项单独标明。扩展时以此为基线，勿假设 MCP 门禁已默认放行。

Lists only controls **already implemented in this repository**; unfinished items are marked separately. Treat this as the baseline when extending; do not assume MCP connect is allowed by default.

## 已有控制 / Existing controls

| 控制 / Control | 位置 / Location | 说明 / Notes |
|------|------|------|
| API Key | `server-http` | `Authorization: Bearer` 或 `x-api-key`；`XRK_API_KEY` 空 = 开发关闭鉴权 |
| CORS | `server-http` | `XRK_CORS_ORIGIN`（默认 `*`） |
| Rate limit | `server-http` | 每 IP 每分钟（`XRK_RATE_LIMIT`） |
| Session busy | TurnLatch / drain join | 同 session 单 in-flight；忙可 409 或 join |
| Tool denylist / policy engine | `@xrkseek/policy` | 见 [policy.md](./policy.md) |
| Write-intent | `createWriteIntentGuard` | 默认 `apply_edit` 须先 `read_file` |
| Sandbox argv | `exec-sandbox` + guard | Workspace cwd + DenyList |
| Path jail | `exec-fs` `resolveWithinRoot` | 相对路径与 workspace 内绝对路径均可；拒绝对出界与 `..` 逃逸 |
| Web URL 卫生 | `exec-web` `assertHttpUrl` | 仅 http(s)、拒凭据；字面量私网；**无** DNS 再绑定 |
| LSP 路径 | `exec-lsp` `resolveWithinRoot` | 查询文件必须落在 `workspaceRoot` 内 |
| PTY cwd | `exec-pty` `resolvePtyCwd` | cwd 必须落在 `workspaceRoot` 内；拒绝对 shell `SIGKILL` |
| PTY native | `node-pty@1.2.0-beta.15` | NAPI prebuild；Win inspector 为 no-op |
| Tool output bound | pipeline `bound` + persist | 大结果外溢到 `.xrk/tool-outputs/` |
| Code worker | `code-runtime` | `run_code` 进 worker（实验） |
| Safety loop/mistake | `core-session` safety | soft/hard notice；可 abort turn |
| 密钥不入库 | `.gitignore` + 示例模板 | 仓内仅 `*.example` |

## 明确未做（勿宣传） / Explicitly not shipped (do not advertise)

| 项 / Item | 状态 / Status |
|----|------|
| MCP 统一 handleToolCall 门禁 | Client M0 + Host `XRK_MCP_*` 已有；**默认仍 deny** |
| 完整 policy 文件 schema | **v1 JSON 已有**；无热加载 / YAML |
| Ask / 审批 UI | `ask` → pipeline `onApproval`；无完整人工审批 UI 流 |
| TLS 终止 | 由反向代理负责 |
| Web DNS 再绑定 | 只拦字面量私网 host |
| 多租户鉴权 / RBAC | 单 key |
| 供应链 SBOM / 签名发布 | 见 publishing 路线 |

## 开发建议 / Guidance

1. 生产环境 **必须** 设置非空 `XRK_API_KEY`，并收紧 CORS。 / Production **must** set a non-empty `XRK_API_KEY` and tighten CORS.  
2. **勿**把 `{workspace}/.xrk/.credentials.yaml` 提交进 git。  
3. harness preset 默认挂 sandbox；minimal 无 shell——按威胁模型选型。  
4. 新增危险工具：先 guard / sandbox，再注册。  
5. 变更安全相关行为 → 更新本页 + 加锁测。

相关 / Related：[http-api.md](./http-api.md) · [tool-pipeline.md](./tool-pipeline.md) · [policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [status.md](./status.md)
