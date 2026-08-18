# Status（能力矩阵）

三态：**能跑 / 未稳 / 未做**。与代码对齐。基线 2026-08-18。

## 能跑

| 域 | 包 / 入口 | 规格 |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createJsonlSessionStore` + `XRK_SESSIONS_DIR`） | [session.md](./session.md) · [tool-pipeline.md](./tool-pipeline.md) |
| Exec / Workspace / Policy | `exec-*` · `workspace` · `policy` | [seams.md](./seams.md) · [policy.md](./policy.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis 客户端与 HMR；Face Cordis RPC 仍空 inventory；`GET/HEAD /api/session.export`；`host.pickDirectory` 系统选目录；工具卡 presenter lookup + `session/jobs`；standing 工具表冷 history；host 流 session-added 带子会话字段 / workspace-removed / order-changed / `host/remote-event`；`question/requested` + `ask_user`；`todos` · `permissions` · `plan` 投影；`/permission` · `/plan` 真改 knobs；`/compact` 写 `context/compaction`；`settings.describe` mcp 只读 inventory） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（`serve`/`web` 产品壳；默认 JSONL `{workspace}/.xrk/sessions`） | [apps/cli/README.md](../apps/cli/README.md) · [http-api.md](./http-api.md) |
| LLM replay / OpenAI 兼容 / Registry R0 | `llm-*`（SSE `reasoning-delta`/`text-delta`；openai-chat 非 DeepSeek 品牌可走图；`llm.discoverModels` → GET `/models`） | [llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) |
| Presets / SDK | `presets/*` · `@xrkseek/harness` | [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp` stdio + streamable-http；Host `XRK_MCP_*`（默认 deny）；HTTP 可传 SDK `reconnectionOptions`（SSE 恢复）；`tools/list_changed` 热同步 | [policy.md](./policy.md) · [modules/mcp.md](./modules/mcp.md) |
| Attachment / 视觉 | `@xrkseek/attachment` + Face `session.attachment`；Host Face `text+image`；适配器无 `image` 仍拒 | [host-face.md](./host-face.md) |
| 进程插件 | `tools` · `prompt` · `commands` 已接线 | [plugin-loader.md](./plugin-loader.md) |

## 未稳

| 域 | 说明 |
| --- | --- |
| Host Face ↔ 产品 Web | 首屏 RPC + 静态壳有测（`product-shell.test.ts`）；浏览器硬刷 thinking / 工具卡仍未勾 |
| 产品 Web | 捕获壳 GET `/` 注入 boot；plugin JS 200；流式 / 工具卡浏览器硬刷未验收 |
| 保留插件 kind | `channel` / `policy` / `llm` 可发现、未自动接线；Cordis 宿主包只登记 stub |

## 未做

| 域 | 说明 |
| --- | --- |
| Registry R1+ | 官方协议包（Anthropic / Gemini / Responses） |
| MCP 产品面 | Face MCP 设置 UI · 进程级 supervisor（`tools/list_changed` 与 HTTP SSE 恢复已接） |

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

外壳（`apps/web-static`）可复用 DSH 捕获；内核不嵌 Cordis。见 [AGENTS.md](../AGENTS.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)。

[learn.md](./learn.md) · [modules/](./modules/README.md)
