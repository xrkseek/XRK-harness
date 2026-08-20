# Profiles（Presets）

> **读者**：终端用户 · 集成者 · 贡献者。

本仓用 **preset** 表达可切换组合。有两套名字，不要混成「三种工具面」：

| 名字 | 落在哪 | 决定什么 |
|------|--------|----------|
| **Host CLI** `--preset` / `XRK_PRESET` | 进程启动 | 默认会话徽章种子；`server` = Host 平面入口名 |
| **Session `agentPreset`** | 会话徽章（UI / Face） | **实际工具组合**：只认 `minimal` \| `harness` |

## 工具面（Session）

| `agentPreset` | 工具 | 适用 |
|---------------|------|------|
| **minimal** | fs（read/write/edit/glob/grep）· skill · std（todo / ask_user / exit_plan_mode） | 烟测、无 shell / 无联网 |
| **harness** | minimal + bash · **web_search / web_fetch** · lsp · terminal_* · sandbox | 完整编码 Agent（**`web` / `serve` 默认**） |

Wire 仍接受遗留值 **`server`**，入库与徽章一律归一成 **`harness`**（工具面相同）。产品 UI **不再**单独展示 Server。

## Host 入口名

| Host `--preset` | 含义 |
|-----------------|------|
| `minimal` | 新会话默认徽章 = minimal |
| `harness` | 新会话默认徽章 = harness（`web` / `serve` / `restart` 默认） |
| `server` | 与 harness **同一套工具**；`@xrkseek/preset-server` 的 Host factory 接线名 |

`run` / `dump-config` 默认 **minimal**。Host `--preset` **不会**覆盖已有会话徽章；换工具面请改徽章或新建会话。

Host vs Session 平面：[host-preset.md](./host-preset.md)。

## Agent 可写范围

| 根 | Agent 能否用 fs/bash 改 |
|----|------------------------|
| **会话 workspace**（侧栏工作区 / `session` cwd） | 能（`resolveWithinRoot`；权限预设 `read-only` 除外） |
| **`~/.xrk`**（`XRK_HOME`：settings / credentials / sessions / workspaces） | **不能**（除非把该目录本身选成 workspace） |
| **产品插件 / 仓内 `packages/*`** | 仅当 workspace 根就是那个树时能改 |

`{workspace}/.xrk` 是项目 inject（assistant / skills / recipes），在 workspace 内；与 harness home 不是同一棵树。详见 [configuration.md](./configuration.md) · [security-checklist.md](./security-checklist.md)。

## 共同选项（session preset）

| 选项 | 默认 | 含义 |
|------|------|------|
| `workspaceRoot` | 必填 | 工作区根 |
| `llm` | replay 固定文案 | 实现 `LlmAdapter`；生产可用 openai-compatible / `createDeepSeekAdapter` |
| `assemble` | `true` | 三层消息；`false` 则仅扁平 system |
| `workspaceInject` | 随 assemble 开启 | `.xrk` → `workspaceBlocks`；`false` 关闭 |
| `slashRecipes` | 随 assemble 开启 | `.xrk/recipes` → `/id` expand；`false` 只关 recipe，`/skill-name` 仍展开 |
| `plugins` | 无 | host `loader.list()` / 显式 `RegisteredPlugin[]` → tools 接线 |
| `extraTools` | 无 | 显式 ToolDefinition（同名冲突抛错） |
| `policy` | 无 | `PolicyEngine` → `pipeline.onPre(createPolicyToolPre)` |
| `system` | preset 默认人设 | 覆盖 persona |
| `sessionStore` / `sessionId` | 内存新建 | 注入既有 session |
| `compaction` | `{}` | overflow 一次重试 + `/compact`；`false` 关 overflow（手动 compact 仍可用） |

Harness 另有：`presentation: "tools" | "code"`（`code` 注册实验性 `run_code`）；`webTools: false` 跳过 web 工具（默认开，见 [web-tools.md](./web-tools.md)）；`lspTools: false` 跳过 `lsp`（默认开，见 [lsp-tools.md](./lsp-tools.md)）；`ptyTools: false` 跳过 PTY 六件套（默认开，见 [pty-tools.md](./pty-tools.md)）。

## CLI

```bash
node apps/cli/dist/bin.js web --workspace .
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
node apps/cli/dist/bin.js serve --preset server --workspace .
```

Env：`XRK_PRESET`、`XRK_WORKSPACE` 等见 [http-api.md](./http-api.md)。

## 扩展新 preset

1. 新建 `presets/<id>/`：只 `create*Composition` 组合现有包。  
2. 禁止业务规则、禁止往「根 realm」抢服务名。  
3. 挂 CLI `parse-args` / `serve` factory。  
4. 更新本页与 [status.md](./status.md)。

相关：[workspace-inject.md](./workspace-inject.md) · [code-mode.md](./code-mode.md)
