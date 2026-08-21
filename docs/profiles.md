# Profiles（Presets）

> **读者**：终端用户 · 集成者 · 贡献者。

## 一句话导读

| 你听到的词 | 它到底是什么 | 决定什么 | **不是**什么 |
|------------|--------------|----------|--------------|
| **Session / 会话徽章** | 一条对话上钉死的「工具面」id：`minimal` 或 `harness` | Agent **能调用哪些工具** | 人格文案、工作区文件、Host 进程本身 |
| **工作区种子** | 拷进 `{workspace}/.xrk` 的 markdown / recipes 模板 | 模型读到的**人格、规则、插件怎么写**（durable inject） | 工具开没开 |
| **Host `--preset`** | 起 `web`/`serve` 时给**新会话**的默认徽章 | 只影响**之后新建**的会话 | 不会改已有会话的徽章 |

产品 UI 里**只有两种工具面**：**Minimal** 与 **XRK Harness**（id `harness`）。没有第三种内置工具表。  
`server` 只是 Host 工厂的旧名字，工具面 = harness。

```text
你打开 web
    │
    ├─ Host 进程（serve）── --preset 只种子「默认徽章」
    │
    └─ 侧栏里每一条 Session（一次对话）
           │
           ├─ agentPreset = minimal | harness   ← 工具开哪些
           └─ 读 workspace/.xrk/*               ← 种子喂什么话
```

---

## 本仓有三层「preset」名字（勿混）

| 层 | 名字 | 落点 | 决定什么 |
|----|------|------|----------|
| **Session 工具面** | `minimal` · `harness`（UI：**XRK Harness**） | 会话徽章 / Face `agentPreset` | **实际工具组合** |
| **Host CLI** | `--preset` / `XRK_PRESET` | 进程启动 | 新会话默认徽章种子；`server` = Host 工厂名 |
| **工作区种子** | `templates/office-agent` · `templates/xrk-harness` | `{workspace}/.xrk` | 人格 / 规则 / 插件开发喂法（inject） |

Wire 遗留值 **`server`** → 入库与徽章一律归一成 **`harness`**。产品 UI **不**单独展示 Server。

## Session 工具面（只有这两种）

| `agentPreset` | UI 名 | 工具 | 适用 |
|---------------|-------|------|------|
| **minimal** | Minimal | fs · skill · std（todo / ask_user / exit_plan_mode） | 烟测、无 shell / 无联网 |
| **harness** | **XRK Harness** | minimal + bash · web_search/web_fetch · lsp · terminal_* · sandbox | 完整编码 Agent（**`web` / `serve` 默认**） |

实现包：`presets/minimal` · `presets/harness`。`presets/server` **不是**第三套工具表，只导出 Host `AgentFactory`（内部调用 harness）。

**Session 是什么**：侧栏里的一条对话线程（有 id、事件日志、可选子代理）。创建时钉上 `agentPreset`；已跑着的会话保持开始时的工具面。

## Host CLI 入口

| Host `--preset` | 含义 |
|-----------------|------|
| `minimal` | 新会话默认徽章 = minimal |
| `harness` | 新会话默认徽章 = harness（`web` / `serve` / `restart` 默认） |
| `server` | 与 harness **同一套工具**；`@xrkseek/preset-server` 的 Host factory 接线名 |

`run` / `dump-config` 默认 **minimal**。Host `--preset` **不会**覆盖已有会话徽章。

`restart`：停本机先前记下的 **XRK Host**（`~/.xrk/run/host-<port>.pid.json`）再起。  
`--force`：只停指纹匹配的 XRK Host。

Host vs Session：[host-preset.md](./host-preset.md)。

## 工作区种子（喂模型，不是第三种工具面）

种子 = 仓库里的**模板目录**，`syncSeeds` 拷进你的项目 `{workspace}/.xrk/`。每轮 turn 开始时，内容以 durable `user/message`（skill-catalog / agent-instructions）注入，模型当上下文读。

| 模板 | 用途 |
|------|------|
| [templates/office-agent](../templates/office-agent/) | 通用办公助手人格 / recipes |
| [templates/xrk-harness](../templates/xrk-harness/) | **插件怎么开发**（进程 kind + CLI） |

```ts
import { createWorkspaceInjector } from "@xrkseek/workspace";
import path from "node:path";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "xrk-harness"));
```

详见 [workspace-inject.md](./workspace-inject.md) · [plugin-development.md](./plugin-development.md)。

## Agent 可写范围

| 根 | Agent 能否用 fs/bash 改 |
|----|------------------------|
| **会话 workspace**（侧栏工作区 / `session` cwd） | 能（权限 `read-only` 除外） |
| **`~/.xrk`**（settings / credentials / sessions） | **不能**（除非把该目录选成 workspace） |
| **仓内 `packages/*`** | 仅当 workspace 根就是那个树时能改 |

## 共同选项（session composition）

| 选项 | 默认 | 含义 |
|------|------|------|
| `workspaceRoot` | 必填 | 工作区根 |
| `llm` | replay | `LlmAdapter` |
| `assemble` | `true` | 三层消息 |
| `workspaceInject` | 随 assemble | `.xrk` → 持久 inject |
| `slashRecipes` | 随 assemble | `.xrk/recipes` |
| `plugins` | 无 | 进程插件接线 |

Harness 另有：`presentation` · `webTools` · `lspTools` · `ptyTools`。

## CLI

```bash
node apps/cli/dist/bin.js web --workspace .
node apps/cli/dist/bin.js restart
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

## 扩展新工具面

1. 新建 `presets/<id>/`：只组合现有包。  
2. 写入 Face `FACE_AGENT_PRESETS` + CLI factory。  
3. 更新本页与 [status.md](./status.md)。

相关：[workspace-inject.md](./workspace-inject.md) · [plugin-development.md](./plugin-development.md) · [code-mode.md](./code-mode.md)
