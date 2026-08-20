# 维护者交接

> **读者**：维护者（仓库所有者 / 即将接手的人）。

把「能跑的产品」交给下一个人时，按本页核对。细节契约仍在各教科书专题；改码红线在 [AGENTS.md](../AGENTS.md)。

## 30 分钟上手

| 步 | 做什么 | 文档 |
|----|--------|------|
| 1 | 认身份与文档分层 | [audiences](./audiences.md) · [docs/README](./README.md) |
| 2 | 看什么能正式依赖 | [status](./status.md) |
| 3 | 本机跑通源码 + 壳 | [getting-started](./getting-started.md) 路径 B |
| 4 | 门禁绿 | [testing](./testing.md) · `pnpm check` |
| 5 | 发版怎么打 | [publishing](./publishing.md) |
| 6 | 包边界与依赖忌口 | [architecture](./architecture.md) · [AGENTS](../AGENTS.md) |

## 仓库真相

| 项 | 事实 |
|----|------|
| 对外发包 | 主要是 **`@xrkseek/harness-cli`**（含 `product-web/`） |
| 其余 `@xrkseek/*` | 多数 **private**（workspace）；勿当已 npm 公开 SDK 对外承诺 |
| 产品壳 | `apps/web` + `packages/client` → 组装进 CLI；**不是** deepseek-ai Fork，勿向上游提 PR |
| 会话 / 设置 | 用户机 `~/.xrk/` 或 workspace `.xrk/`（gitignore）；仓内只有 `*.example` |
| 能力三态 | **能跑 / 未稳 / 未做** — 只以 [status](./status.md) 对外说话 |

## 日常命令

```bash
npm install -g pnpm@11.22.0   # 与 package.json → packageManager 对齐
pnpm install
pnpm check                 # tsc · eslint · vitest · kernel coverage
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
pnpm test:web              # 产品壳硬刷；不进 check
```

发版：`pnpm release:stage` / `pnpm release` — 见 [publishing](./publishing.md)。

## 改什么同步什么

与 [CONTRIBUTING](../CONTRIBUTING.md) 一致，交接时尤其盯：

| 改动 | 同步 |
|------|------|
| SessionEvent / HTTP | `session*.md` · `http-api.md` · protocol |
| 工具管道 / settle | `tool-*.md` |
| Preset | `profiles.md` · preset README |
| 能否依赖 | **必须** `status.md` |
| Meter / compaction | `session-compaction.md` · `protocol-events.md` · 笔记 skill `xrk-meter-session` |

未实现：只改 status「未做」，禁止写假 API。

## 密钥与安全

- 永不提交：`.credentials.yaml` · `settings.yaml` · `.env` 真值  
- 模板：`.xrk/*.example` · `.env.example`  
- 清单：[security-checklist](./security-checklist.md) · [policy](./policy.md)

## 文档与笔记（勿混）

| 放哪儿 | 内容 |
|--------|------|
| `docs/` · 根 README | 用户 / 集成能读的事实 |
| `docs/maintainer.md` · `publishing.md` | 维护者流程 |
| `AGENTS.md` · `.cursor/rules` · `.cursor/skills` | 改码红线、Agent 流程 |
| Canvas | 本机路径、对照仓体量 — **不入库** |

标准：[audiences](./audiences.md)。

## 域地图（找人 / 找码）

| 域 | 教科书 | 包落点 |
|----|--------|--------|
| Session / 压缩 | [session](./session.md) · [session-compaction](./session-compaction.md) | `packages/core/session` · `agent-loop` |
| Face / HTTP | [host-face](./host-face.md) · [http-api](./http-api.md) | `packages/server/face` · `http` · `host` |
| MCP | [modules/mcp](./modules/mcp.md) | `packages/mcp` |
| LLM | [llm-provider-registry](./llm-provider-registry.md) | `packages/llm/*` |
| 壳 | [host-face](./host-face.md) | `apps/web` · `packages/client` |
| 全包索引 | [modules/](./modules/README.md) | |

## 交接检查清单

- [ ] 继任者本机 Node ≥26；`npm install -g pnpm@…` 与根 `packageManager` 一致  

- [ ] 读过 status「能跑 / 未稳 / 未做」，不对外承诺未做项  
- [ ] `pnpm check` 绿；知道 `test:web` 单独跑  
- [ ] 会按 publishing 打 Release / Packages（或明确谁有 token）  
- [ ] 知道密钥只在本机、example 在仓内  
- [ ] 知道 Cordis / DSH 对照只在 Canvas，不进 docs 当路线图  
- [ ] 重大决策有 ADR；发行说明在 `docs/releases/`  

## 相关

[CONTRIBUTING](../CONTRIBUTING.md) · [AGENTS](../AGENTS.md) · [publishing](./publishing.md) · [architecture](./architecture.md) · [releases/](./releases/)
