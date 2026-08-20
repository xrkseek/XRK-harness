# Architecture

> **读者**：集成者 · 贡献者 · 维护者。

宿主 **仅 TypeScript（Node ≥26）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

## 决策（ADR）

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 |
| [0002](./adr/0002-no-embed-upstream.md) | 内核本仓实现；外壳 MIT 二次创作（非 GitHub Fork） |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` |

## 文档分层

完整身份与写作标准见 [audiences.md](./audiences.md)。摘要：

| 层 | 形态 | 写什么 | 不写什么 |
|----|------|--------|----------|
| 根 README · `docs/*` · 包 README · ADR | **教科书** | 产品、契约、用法、能力边界 | 发版口令当用户 FAQ、Agent 红线 |
| [maintainer](./maintainer.md) · [publishing](./publishing.md) | 教科书（**维护者专章**） | 交接、发版 | 塞进根 README 正文 |
| [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills` | **笔记** | 角色、红线、改哪测哪 | 假 API 当规格 |
| Canvas（本机） | **草稿** | 对照 · 临时 TODO | 入库 |

依赖边见 [AGENTS.md](../AGENTS.md)。能力矩阵：[status.md](./status.md)。交接：[maintainer.md](./maintainer.md)。

## 包平面

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · apps/web（壳）· apps/console（验证台）              │
│  packages/client（壳客户端包底稿）                              │
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
│   ├── cli/                 # @xrkseek/harness-cli
│   ├── web/                 # 产品壳（二次创作源码；serve 用 dist/）
│   └── console/             # Face 验证台（?console=1；维护者工具，非产品入口）
├── packages/
│   ├── client/              # 壳客户端包（与 apps/web 成对）
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

会话持久化（Host `XRK_SESSIONS_DIR`）：`sessions.db`（WAL · schema v3 · 物理 `text-chunks` · FTS5 trigram）+ 旁路 `subagents.json` · `goals.json`。ZIP 导出 `toPackedJSONL` + `.jsonl.zst`。

Host agent-cache：根会话 Scope `agent:{id}`；Face 已登记父会话的子会话走 `openSubagentRealm`（`subagent:{id}`）。

Face 接线：`packages/server/face/src/wire/`。产品壳源码 `apps/web` + `packages/client`；serve 托管 `apps/web/dist`（先 `web:build` + `client:bundle` + `web:assemble`）。`apps/console` 仅作 Face 验证台。
