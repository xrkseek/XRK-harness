# Architecture

宿主 **仅 TypeScript（Node ≥26）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

## 决策（ADR）

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 |
| [0002](./adr/0002-no-embed-upstream.md) | 内核本仓实现；外壳可复用 DSH Web 捕获 |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` |

## 文档分层

| 层 | 写什么 | 不写什么 |
|----|--------|----------|
| [status.md](./status.md) | 能跑 / 未稳 / 未做 | 对照仓路径、本机笔记 |
| `docs/*.md` | 已实现契约（HTTP · Face · session · 工具） | 未做路线清单当规格 |
| [modules/](./modules/README.md) | 大包文件地图 | 教 Agent 怎么读文档 |
| 包 README | 该包职责与导出 | 全仓战略 |
| Canvas（本机） | 对照 · 体量 · 目录打磨 | 不入库 |

依赖边见 [AGENTS.md](../AGENTS.md)。能力矩阵：[status.md](./status.md)。

## 包平面

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · apps/web · apps/web-static（产品壳捕获）     │
├─────────────────────────────────────────────────────────┤
│  presets: minimal | harness | server   ← 只组合，无业务  │
│  @xrkseek/harness (sdk)                                  │
├─────────────────────────────────────────────────────────┤
│  server-host / http / face / config / loader             │
├──────────────┬──────────────────┬───────────────────────┤
│ core-agent   │ core-agent-loop  │ core-tools            │
│ core-session │ system-prompt    │ workspace · policy    │
├──────────────┴──────────────────┴───────────────────────┤
│  llm · exec-* · code-runtime · compose · mcp · attachment │
├─────────────────────────────────────────────────────────┤
│  kernel · protocol                                       │
└─────────────────────────────────────────────────────────┘
```

## 仓库树（与落盘对齐）

33 个 `@xrkseek/*` 库包。改路径先改本树与 [status.md](./status.md)，再改代码。

```text
XRK-harness/
├── apps/
│   ├── cli/                 # @xrkseek/harness-cli · run / serve
│   ├── web/                 # Face console（?console=1）
│   └── web-static/          # 产品聊天壳（DSH Web 捕获）
├── packages/
│   ├── kernel/ · protocol/ · compose/
│   ├── core/{agent,agent-loop,tools,session,system-prompt}/
│   ├── llm/{llm,openai-compatible,deepseek,replay,registry}/
│   ├── mcp/ · attachment/
│   ├── exec/{fs,subprocess,shell,sandbox,web,lsp,pty}/
│   ├── workspace/ · policy/ · code-runtime/ · web-runtime/
│   ├── server/{http,loader,host,config,face}/
│   ├── sdk/ · testkit/
│   └── …
├── presets/{minimal,harness,server}/
├── extensions/              # 进程插件样例（tools / channels）
├── templates/office-agent/  # workspace.syncSeeds 种子
├── examples/hello-agent/
├── docs/                    # 规格真源；无 docs/learn/ 目录
└── scripts/
```

JSONL 会话目录（Host `XRK_SESSIONS_DIR`）：`{id}.jsonl` + 旁路 `subagents.json` · `goals.json`。hydrate 丢掉末行不完整 JSON 或末行 schema 失败并原子回写。

Host agent-cache：根会话 Scope `agent:{id}`；Face 已登记父会话的子会话走 `openSubagentRealm`（`subagent:{id}`）。

Face 接线：`packages/server/face/src/wire/`（信封 · 路径 · respond）；RPC 表：`dispatch.ts`（点号 unary + Typert Remote + `goal.*` 别名 + Cordis 空 inventory）+ `GET/HEAD /api/session.export`。产品壳：`apps/web-static`（`xrk-harness serve` / `web` 按 CLI 包定位，不跟用户 `--workspace`）。
