# 安全清单

> **读者**：集成者 · 维护者

只列 **仓库已实现** 的控制；未做项单独标明。扩展时以此为基线，勿假设 MCP 门禁已默认放行。

## 已有控制

| 控制 | 位置 | 说明 |
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
| IM webhook  ingress | `dsh-compat` `im-messaging-bridge` | `/api/im/{channel}/webhook` 无 vendor secret 校验（开发联调）；生产应置于反向代理后并限流 |
| IM gateway relay | `im-gateway-sidecar` | `/api/im/gateway/relay`：本机 localhost 或 `XRK_IM_GATEWAY_TOKEN`；生产必须设 token |
| IM vendor WS | `im-vendor-ws-client` | `XRK_IM_GATEWAY_WS_URL` / 自 `XRK_IM_GATEWAY_URL` 推导；`XRK_IM_GATEWAY_TOKEN` 鉴权；勿暴露到浏览器 |
| Memory embed sidecar | `memory-embeddings` | `XRK_MEMORY_EMBED_URL` 外接向量 HTTP；token 勿入库；未接时走 embedded `~/.xrk/memory-embeddings` |
| GenUI npm allowlist | `genui-npm-bridge` | `XRK_GENUI_NPM_ALLOWLIST` 仅允许列出的包名；resolve 在 Host 侧，勿把 token 放进 schema |
| TongFlow Python | `tongflow-python-bridge` | `XRK_TONGFLOW_PYTHON*` 执行用户脚本；仅信任自运维路径；`~/.xrk/tongflow/python.json` 勿提交 |

## 明确未做（勿宣传）

| 项 | 状态 |
|----|------|
| MCP 统一 handleToolCall 门禁 | Client M0 + Host `XRK_MCP_*` 已有；**默认仍 deny** |
| 完整 policy 文件 schema | **v1 JSON 已有**；无热加载 / YAML |
| Ask / 审批 UI | `ask` → pipeline `onApproval`；无完整人工审批 UI 流 |
| TLS 终止 | 由反向代理负责 |
| Web DNS 再绑定 | 只拦字面量私网 host |
| 多租户鉴权 / RBAC | 单 key |
| 供应链 SBOM / 签名发布 | 见 publishing 路线 |

## 开发建议

1. 生产环境 **必须** 设置非空 `XRK_API_KEY`，并收紧 CORS。  
2. **勿**把 `{workspace}/.xrk/.credentials.yaml` 提交进 git。  
3. harness preset 默认挂 sandbox；minimal 无 shell——按威胁模型选型。  
4. 新增危险工具：先 guard / sandbox，再注册。  
5. 变更安全相关行为 → 更新本页 + 加锁测。

相关：[http-api.md](./http-api.md) · [tool-pipeline.md](./tool-pipeline.md) · [policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [status.md](./status.md)

---

# Security Checklist

> **Audience**: Integrators · Maintainers

Lists only controls **already implemented in this repository**; unfinished items are marked separately. Treat this as the baseline when extending; do not assume MCP connect is allowed by default.

## Existing controls

| Control | Location | Notes |
|------|------|------|
| API Key | `server-http` | `Authorization: Bearer` or `x-api-key`; empty `XRK_API_KEY` = auth off for development |
| CORS | `server-http` | `XRK_CORS_ORIGIN` (default `*`) |
| Rate limit | `server-http` | Per IP per minute (`XRK_RATE_LIMIT`) |
| Session busy | TurnLatch / drain join | One in-flight per session; busy may 409 or join |
| Tool denylist / policy engine | `@xrkseek/policy` | See [policy.md](./policy.md) |
| Write-intent | `createWriteIntentGuard` | Default: `apply_edit` requires prior `read_file` |
| Sandbox argv | `exec-sandbox` + guard | Workspace cwd + DenyList |
| Path jail | `exec-fs` `resolveWithinRoot` | Relative and workspace-absolute paths OK; rejects out-of-root and `..` escape |
| Web URL hygiene | `exec-web` `assertHttpUrl` | http(s) only, no credentials; literal private hosts; **no** DNS rebinding check |
| LSP paths | `exec-lsp` `resolveWithinRoot` | Query files must stay under `workspaceRoot` |
| PTY cwd | `exec-pty` `resolvePtyCwd` | cwd must stay under `workspaceRoot`; rejects `SIGKILL` on the shell itself |
| PTY native | `node-pty@1.2.0-beta.15` | NAPI prebuild; Win inspector is a no-op |
| Tool output bound | pipeline `bound` + persist | Large results spill to `.xrk/tool-outputs/` |
| Code worker | `code-runtime` | `run_code` in a worker (experimental) |
| Safety loop/mistake | `core-session` safety | soft/hard notice; may abort turn |
| Secrets not in repo | `.gitignore` + example templates | Only `*.example` in-tree |
| IM webhook ingress | `dsh-compat` `im-messaging-bridge` | `/api/im/{channel}/webhook` has no vendor secret check (dev integration); production should sit behind a reverse proxy with rate limits |
| IM gateway relay | `im-gateway-sidecar` | `/api/im/gateway/relay`: localhost only or `XRK_IM_GATEWAY_TOKEN`; set token in production |
| IM vendor WS | `im-vendor-ws-client` | `XRK_IM_GATEWAY_WS_URL` / inferred from `XRK_IM_GATEWAY_URL`; `XRK_IM_GATEWAY_TOKEN` auth; do not expose to browser |
| Memory embed sidecar | `memory-embeddings` | `XRK_MEMORY_EMBED_URL` external vector HTTP; do not commit tokens; falls back to embedded `~/.xrk/memory-embeddings` |
| GenUI npm allowlist | `genui-npm-bridge` | `XRK_GENUI_NPM_ALLOWLIST` limits package names; resolve runs on Host; do not put tokens in schema |
| TongFlow Python | `tongflow-python-bridge` | `XRK_TONGFLOW_PYTHON*` runs user scripts; trust only self-operated paths; do not commit `~/.xrk/tongflow/python.json` |

## Explicitly not shipped (do not advertise)

| Item | Status |
|----|------|
| Unified MCP handleToolCall gate | Client M0 + Host `XRK_MCP_*` exist; **still deny by default** |
| Full policy file schema | **v1 JSON exists**; no hot-reload / YAML |
| Ask / approval UI | `ask` → pipeline `onApproval`; no full human-approval UI flow |
| TLS termination | Reverse proxy responsibility |
| Web DNS rebinding | Only literal private hosts blocked |
| Multi-tenant auth / RBAC | Single key |
| Supply-chain SBOM / signed release | See publishing roadmap |

## Guidance

1. Production **must** set a non-empty `XRK_API_KEY` and tighten CORS.  
2. **Do not** commit `{workspace}/.xrk/.credentials.yaml`.  
3. harness preset mounts sandbox by default; minimal has no shell — choose by threat model.  
4. New dangerous tools: add guard / sandbox first, then register.  
5. Security behavior changes → update this page and add lock tests.

Related: [http-api.md](./http-api.md) · [tool-pipeline.md](./tool-pipeline.md) · [policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) · [status.md](./status.md)
