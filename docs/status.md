# Status（能力矩阵）

> **读者**：全员（对外说话以本页为准）。

三态：**能跑 / 未稳 / 未做**。与代码对齐。基线 2026-08-21（v0.0.7）；**AI 调用链路**（maxSteps · prune/soft-compact · reasoning passback · max-tokens keep/drop · EMPTY/未知 finish/残缺 tool · derive 跳过空 assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP 分类（含 gemini / openai-responses）· 步内 llm/retry（Face 可调）· TOOL_NOT_STARTED/OUTCOME_UNKNOWN/ABORTED_BEFORE_DISPATCH/`ABORTED` · isConcurrencySafe settle（只读工具已标）· tool-call stream + tool-call-chunks · concludesTurn 结轮**）已跟至同基线（对照 DSH `dsh-v0.1.0-rc.8`）。

## 能跑（本地 / Host 主路径）

下面这些**现在就可以正常用**（`pnpm` 装好、`xrk-harness serve` / harness preset；有 `XRK_LLM_*` 或 replay）：

| 域 | 包 / 入口 | 规格 |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`） | [session.md](./session.md) · [tool-pipeline.md](./tool-pipeline.md) |
| Exec / Workspace / Policy | `exec-*`（`web_*` · `lsp` · **`terminal_*`**）· `workspace`（inject · recipes · skill）· `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · `pty-send` · Face settle 通知 · Host 共享 + session 隔离 | [shell-jobs.md](./shell-jobs.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis UI/HMR；工具卡 · `session/jobs` · standing 冷 history；`ask_user`；`/permission` · `/plan` · `/compact` · `/export` · `/feedback`） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（`serve`/`web` 产品壳；`plugin add|remove|list|path` → `~/.xrk/plugins`） | [apps/cli/README.md](../apps/cli/README.md) · [plugin-loader](./plugin-loader.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1（openai-chat / completions 别名 · anthropic-messages · openai-responses · gemini-generate）· Face 手写 `llm-pi-ai` 路由（Custom provider）· `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp`（stdio/HTTP 有界进程重连 + SSE；有序 content 投影；可选 image → AttachmentStore）；Host `XRK_MCP_*` 或 Face `mcp.servers` + `allowConnect` 落盘热挂载（policy deny → **park**） | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) |
| Attachment / 插件 | Face 附件；进程插件 `tools` · `prompt` · `commands`；CLI 用户插件目录 + 客户端 `web/` 叠加 | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |

产品壳 = `apps/web` + `packages/client`；serve 用组装后的 dist / CLI `product-web/`；内核不嵌 Cordis。

## 正式使用

| 层级 | 能做什么 | 前置 |
| --- | --- | --- |
| **A — 能用** | `npx @xrkseek/harness-cli` 或源码 `build` + 组装壳后 `web`/`run` | Node ≥26；真模型需 brand `apiKeyEnv` 或 replay |
| **B — 浏览器硬刷** | `pnpm test:web`（不进 `pnpm check`） | Chromium；完整 `apps/web/dist` |
| **C — 上架** | GitHub Release + Packages（`@xrkseek/harness-cli`） | `pnpm release`；见 [publishing.md](./publishing.md) |

入门：[getting-started.md](./getting-started.md) · 配置：[configuration.md](./configuration.md) · 排障：[troubleshooting.md](./troubleshooting.md)。

## 未稳

| 域 | 说明 |
| --- | --- |
| Host Face ↔ 产品 Web | 首屏 RPC（含 `settings.describe`）+ Context meter（`tokenUsage` / `contextPressure` / `contextBreakdown`；compaction 可带 `shadowedTokenCount`）+ 静态壳有测（`product-shell.test`）；Host-serve Playwright 硬刷欢迎窗 / 流式 / **stream aria golden** / 取消 / 工具卡 / 审批 / 提问 / inventory / Think / TodoDock / Access / Plan / plan-review / Session log 导出 / MCP 设置（`pnpm test:web`，不进 `pnpm check`）；Face 冷 history 含 reasoning / standing 工具卡；Cordis scaffold 全家桶未搬 |
| 产品 Web | `pnpm web:build` + `client:bundle` + `web:assemble` → `apps/web/dist`（35 plugins，含 `client-session-log-export`；omit HMR / Cordis UI / native picker）；Host-serve `product-shell-*.e2e.ts` 全勾 |
| 保留插件 kind | `channel` / `policy` / `llm` 可发现、未自动接线；Cordis 宿主包只登记 stub |

## 未做

| 域 | 说明 |
| --- | --- |
| DSH 工具 API 薄缺口 | `ToolExecuteExtras.concludeTurn()` 回调（成功路径已支持返回 `concludesTurn`）；标准工具默认结轮策略未铺开 |
| DSH 插件长尾 | Cordis scaffold 全家桶、Cordis remote-event inspect/run、真 Win process-inspector、client 整包 resync、Azure deployment / Ollama 原生协议等 —— 对照笔记进 Canvas，不写成产品路线 |

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

外壳二次创作：`apps/web` + `packages/client`。品牌：`apps/web/public`。serve 用 `apps/web/dist`（`web:build` + `client:bundle` + `web:assemble`；gitignore）。不是 GitHub Fork；无 vendor 联接；Cordis 薄栈在 `packages/cordis*`。内核不嵌 Cordis Host。见 [AGENTS.md](../AGENTS.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)。

[learn.md](./learn.md) · [modules/](./modules/README.md)
