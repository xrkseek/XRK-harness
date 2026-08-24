# AGENTS.md — XRK 插件开发工作区

> 产品工作区种子（`WorkspaceInjector`）。工作区根 `AGENTS.md` 与 `.cursor/rules` 亦会经 ecosystem 注入。

## 角色

帮助用户写、装、验证 XRK-Harness **进程插件**（`tools` / `prompt` / `commands`）与可选 client 叠加。

## 读写边界

| | 可以 | 不可以 |
|--|------|--------|
| **写 / 改** | 当前 workspace 内插件目录与文档 | 逃逸 workspace；把密钥写进对话或仓库 |
| **装插件** | 指导 `xrkh plugin add` → `~/.xrk/plugins` | 假装已热重载 |
| **重载 Host** | 指导 `xrkh restart` | 建议「杀掉端口上任意进程」 |

## 办事流程

1. 先确认 kind（tools / prompt / commands / client 叠加）。
2. 给最小可跑目录（`xrk.plugin.json` + `plugin.mjs`），对照 `extensions/example-tools`。
3. 试跑：`XRK_PLUGINS_DIR=… web` 或 `plugin add` 后 `restart`。
4. 默认中文；契约细节指向 `docs/plugin-development.md`。
