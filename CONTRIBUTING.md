# Contributing

> **读者**：贡献者 · 维护者。

维护与提 PR 时遵循 [AGENTS.md](./AGENTS.md)。切片完成定义：**代码 + 测试 +（若改契约）教科书同步 + `pnpm check` 绿**。

身份与文档分层：[docs/audiences.md](./docs/audiences.md)。整仓交接：[docs/maintainer.md](./docs/maintainer.md)。

## 环境

- Node ≥ 26（`.nvmrc` / `engines`）
- pnpm：与根 `package.json` 的 `packageManager` 同版（当前 **11.22.0**）。推荐：

```bash
node -v                          # 应 ≥ v26；若仍是旧版，调整 PATH 指向系统 Node
npm install -g pnpm@11.22.0      # 不要用 Corepack
pnpm -v                          # 11.22.0
pnpm install
pnpm check
```

CI 的 `pnpm/action-setup` 读同一 `packageManager` 字段。

首次跑通见 [docs/getting-started.md](./docs/getting-started.md) 路径 B。

**勿提交密钥**：`.xrk/.credentials.yaml`、`.xrk/settings.yaml`、`.env` 已在 `.gitignore`；仓内只保留 `.xrk/*.example` 与 `.env.example`。若误提交，轮换 key 并重写未推送历史。

## `pnpm check` 做什么

见 [docs/testing.md](./docs/testing.md)。顺序：

1. `tsc -b`（项目引用构建）  
2. `eslint .`  
3. `vitest run`（全仓单测）  
4. kernel coverage ≥ 90%（`vitest.kernel.config.ts`）

不要用 `--no-verify` 跳过钩子（若本地加了 hooks）。

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

空壳 / 未接线能力在实现前 **只** 更新 `docs/status.md`「未做」，勿写假 API。`@xrkseek/mcp` 已能跑（stdio · HTTP · `tools/list_changed` · 默认 deny）；勿再当空壳。

新文档文首加 `> **读者**：…`（见 [audiences](./docs/audiences.md)）。**不要**把 Agent 红线写进用户说明书。

## 扩展常见路径

1. **工具**：`createToolRegistry` + `ToolDefinition`；IO 走 `@xrkseek/exec-*` Provider。  
2. **守卫**：`pipeline.onGuard`（单调）；可选 `policy` → `createPolicyToolPre`。  
3. **Preset**：组合现有包；参考 `presets/minimal/preset.ts`。  
4. **插件**：`extensions/*` + `kind: tools | prompt | commands`；host `XRK_PLUGINS_DIR` 自动接线。  
5. **测例**：`packages/**/tests` · `presets/**/tests`；LLM 用 `@xrkseek/llm-replay`。  

示例扩展：`extensions/example-tools`（`example_ping`；见 [docs/plugin-loader.md](./docs/plugin-loader.md)）。

## Git

- 默认分支 `main`  
- **不要**代提交，除非维护者明确要求  
- Commit 勿带 Cursor co-author trailer  
- 密钥永不入库  
- 外壳是 MIT 二次创作，**不要**向 deepseek-ai / DSH 仓库提 PR（见 [ADR-0002](./docs/adr/0002-no-embed-upstream.md)）  

## 文档入口

| 目的 | 打开 |
|------|------|
| 身份与分层 | [docs/audiences.md](./docs/audiences.md) |
| 教科书索引 | [docs/README.md](./docs/README.md) |
| 能力诚实 | [docs/status.md](./docs/status.md) |
| 交接 / 发版 | [docs/maintainer.md](./docs/maintainer.md) · [docs/publishing.md](./docs/publishing.md) |
| 改码笔记 | [AGENTS.md](./AGENTS.md) |

本机对照进 Cursor Canvas，不进 `docs/`。
