# Status（能力矩阵）

三态：**能跑 / 未稳 / 未做**。与代码对齐。基线 2026-08-19。

## 能跑（本地 / Host 主路径）

下面这些**现在就可以正常用**（`pnpm` 装好、`xrk-harness serve` / harness preset；有 `XRK_LLM_*` 或 replay）：

| 域 | 包 / 入口 | 规格 |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createJsonlSessionStore` + `XRK_SESSIONS_DIR`） | [session.md](./session.md) · [tool-pipeline.md](./tool-pipeline.md) |
| Exec / Workspace / Policy | `exec-*`（`web_*` · `lsp` · **`terminal_*`**）· `workspace`（inject · recipes · skill）· `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · `pty-send` · Face settle 通知 · Host 共享 + session 隔离 | [shell-jobs.md](./shell-jobs.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis UI/HMR；工具卡 · `session/jobs` · standing 冷 history；`ask_user`；`/permission` · `/plan` · `/compact` · `/export` · `/feedback`） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（`serve`/`web` 产品壳） | [apps/cli/README.md](../apps/cli/README.md) |
| LLM / Presets / SDK | `llm-*` · `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp`（stdio 有界重连）；Host `XRK_MCP_*` 或 Face `mcp.servers` 落盘 + 文件真源热挂载（默认 deny） | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) |
| Attachment / 插件 | Face 附件；进程插件 `tools` · `prompt` · `commands` | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |

**对齐 DSH 的口径（诚实）**：内核主路径已可当日常 harness 用；**不是** DSH 二百插件全集。产品壳 = `apps/web` + `packages/client`；serve 用 `apps/web/dist`，内核不嵌 Cordis。

## 未稳

| 域 | 说明 |
| --- | --- |
| Host Face ↔ 产品 Web | 首屏 RPC + 静态壳有测（`product-shell.test`）；Host-serve Playwright 硬刷欢迎窗 / 流式 / 工具卡 / 审批 / 提问 / inventory / Think / TodoDock / Access / Plan / plan-review / Session log 导出 / MCP 设置（`pnpm test:web`，13 绿，不进 `pnpm check`）；Face 冷 history 含 reasoning / standing 工具卡；DSH Cordis scaffold 金标 e2e 未搬 |
| 产品 Web | `pnpm web:build` + `client:bundle` + `web:assemble` → `apps/web/dist`（35 plugins，含 `client-session-log-export`；omit HMR / Cordis UI / native picker）；Host-serve `product-shell-*.e2e.ts` 全勾 |
| 保留插件 kind | `channel` / `policy` / `llm` 可发现、未自动接线；Cordis 宿主包只登记 stub |

## 未做

| 域 | 说明 |
| --- | --- |
| Registry R1+ | 官方协议包（Anthropic / Gemini / Responses） |
| MCP 产品面 | HTTP 进程级 supervisor（stdio 有界重连 + Face 落盘 + 文件真源 mutate 热挂载 + Plugins 卡已接） |
| DSH 插件长尾 | Cordis scaffold 金标 e2e、SQLite FTS、Cordis remote-event inspect/run、真 Win process-inspector 等 —— 对照笔记进 Canvas，不写成产品路线 |

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

外壳二次创作：`apps/web` + `packages/client`。品牌：`apps/web/public`。serve 用 `apps/web/dist`（`web:build` + `client:bundle` + `web:assemble`；gitignore）。不是 GitHub Fork；无 vendor 联接；Cordis 薄栈在 `packages/cordis*`。内核不嵌 Cordis Host。见 [AGENTS.md](../AGENTS.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)。

[learn.md](./learn.md) · [modules/](./modules/README.md)
