# Contributing

维护 XRK-Harness 时遵循 [AGENTS.md](./AGENTS.md)。切片完成定义：**代码 + 测试 +（若改契约）docs 同步 + `pnpm check` 绿**。

## 环境

- Node ≥ 26（`.nvmrc`）。Windows 本机：`C:\Program Files\nodejs\node.exe`（当前 26.7）。勿把 Cursor helper Node 22 放在 PATH 前面。
- pnpm 9（`packageManager` 字段锁定）

```bash
# 确认
node -v   # 应 ≥ v26
pnpm install
pnpm check
```

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

空壳 / 未接线能力在实现前 **只** 更新 `docs/status.md`「未做」，勿写假 API。`@xrkseek/mcp` 已能跑（stdio · HTTP · `tools/list_changed` · 默认 deny）；勿再当空壳。

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
- Commit 勿带 Cursor co-author trailer（见用户/仓库规则）  
- 密钥（`.env`、真实 API key）永不入库  

## 文档入口

分层见 [docs/README.md](./docs/README.md)。改契约必改对应规格 + [docs/status.md](./docs/status.md)。包落点见 [docs/modules/README.md](./docs/modules/README.md)。本机对照 / 体量板进 Cursor Canvas，不进 `docs/`。

[docs/README.md](./docs/README.md) · [docs/status.md](./docs/status.md) · [docs/architecture.md](./docs/architecture.md)
