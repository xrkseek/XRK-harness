# Status（能力矩阵）

三态：**能跑 / 未稳 / 未做**。与代码对齐。

## 能跑

| 域                                     | 包 / 入口                                                                | 规格                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Kernel / Compose C0·C1                 | `@xrkseek/kernel` · `@xrkseek/compose`                                   | [architecture](./architecture.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools         | `core-*`                                                                 | [session.md](./session.md) · [tool-pipeline.md](./tool-pipeline.md)        |
| Exec / Workspace / Policy              | `exec-*` · `workspace` · `policy`                                        | [seams.md](./seams.md) · [policy.md](./policy.md)                          |
| HTTP + Host + Face 主路径              | `server-*`                                                               | [http-api.md](./http-api.md) · [host-face.md](./host-face.md)              |
| LLM replay / OpenAI 兼容 / Registry R0 | `llm-*`                                                                  | [llm-provider-registry.md](./llm-provider-registry.md)                     |
| Presets / SDK                          | `presets/*` · `@xrkseek/harness`                                         | [profiles.md](./profiles.md)                                               |
| MCP M0                                 | `@xrkseek/mcp` + Host `XRK_MCP_*`（默认 deny）                           | [policy.md](./policy.md)                                                   |
| Attachment                             | `@xrkseek/attachment` + Face `session.attachment`（Host 默认 text-only） | [host-face.md](./host-face.md)                                             |

## 未稳

| 域                   | 说明                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| Host Face ↔ 产品 Web | 侧栏 / settings / 队列 / search / skill.list / openPath 已接；浏览器 E2E 未勾 |
| 产品 Web             | 静态壳可挂；流式 / 工具卡硬刷未验收                                           |
| 进程插件             | `tools` + `prompt` 已接线；`channel` / `policy` / `llm` 未自动接线            |

## 未做

| 域                                  | 说明                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Compose C2 · Registry R1+ · Face U3 | 未开工                                                                                                      |
| Face NI                             | `goal.*` · agentPreset 创作面 · `llm.discoverModels` · `settings.openDocument` · `workspace.delete/insert*` |
| 视觉模型路由                        | 附件仓已有；无声明 `image` 的 LLM 适配路径                                                                  |
| MCP 进阶                            | HTTP transport · 重连 · Face MCP 设置 UI                                                                    |

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

[AGENTS.md](../AGENTS.md) · [learn.md](./learn.md) · [modules/](./modules/README.md)
