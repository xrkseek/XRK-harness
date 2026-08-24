# Profiles（Presets） / Profiles (Presets)

> **读者 / Audience**：终端用户 · 集成者 · 贡献者 / End users · Integrators · Contributors

## 一句话导读 / One-Line Guide

| 你听到的词 / Term | 它到底是什么 / What it is | 决定什么 / Controls | **不是**什么 / **Not** |
|------------|--------------|----------|--------------|
| **Session / 会话徽章** | 一条对话上钉死的「工具面」id：`minimal` 或 `harness` / Tool-surface id pinned on a conversation: `minimal` or `harness` | Agent **能调用哪些工具** / Which tools the Agent may call | 人格文案、工作区文件、Host 进程本身 / Persona copy, workspace files, or the Host process |
| **工作区种子 / Workspace seeds** | 拷进 `{workspace}/.xrk` 的 markdown / recipes 模板 / Markdown / recipes templates copied into `{workspace}/.xrk` | 模型读到的**人格、规则、插件怎么写**（durable inject） / Persona, rules, and plugin-authoring guidance the model reads (durable inject) | 工具开没开 / Whether tools are enabled |
| **Host `--preset`** | 起 `web`/`serve` 时给**新会话**的默认徽章 / Default badge for **new** sessions when starting `web`/`serve` | 只影响**之后新建**的会话 / Only sessions created afterward | 不会改已有会话的徽章 / Does not change badges on existing sessions |

产品 UI 里**只有两种工具面**：**Minimal** 与 **XRK Harness**（id `harness`）。没有第三种内置工具表。  
`server` 只是 Host 工厂的旧名字，工具面 = harness。

The product UI exposes **exactly two tool surfaces**: **Minimal** and **XRK Harness** (id `harness`). There is no third built-in tool table.  
`server` is only a legacy Host-factory name; its tool surface is harness.

```text
你打开 web / You open web
    │
    ├─ Host 进程（serve）── --preset 只种子「默认徽章」 / seeds the default badge only
    │
    └─ 侧栏里每一条 Session（一次对话） / Each Session in the sidebar
           │
           ├─ agentPreset = minimal | harness   ← 工具开哪些 / which tools
           └─ 读 workspace/.xrk/*               ← 种子喂什么话 / what seeds inject
```

---

## 本仓有三层「preset」名字（勿混） / Three “Preset” Names in This Repo (Do Not Mix)

| 层 / Layer | 名字 / Name | 落点 / Location | 决定什么 / Controls |
|----|------|------|----------|
| **Session 工具面 / Session tool surface** | `minimal` · `harness`（UI：**XRK Harness**） | 会话徽章 / Face `agentPreset` | **实际工具组合** / Actual tool composition |
| **Host CLI** | `--preset` / `XRK_PRESET` | 进程启动 / Process startup | 新会话默认徽章种子；`server` = Host 工厂名 / Default badge seed for new sessions; `server` = Host factory name |
| **工作区种子 / Workspace seeds** | `templates/office-agent` · `templates/xrk-harness` | `{workspace}/.xrk` | 人格 / 规则 / 插件开发喂法（inject） / Persona / rules / plugin-authoring inject |

Wire 遗留值 **`server`** → 入库与徽章一律归一成 **`harness`**。产品 UI **不**单独展示 Server。

Legacy wire value **`server`** normalizes to **`harness`** for storage and badges. The product UI does **not** show Server as its own badge.

## Session 工具面（只有这两种） / Session Tool Surfaces (Exactly Two)

| `agentPreset` | UI 名 / UI name | 工具 / Tools | 适用 / Use when |
|---------------|-------|------|------|
| **minimal** | Minimal | fs · skill · std（todo / ask_user / exit_plan_mode） | 烟测、无 shell / 无联网 / Smoke tests; no shell / no network |
| **harness** | **XRK Harness** | minimal + bash · web_search/web_fetch · lsp · terminal_* · sandbox | 完整编码 Agent（**`web` / `serve` 默认**） / Full coding Agent (**default for `web` / `serve`**) |

实现包 / Implementation packages：`presets/minimal` · `presets/harness`。`presets/server` **不是**第三套工具表，只导出 Host `AgentFactory`（内部调用 harness）。

`presets/server` is **not** a third tool table; it only exports the Host `AgentFactory` (which calls harness internally).

**Session 是什么** / **What a Session is**：侧栏里的一条对话线程（有 id、事件日志、可选子代理）。创建时钉上 `agentPreset`；已跑着的会话保持开始时的工具面。

A Session is one conversation thread in the sidebar (id, event log, optional subagents). `agentPreset` is pinned at create time; running sessions keep the tool surface they started with.

## Host CLI 入口 / Host CLI Entry

| Host `--preset` | 含义 / Meaning |
|-----------------|------|
| `minimal` | 新会话默认徽章 = minimal / New-session default badge = minimal |
| `harness` | 新会话默认徽章 = harness（`web` / `serve` / `restart` 默认） / New-session default = harness (default for `web` / `serve` / `restart`) |
| `server` | 与 harness **同一套工具**；`@xrkseek/preset-server` 的 Host factory 接线名 / **Same tools** as harness; Host factory wiring name for `@xrkseek/preset-server` |

`run` / `dump-config` 默认 **minimal**。Host `--preset` **不会**覆盖已有会话徽章。

`run` / `dump-config` default to **minimal**. Host `--preset` does **not** override badges on existing sessions.

`restart`：停本机先前记下的 **XRK Host**（`~/.xrk/run/host-<port>.pid.json`）再起。  
`--force`：只停指纹匹配的 XRK Host。

`restart` stops the previously recorded local **XRK Host** (`~/.xrk/run/host-<port>.pid.json`) and starts again.  
`--force` stops only fingerprint-matched XRK Hosts.

Host vs Session：[host-preset.md](./host-preset.md)。

## 工作区种子（喂模型，不是第三种工具面） / Workspace Seeds (Feed the Model, Not a Third Tool Surface)

种子 = 仓库里的**模板目录**，`syncSeeds` 拷进你的项目 `{workspace}/.xrk/`。每轮 turn 开始时，内容以 durable `user/message`（skill-catalog / agent-instructions）注入，模型当上下文读。

Seeds are **template directories** in the repo; `syncSeeds` copies them into `{workspace}/.xrk/`. At each turn start they are injected as durable `user/message` rows (skill-catalog / agent-instructions) for the model to read as context.

| 模板 / Template | 用途 / Purpose |
|------|------|
| [templates/office-agent](../templates/office-agent/) | 通用办公助手人格 / recipes / General office-assistant persona / recipes |
| [templates/xrk-harness](../templates/xrk-harness/) | **插件怎么开发**（进程 kind + CLI） / **How to develop plugins** (process kinds + CLI) |

```ts
import { createWorkspaceInjector } from "@xrkseek/workspace";
import path from "node:path";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "xrk-harness"));
```

详见 / Details：[workspace-inject.md](./workspace-inject.md) · [plugin-development.md](./plugin-development.md)。

## Agent 可写范围 / Agent Write Scope

| 根 / Root | Agent 能否用 fs/bash 改 / May Agent change via fs/bash |
|----|------------------------|
| **会话 workspace**（侧栏工作区 / `session` cwd） | 能（权限 `read-only` 除外） / Yes (except `read-only` permission) |
| **`~/.xrk`**（settings / credentials / sessions） | **不能**（除非把该目录选成 workspace） / **No** (unless that directory is the workspace) |
| **仓内 `packages/*`** | 仅当 workspace 根就是那个树时能改 / Only when the workspace root is that tree |

## 共同选项（session composition） / Shared Options (Session Composition)

| 选项 / Option | 默认 / Default | 含义 / Meaning |
|------|------|------|
| `workspaceRoot` | 必填 / Required | 工作区根 / Workspace root |
| `llm` | replay | `LlmAdapter` |
| `assemble` | `true` | 三层消息 / Three-layer messages |
| `workspaceInject` | 随 assemble / Follows assemble | `.xrk` → 持久 inject / Durable inject |
| `slashRecipes` | 随 assemble / Follows assemble | `.xrk/recipes` |
| `plugins` | 无 / None | 进程插件接线 / Process plugin wiring |

Harness 另有 / Harness also has：`presentation` · `webTools` · `lspTools` · `ptyTools`。

## CLI

```bash
node apps/cli/dist/bin.js web --workspace .
node apps/cli/dist/bin.js restart
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

## 扩展新工具面 / Adding a New Tool Surface

1. 新建 `presets/<id>/`：只组合现有包。 / Create `presets/<id>/`: compose existing packages only.  
2. 写入 Face `FACE_AGENT_PRESETS` + CLI factory。 / Register Face `FACE_AGENT_PRESETS` + CLI factory.  
3. 更新本页与 [status.md](./status.md)。 / Update this page and [status.md](./status.md).

相关 / Related：[workspace-inject.md](./workspace-inject.md) · [plugin-development.md](./plugin-development.md) · [code-mode.md](./code-mode.md)
