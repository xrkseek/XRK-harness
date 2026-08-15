# Profiles（Presets）

本仓用 **preset** 表达可切换组合，不使用独立 “profile” 运行时。CLI / env：`minimal` | `harness` | `server`。

## 选型

| Preset | 平面 | 包含 | 适用 |
|--------|------|------|------|
| **minimal** | Session | fs 工具（read/write/edit/glob/grep）· write-intent · workspace inject · replay 默认 LLM | 本地烟测、示例、无 shell |
| **harness** | Session | minimal 工具面 + bash + std（todo_write/ask_user）· sandbox 栈 · 可选 `run_code` | 完整编码 Agent |
| **server** | Host | HTTP host + agent factory → 通常挂 harness 组合 | `serve` |

Host vs Session 平面：[host-preset.md](./host-preset.md)。

## 共同选项（session preset）

| 选项 | 默认 | 含义 |
|------|------|------|
| `workspaceRoot` | 必填 | 工作区根 |
| `llm` | replay 固定文案 | 实现 `LlmAdapter`；生产可用 openai-compatible / `createDeepSeekAdapter` |
| `assemble` | `true` | 三层消息；`false` 则仅扁平 system |
| `workspaceInject` | 随 assemble 开启 | `.xrk` → `workspaceBlocks`；`false` 关闭 |
| `slashRecipes` | 随 assemble 开启 | `.xrk/recipes` → `/id` expand；`false` 关闭 |
| `plugins` | 无 | host `loader.list()` / 显式 `RegisteredPlugin[]` → tools 接线 |
| `extraTools` | 无 | 显式 ToolDefinition（同名冲突抛错） |
| `policy` | 无 | `PolicyEngine` → `pipeline.onPre(createPolicyToolPre)` |
| `system` | preset 默认人设 | 覆盖 persona |
| `sessionStore` / `sessionId` | 内存新建 | 注入既有 session |

Harness 另有：`presentation: "tools" | "code"`（`code` 注册实验性 `run_code`）。

## CLI

```bash
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
