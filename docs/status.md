# Status（能力矩阵）

> **读者**：全员（对外说话以本页为准）

三态：**能跑 / 未稳 / 未做**。与代码对齐。基线 **v0.1.18**（当前正式公开线）。**本页主路径表当前均为能跑**；未稳/未做仅用于后续新增能力登记。

**AI 调用链路**（maxSteps · prune/soft-compact · **request soft-budget fail-closed** · **tool-result spill（默认 64KiB）** · Face `bash`/`agent-loop`/`workspace-inject` 可调（设置 → Plugins） · reasoning passback · max-tokens keep/drop · EMPTY/未知 finish/残缺 tool · derive 跳过空 assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP 分类（含 gemini / openai-responses）· 步内 llm/retry（Face 可调）· TOOL_NOT_STARTED/OUTCOME_UNKNOWN/ABORTED_BEFORE_DISPATCH/`ABORTED` · isConcurrencySafe settle（只读工具已标）· tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · 取消 `AgentCancelCause` · 同轮 retry 耗尽后仍显示 turn-error · **DeepSeek vision-exp catalog** · **session-projection 状态/视图分离** · **durable workspace inject**）已跟至同基线。

## 能跑（本地 / Host 主路径）

下面这些**现在就可以正常用**（`pnpm` 装好、`xrkh serve` / harness preset；有 LLM 密钥经 **设置 → 模型 / 凭据**，或 Host/CI 用 `XRK_LLM_*` / replay）：

| 域 | 包 / 入口 | 规格 |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`；**steer 可在 tool-step 边界 claim**） | [session.md](./session.md) · [session-delivery.md](./session-delivery.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session 投影（状态/视图） | `@xrkseek/session-projection`；Face 默认单元 + mux / history | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) |
| Exec / Workspace / Policy | `exec-*`（`web_*` · `lsp` · **`terminal_*`**）· `workspace`（**durable inject** · recipes · skill · **layers**）· `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · `pty-send` · Face settle 通知 · Host 共享 + session 隔离 | [shell-jobs.md](./shell-jobs.md) |
| 子代理委托 | 模型面 `subagent` · `list_agents` · `send_message` · `interrupt_agent`（深度≤3；系统提示 `tool:subagent`）；后台子代理 drain idle 向父 inbox 队列通知；Face `subagent.*` · Sidebar sidechat | [host-face.md](./host-face.md) · [session-delivery.md](./session-delivery.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis UI/HMR；工具卡 · `session/jobs` · standing 冷 history；`ask_user`；`/permission` · `/plan` · `/compact` · `/export` · `/feedback`） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（主 bin **`xrkh`**；`web`/`serve`；`restart`=停本机 XRK Host；`--force` 仅杀已识别 Host） | [apps/cli/README.md](../apps/cli/README.md) · [plugin-development](./plugin-development.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1（openai-chat / completions 别名 · anthropic-messages · openai-responses · gemini-generate）· Face 手写 `llm-pi-ai` 路由（Custom provider）· `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp`（stdio/HTTP 有界进程重连 + SSE；有序 content 投影；可选 image → AttachmentStore）；Host `XRK_MCP_*` 或 Face `mcp.servers` + `allowConnect` 落盘热挂载（policy deny → **park**） | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) |
| Attachment / 插件 | Face 附件；进程插件 `tools` · `prompt` · `commands` · **`host`** · **`channel`** · **`policy`** · **`llm`**；CLI 用户插件目录 + 客户端 `web/` 叠加；Host `wireComposition*` 自动接线；**社区 client** 免补 `xrk.host.json`（能力表 + `client.js` 扫描 + 约定 infer，见 [plugin-loader](./plugin-loader.md)） | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| 社区插件 Host | `extensions/dsh-compat` + bridge；Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** · **`processChannels/list`**；IM WS/sidecar · Vision 全路由 · embedded 向量 · GenUI npm · TongFlow Python；`xrkh doctor` · boot 自动接线 | [community-plugins.md](./community-plugins.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md) · [ADR-0007](./adr/0007-taskflow-external-runtime.md) |
| 产品 Web | `apps/web` + `packages/client`；dist 组装 · `@file`/`@session` · 跨会话 prepare · Playwright **17/17**（`pnpm test:web`） | [host-face.md](./host-face.md) · [testing.md](./testing.md) · Cordis UI/HMR 仅 `pnpm dev:web` 开发路径 |

产品壳 = `apps/web` + `packages/client`；`serve` 用组装后的 dist / CLI `product-web/`。Hero 标语：**向阳而生，驭光而行**。

## 正式使用

| 层级 | 能做什么 | 前置 |
| --- | --- | --- |
| **A — 能用** | `npm i -g @xrkseek/harness-cli` 后 `xrkh web`/`run`，或源码 `build` + 组装壳后跑；**v0.1.18** 当前正式公开发版 | Node ≥26；真模型需 brand `apiKeyEnv` 或 replay |
| **B — 浏览器硬刷** | `pnpm test:web`（不进 `pnpm check`） | Chromium；完整 `apps/web/dist` |
| **C — 上架** | npmjs + GitHub Release（`@xrkseek/harness-cli`） | `pnpm release`；见 [publishing.md](./publishing.md) |

入门：[getting-started.md](./getting-started.md) · 配置：[configuration.md](./configuration.md) · 排障：[troubleshooting.md](./troubleshooting.md)。

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

产品壳：`apps/web` + `packages/client`。品牌资源：`apps/web/public`。`serve` 用 `apps/web/dist`（`web:build` + `client:bundle` + `web:assemble`；gitignore）。社区 client 经 Host 适配器 `extensions/dsh-compat` 接入（见 [community-plugins](./community-plugins.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)）。

[learn.md](./learn.md) · [modules/](./modules/README.md)

---

# Status (Capability Matrix)

> **Audience**: Everyone (this page is the public capability truth)

Three states: **Working / Unstable / Not done**. Aligned with code. Baseline **v0.1.18** (current formal public line). **Main-path rows on this page are Working today**; Unstable/Not done are reserved for newly tracked gaps.

**AI call path** (maxSteps · prune/soft-compact · **request soft-budget fail-closed** · **tool-result spill (default 64KiB)** · Face-tunable `bash` / `agent-loop` / `workspace-inject` (Settings → Plugins) · reasoning passback · max-tokens keep/drop · EMPTY / unknown finish / incomplete tool · derive skips empty assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP classification (incl. gemini / openai-responses) · in-step llm/retry (Face-tunable) · TOOL_NOT_STARTED / OUTCOME_UNKNOWN / ABORTED_BEFORE_DISPATCH / `ABORTED` · isConcurrencySafe settle (read-only tools marked) · tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · cancel `AgentCancelCause` · turn-error still shown after same-turn retry exhaustion · **DeepSeek vision-exp catalog** · **session-projection state/view split** · **durable workspace inject**) is tracked to the same baseline.

## Working (local / Host main path)

These are **ready to use now** (`pnpm` installed, `xrkh serve` / harness preset; LLM keys via **Settings → Models / Credentials**, or Host/CI `XRK_LLM_*` / replay):

| Domain | Package · entry | Spec |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`; Host sub-session `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*` (`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`; **steer can claim at tool-step boundary**) | [session.md](./session.md) · [session-delivery.md](./session-delivery.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session projection (state/view) | `@xrkseek/session-projection`; Face default unit + mux / history | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) |
| Exec / Workspace / Policy | `exec-*` (`web_*` · `lsp` · **`terminal_*`**) · `workspace` (**durable inject** · recipes · skill · **layers**) · `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · `pty-send` · Face settle notify · Host shared + session isolation | [shell-jobs.md](./shell-jobs.md) |
| Subagent delegation | Model surface `subagent` · `list_agents` · `send_message` · `interrupt_agent` (depth ≤3; system prompt `tool:subagent`); background subagent drain-idle queues parent inbox notify; Face `subagent.*` · Sidebar sidechat | [host-face.md](./host-face.md) · [session-delivery.md](./session-delivery.md) |
| HTTP + Host + Face main path | `server-*` (product boot omits Cordis UI/HMR; tool cards · `session/jobs` · standing cold history; `ask_user`; `/permission` · `/plan` · `/compact` · `/export` · `/feedback`) | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli` (primary bin **`xrkh`**; `web`/`serve`; `restart` stops local XRK Host; `--force` kills only recognized Host) | [apps/cli/README.md](../apps/cli/README.md) · [plugin-development](./plugin-development.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1 (openai-chat / completions alias · anthropic-messages · openai-responses · gemini-generate) · Face handwritten `llm-pi-ai` routes (Custom provider) · `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp` (stdio/HTTP bounded process reconnect + SSE; ordered content projection; optional image → AttachmentStore); Host `XRK_MCP_*` or Face `mcp.servers` + `allowConnect` file-backed hot-mount (policy deny → **park**) | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) |
| Attachment / plugins | Face attachments; process plugins `tools` · `prompt` · `commands` · **`host`** · **`channel`** · **`policy`** · **`llm`**; CLI user plugin dir + client `web/` overlay; Host `wireComposition*` auto-wiring; **community clients** need no `xrk.host.json` (capability table + `client.js` scan + convention infer — [plugin-loader](./plugin-loader.md)) | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| Community plugin Host | `extensions/dsh-compat` + bridge; Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** · **`processChannels/list`**; IM WS/sidecar · full-route vision · embedded vectors · GenUI npm · TongFlow Python; `xrkh doctor` · boot auto-wiring | [community-plugins.md](./community-plugins.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md) · [ADR-0007](./adr/0007-taskflow-external-runtime.md) |
| Product Web | `apps/web` + `packages/client`; dist assembly · `@file`/`@session` · cross-session prepare · Playwright **17/17** (`pnpm test:web`) | [host-face.md](./host-face.md) · [testing.md](./testing.md) · Cordis UI/HMR dev-only via `pnpm dev:web` |

Product shell = `apps/web` + `packages/client`; `serve` uses assembled dist / CLI `product-web/`. Hero slogan: **向阳而生，驭光而行**.

## Formal use levels

| Level | What you can do | Prerequisites |
| --- | --- | --- |
| **A — Usable** | `npm i -g @xrkseek/harness-cli` then `xrkh web`/`run`, or source `build` + assembled shell; **v0.1.18** is the current formal public release | Node ≥26; live models need brand `apiKeyEnv` or replay |
| **B — Browser soak** | `pnpm test:web` (not part of `pnpm check`) | Chromium; full `apps/web/dist` |
| **C — Publish** | npmjs + GitHub Release (`@xrkseek/harness-cli`) | `pnpm release`; see [publishing.md](./publishing.md) |

Getting started: [getting-started.md](./getting-started.md) · Configuration: [configuration.md](./configuration.md) · Troubleshooting: [troubleshooting.md](./troubleshooting.md).

## Dependency discipline

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / capability leaves → kernel | protocol | compose
```

Product shell: `apps/web` + `packages/client`. Brand assets: `apps/web/public`. `serve` uses `apps/web/dist` (`web:build` + `client:bundle` + `web:assemble`; gitignored). Community clients attach via Host adapter `extensions/dsh-compat` ([community-plugins](./community-plugins.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)).

[learn.md](./learn.md) · [modules/](./modules/README.md)
