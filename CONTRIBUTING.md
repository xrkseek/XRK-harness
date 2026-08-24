# 贡献指南 / Contributing

> **读者 / Audience**：贡献者 · 维护者 / Contributors · Maintainers

维护与提 PR 时遵循 [AGENTS.md](./AGENTS.md)。切片完成定义：**代码 + 测试 +（若改契约）教科书同步 + `pnpm check` 绿**。

When maintaining or opening a PR, follow [AGENTS.md](./AGENTS.md). Slice definition of done: **code + tests + (if contracts change) textbook sync + green `pnpm check`**.

身份与文档分层：[docs/audiences.md](./docs/audiences.md)。整仓交接：[docs/maintainer.md](./docs/maintainer.md)。

Audience and doc layering: [docs/audiences.md](./docs/audiences.md). Full-repo handoff: [docs/maintainer.md](./docs/maintainer.md).

## 环境 / Environment

- Node ≥ 26（`.nvmrc` / `engines`）
- pnpm：与根 `package.json` 的 `packageManager` 同版（当前 **11.22.0**）。推荐 / Recommended：

```bash
node -v                          # ≥ v26; if older, put system Node first on PATH
npm install -g pnpm@11.22.0      # do not use Corepack
pnpm -v                          # 11.22.0
pnpm install
pnpm check
```

CI 的 `pnpm/action-setup` 读同一 `packageManager` 字段。 / CI `pnpm/action-setup` reads the same `packageManager` field.

首次跑通见 [docs/getting-started.md](./docs/getting-started.md) 路径 B。 / First green run: [docs/getting-started.md](./docs/getting-started.md) Path B.

**勿提交密钥 / Do not commit secrets**：`.xrk/.credentials.yaml`、`.xrk/settings.yaml`、`.env` 已在 `.gitignore`；仓内只保留 `.xrk/*.example` 与 `.env.example`。若误提交，轮换 key 并重写未推送历史。

## `pnpm check` 做什么 / What `pnpm check` runs

见 [docs/testing.md](./docs/testing.md)。顺序 / Order：

1. `tsc -b`（项目引用构建）  
2. `eslint .`  
3. `vitest run`（全仓单测）  
4. kernel coverage ≥ 90%（`vitest.kernel.config.ts`）

不要用 `--no-verify` 跳过钩子（若本地加了 hooks）。 / Do not skip hooks with `--no-verify`.

## 依赖纪律 / Dependency discipline

```text
apps → sdk / server / presets
sdk · server · presets → core* / llm / mcp / attachment / exec* / workspace / policy / compose
能力叶 · core* → kernel / protocol / compose
```

禁止：server → 具体 llm 适配；core-agent → exec 实现；extensions → apps 内部；presets 写业务逻辑；`kernel` → `compose`。

Forbidden: server → concrete llm adapters; core-agent → exec implementations; extensions → apps internals; business logic in presets; `kernel` → `compose`.

## 改契约时 / When contracts change

| 改动 / Change | 必须同步 / Must sync |
|------|----------|
| SessionEvent / HTTP body | `docs/session*.md` · `docs/http-api.md` · protocol README |
| Tool 管道阶段 / settle | `docs/tool-*.md` |
| Preset 选项 | `docs/profiles.md` · `docs/workspace-inject.md` · preset README |
| 新能力是否可依赖 | `docs/status.md` |
| Meter / compaction | `docs/session-compaction.md` · `docs/protocol-events.md` |

空壳 / 未接线能力在实现前 **只** 更新 `docs/status.md`「未做 / Not done」，勿写假 API。`@xrkseek/mcp` 已能跑（stdio · HTTP · `tools/list_changed` · 默认 deny）；勿再当空壳。

新文档文首加 `> **读者 / Audience**：… / …`（见 [audiences](./docs/audiences.md)）。正文采用正式中英双语。**不要**把 Agent 红线写进用户说明书。

New docs start with a bilingual audience line ([audiences](./docs/audiences.md)). Body text is formal Chinese–English. **Do not** copy Agent red lines into end-user manuals.

## 扩展常见路径 / Common extension paths

1. **工具 / Tools**：`createToolRegistry` + `ToolDefinition`；IO 走 `@xrkseek/exec-*` Provider。  
2. **守卫 / Guards**：`pipeline.onGuard`（单调）；可选 `policy` → `createPolicyToolPre`。  
3. **Preset**：组合现有包；参考 `presets/minimal/preset.ts`。  
4. **插件 / Plugins**：`extensions/*` + `kind: tools | prompt | commands`；host `XRK_PLUGINS_DIR` 自动接线。  
5. **测例 / Tests**：`packages/**/tests` · `presets/**/tests`；LLM 用 `@xrkseek/llm-replay`。  

示例扩展 / Example：`extensions/example-tools`（`example_ping`；见 [docs/plugin-loader.md](./docs/plugin-loader.md)）。

## Git

- 默认分支 `main` / Default branch `main`  
- **不要**代提交，除非维护者明确要求 / Do not commit on others’ behalf unless maintainers ask  
- Commit 勿带 Cursor co-author trailer / No Cursor co-author trailer  
- 密钥永不入库 / Secrets never enter the repo  
- 外壳是 MIT 二次创作，**不要**向 deepseek-ai 提 PR（见 [ADR-0002](./docs/adr/0002-no-embed-upstream.md)） / Product shell is MIT second creation; **do not** open PRs to deepseek-ai  

## 文档入口 / Doc entry points

| 目的 / Goal | 打开 / Open |
|------|------|
| 身份与分层 / Audiences | [docs/audiences.md](./docs/audiences.md) |
| 教科书索引 / Textbook index | [docs/README.md](./docs/README.md) |
| 能力诚实 / Capability truth | [docs/status.md](./docs/status.md) |
| 交接 / 发版 / Handoff · release | [docs/maintainer.md](./docs/maintainer.md) · [docs/publishing.md](./docs/publishing.md) |
| 改码笔记 / Coding notes | [AGENTS.md](./AGENTS.md) |

本机对照进 Cursor Canvas，不进 `docs/`。 / Local comparison notes go in Cursor Canvas, not into `docs/`.
