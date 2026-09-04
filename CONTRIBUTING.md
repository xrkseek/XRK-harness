# 贡献指南

> **读者**：贡献者 · 维护者

维护与提 PR 时遵循 [AGENTS.md](./AGENTS.md)。切片完成定义：**代码 + 测试 +（若改契约）教科书同步 + `pnpm check` 绿**。

身份与文档分层：[docs/audiences.md](./docs/audiences.md)。整仓交接：[docs/maintainer.md](./docs/maintainer.md)。

## 环境

- Node ≥ 26（`.nvmrc` / `engines`）
- pnpm：与根 `package.json` 的 `packageManager` 同版（当前 **11.22.0**）：

```bash
node -v                          # ≥ v26
npm install -g pnpm@11.22.0      # 勿用 Corepack
pnpm -v                          # 11.22.0
pnpm install
pnpm check
```

CI 的 `pnpm/action-setup` 读同一 `packageManager` 字段。

首次跑通见 [docs/getting-started.md](./docs/getting-started.md) 路径 B。

**勿提交密钥**：`.xrk/.credentials.yaml`、`.xrk/settings.yaml`、`.env` 已在 `.gitignore`；仓内只保留 `.xrk/*.example` 与 `.env.example`。若误提交，轮换 key 并重写未推送历史。

## `pnpm check` 做什么

见 [docs/testing.md](./docs/testing.md)。顺序：

1. `tsc -b`  
2. `eslint .`  
3. `vitest run`  
4. kernel coverage ≥ 90%（`vitest.kernel.config.ts`）

不要用 `--no-verify` 跳过钩子。

## 依赖纪律

```text
apps → sdk / server / presets
sdk · server · presets → core* / llm / mcp / attachment / exec* / workspace / policy / compose
能力叶 · core* → kernel / protocol / compose
```

禁止：server → 具体 llm 适配；core-agent → exec 实现；extensions → apps 内部；presets 写业务逻辑；`kernel` → `compose`。

## 改契约时

| 改动 | 必须同步 |
|------|----------|
| SessionEvent / HTTP body | `docs/session*.md` · `docs/http-api.md` · protocol README |
| Tool 管道阶段 / settle | `docs/tool-*.md` |
| Preset 选项 | `docs/profiles.md` · `docs/workspace-inject.md` · preset README |
| 新能力是否可依赖 | `docs/status.md` |
| Meter / compaction | `docs/session-compaction.md` · `docs/protocol-events.md` |

空壳 / 未接线能力在实现前 **只** 更新 `docs/status.md`「未做」，勿写假 API。`@xrkseek/mcp` 已能跑；勿再当空壳。

新文档：中文半部 `> **读者**：…`；英文半部 `> **Audience**: …`（见 [audiences](./docs/audiences.md)）。正文**整篇先中后英**。不要把 Agent 红线写进用户说明书。

## 扩展常见路径

1. **工具**：`createToolRegistry` + `ToolDefinition`；IO 走 `@xrkseek/exec-*` Provider。  
2. **守卫**：`pipeline.onGuard`（单调）；可选 `policy` → `createPolicyToolPre`。  
3. **Preset**：组合现有包；参考 `presets/minimal/preset.ts`。  
4. **插件**：`extensions/*` + `kind: tools | prompt | commands`；host `XRK_PLUGINS_DIR`。  
5. **测例**：`packages/**/tests` · `presets/**/tests`；LLM 用 `@xrkseek/llm-replay`。  

示例：`extensions/example-tools`（见 [docs/plugin-loader.md](./docs/plugin-loader.md)）。

## Git

- 默认分支 `main`  
- 不要代提交，除非维护者明确要求  
- 密钥永不入库  

## 文档入口

| 目的 | 打开 |
|------|------|
| 身份与分层 | [docs/audiences.md](./docs/audiences.md) |
| 教科书索引 | [docs/README.md](./docs/README.md) |
| 能力诚实 | [docs/status.md](./docs/status.md) |
| 交接 / 发版 | [docs/maintainer.md](./docs/maintainer.md) · [docs/publishing.md](./docs/publishing.md) |
| 改码笔记 | [AGENTS.md](./AGENTS.md) |

本机对照进 Cursor Canvas，不进 `docs/`。

---

# Contributing

> **Audience**: Contributors · Maintainers

When maintaining or opening a PR, follow [AGENTS.md](./AGENTS.md). Slice definition of done: **code + tests + (if contracts change) textbook sync + green `pnpm check`**.

Audience and doc layering: [docs/audiences.md](./docs/audiences.md). Full-repo handoff: [docs/maintainer.md](./docs/maintainer.md).

## Environment

- Node ≥ 26 (`.nvmrc` / `engines`)
- pnpm: match root `package.json` → `packageManager` (currently **11.22.0**):

```bash
node -v                          # ≥ v26
npm install -g pnpm@11.22.0      # do not use Corepack
pnpm -v                          # 11.22.0
pnpm install
pnpm check
```

CI `pnpm/action-setup` reads the same `packageManager` field.

First green run: [docs/getting-started.md](./docs/getting-started.md) Path B.

**Do not commit secrets**: `.xrk/.credentials.yaml`, `.xrk/settings.yaml`, and `.env` are gitignored; the repo keeps `.xrk/*.example` and `.env.example` only. If leaked, rotate keys and rewrite unpushed history.

## What `pnpm check` runs

See [docs/testing.md](./docs/testing.md). Order:

1. `tsc -b`  
2. `eslint .`  
3. `vitest run`  
4. kernel coverage ≥ 90% (`vitest.kernel.config.ts`)

Do not skip hooks with `--no-verify`.

## Dependency discipline

```text
apps → sdk / server / presets
sdk · server · presets → core* / llm / mcp / attachment / exec* / workspace / policy / compose
capability leaves · core* → kernel / protocol / compose
```

Forbidden: server → concrete llm adapters; core-agent → exec implementations; extensions → apps internals; business logic in presets; `kernel` → `compose`.

## When contracts change

| Change | Must sync |
|--------|-----------|
| SessionEvent / HTTP body | `docs/session*.md` · `docs/http-api.md` · protocol README |
| Tool pipeline / settle | `docs/tool-*.md` |
| Preset options | `docs/profiles.md` · `docs/workspace-inject.md` · preset README |
| Dependability | `docs/status.md` |
| Meter / compaction | `docs/session-compaction.md` · `docs/protocol-events.md` |

Before implementing unwired capabilities, update `docs/status.md` **Not done** only — never fake APIs. `@xrkseek/mcp` is already Working; do not treat it as a stub.

New docs: Chinese half `> **读者**：…`; English half `> **Audience**: …` ([audiences](./docs/audiences.md)). Body text is **whole-document CN then EN**. Do not copy Agent red lines into end-user manuals.

## Common extension paths

1. **Tools**: `createToolRegistry` + `ToolDefinition`; IO via `@xrkseek/exec-*` Provider.  
2. **Guards**: `pipeline.onGuard` (monotonic); optional `policy` → `createPolicyToolPre`.  
3. **Preset**: compose existing packages; see `presets/minimal/preset.ts`.  
4. **Plugins**: `extensions/*` + `kind: tools | prompt | commands`; host `XRK_PLUGINS_DIR`.  
5. **Tests**: `packages/**/tests` · `presets/**/tests`; LLM via `@xrkseek/llm-replay`.  

Example: `extensions/example-tools` ([docs/plugin-loader.md](./docs/plugin-loader.md)).

## Git

- Default branch `main`  
- Do not commit on others’ behalf unless maintainers ask  
- Secrets never enter the repo  

## Doc entry points

| Goal | Open |
|------|------|
| Audiences | [docs/audiences.md](./docs/audiences.md) |
| Textbook index | [docs/README.md](./docs/README.md) |
| Capability truth | [docs/status.md](./docs/status.md) |
| Handoff · release | [docs/maintainer.md](./docs/maintainer.md) · [docs/publishing.md](./docs/publishing.md) |
| Coding notes | [AGENTS.md](./AGENTS.md) |

Local comparison notes go in Cursor Canvas, not into `docs/`.
