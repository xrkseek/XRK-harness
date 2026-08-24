# Status（能力矩阵） / Capability Matrix

> **读者 / Audience**：全员 / Everyone（对外说话以本页为准 / Product capability truth）

三态：**能跑 / 未稳 / 未做**（Working / Unstable / Not done）。与代码对齐。基线 **v0.1.0**（正式公开线唯一版本；**`user/message.messageId`** Face 行 id，同 turn durable inject 不挤掉对话）。

Three states: **Working / Unstable / Not done**. Aligned with code. Baseline **v0.1.0** (sole formal public release; Face row id via **`user/message.messageId`**; same-turn durable injects do not collapse the conversation).

**AI 调用链路**（maxSteps · prune/soft-compact · reasoning passback · max-tokens keep/drop · EMPTY/未知 finish/残缺 tool · derive 跳过空 assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP 分类（含 gemini / openai-responses）· 步内 llm/retry（Face 可调）· TOOL_NOT_STARTED/OUTCOME_UNKNOWN/ABORTED_BEFORE_DISPATCH/`ABORTED` · isConcurrencySafe settle（只读工具已标）· tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · 取消 `AgentCancelCause` · 同轮 retry 耗尽后仍显示 turn-error · **DeepSeek vision-exp catalog** · **session-projection 状态/视图分离** · **durable workspace inject**）已跟至同基线。

## 能跑（本地 / Host 主路径） / Working (local / Host main path)

下面这些**现在就可以正常用**（`pnpm` 装好、`xrkh serve` / harness preset；有 `XRK_LLM_*` 或 replay）：

These are **ready to use now** (`pnpm` installed, `xrkh serve` / harness preset; with `XRK_LLM_*` or replay):

| 域 / Domain | 包 / 入口 / Package · entry | 规格 / Spec |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`） | [session.md](./session.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session 投影（状态/视图） | `@xrkseek/session-projection`；Face 默认单元 + mux / history | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) |
| Exec / Workspace / Policy | `exec-*`（`web_*` · `lsp` · **`terminal_*`**）· `workspace`（**durable inject** · recipes · skill · **layers**）· `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · `pty-send` · Face settle 通知 · Host 共享 + session 隔离 | [shell-jobs.md](./shell-jobs.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis UI/HMR；工具卡 · `session/jobs` · standing 冷 history；`ask_user`；`/permission` · `/plan` · `/compact` · `/export` · `/feedback`） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（主 bin **`xrkh`**；`web`/`serve`；`restart`=停本机 XRK Host；`--force` 仅杀已识别 Host） | [apps/cli/README.md](../apps/cli/README.md) · [plugin-development](./plugin-development.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1（openai-chat / completions 别名 · anthropic-messages · openai-responses · gemini-generate）· Face 手写 `llm-pi-ai` 路由（Custom provider）· `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp`（stdio/HTTP 有界进程重连 + SSE；有序 content 投影；可选 image → AttachmentStore）；Host `XRK_MCP_*` 或 Face `mcp.servers` + `allowConnect` 落盘热挂载（policy deny → **park**） | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) |
| Attachment / 插件 | Face 附件；进程插件 `tools` · `prompt` · `commands` · **`host`**；CLI 用户插件目录 + 客户端 `web/` 叠加；**社区 client** 免补 `xrk.host.json`（能力表 + `client.js` 扫描 + 约定 infer，见 [plugin-loader](./plugin-loader.md)） | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| 社区插件 Host（自研兼容器） | `extensions/dsh-compat` + bridge（子进程 apply · IM · 任务流节点 · GenUI · vision · 移动访问）；fixture 见 [community-plugins](./community-plugins.md) | [community-plugins.md](./community-plugins.md) · [ADR-0002](./adr/0002-no-embed-upstream.md) |

产品壳 = `apps/web` + `packages/client`；serve 用组装后的 dist / CLI `product-web/`。欢迎词与 Hero 标语为 XRK 自有（**向阳而生，驭光而行**；非上游营销体）。

## 正式使用 / Formal use levels

| 层级 / Level | 能做什么 / What you can do | 前置 / Prerequisites |
| --- | --- | --- |
| **A — 能用** | `npx @xrkseek/harness-cli` 或源码 `build` + 组装壳后 `web`/`run`；**v0.1.0** 首个公开发版 | Node ≥26；真模型需 brand `apiKeyEnv` 或 replay |
| **B — 浏览器硬刷** | `pnpm test:web`（不进 `pnpm check`） | Chromium；完整 `apps/web/dist` |
| **C — 上架** | npmjs + GitHub Release（`@xrkseek/harness-cli`） | `pnpm release`；见 [publishing.md](./publishing.md) |

入门：[getting-started.md](./getting-started.md) · 配置：[configuration.md](./configuration.md) · 排障：[troubleshooting.md](./troubleshooting.md)。

## 未稳 / Unstable

| 域 / Domain | 说明 / Notes |
| --- | --- |
| Host Face ↔ 产品 Web | 首屏 RPC（含 `settings.describe`）+ Context meter（`tokenUsage` / `contextPressure` / `contextBreakdown`；compaction 可带 `shadowedTokenCount`）+ 静态壳有测（`product-shell.test`）；Host-serve Playwright 硬刷欢迎窗 / 流式 / **stream aria golden** / 取消 / 工具卡 / 审批 / 提问 / inventory / Think / TodoDock / Access / Plan / plan-review / Session log 导出 / MCP 设置（`pnpm test:web`，不进 `pnpm check`）；Face 冷 history 含 reasoning / standing 工具卡；Cordis scaffold 全家桶未搬 |
| 产品 Web | `pnpm web:build` + `client:bundle` + `web:assemble` → `apps/web/dist`（37 plugins，含 `client-ui-reference` · `client-session-log-export`；omit HMR / Cordis UI / native picker）；Face `@file` / `@session` 发现 remotes 已接；跨会话 prepare 未接 Face 主路径；Host-serve `product-shell-*.e2e.ts` 全勾 |
| 保留插件 kind | `channel` / `policy` / `llm` 可发现、未自动接线；需 `host.mjs` 的社区宿主包走兼容器 stub / fiber |

## 未做 / Not Done

| 域 / Domain | 说明 / Notes |
| --- | --- |
| IM 长连接网关 / IM long-lived gateway | 当前 webhook / 短请求；厂商云端长会话可后续自研或外接 / Webhook and short requests today; cloud sessions are planned |
| 任务流外部运行时 / External task runtime | 内置 TS 节点已可用；绑定第三方 Python 发行版另议 / Built-in TS nodes work; vendor Python runtimes are optional later |
| 云端 Vision / 记忆 embedding / Cloud Vision & embeddings | 本地 OCR · keyword 已可用；云端路由与向量宿主待补 / Local OCR and keyword search work; cloud routing and vector hosts are planned |

## 依赖纪律 / Dependency discipline

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

外壳二次创作：`apps/web` + `packages/client`。品牌：`apps/web/public`。serve 用 `apps/web/dist`（`web:build` + `client:bundle` + `web:assemble`；gitignore）。不是 GitHub Fork。社区 client 经自研兼容器接入（见 [ADR-0002](./adr/0002-no-embed-upstream.md) · [community-plugins](./community-plugins.md)）。

The product shell is a second-creation surface (`apps/web` + `packages/client`). Brand assets live under `apps/web/public`. `serve` uses `apps/web/dist`. This is not a GitHub Fork. Community clients attach through the first-party Host adapter ([ADR-0002](./adr/0002-no-embed-upstream.md) · [community-plugins](./community-plugins.md)).

[learn.md](./learn.md) · [modules/](./modules/README.md)
