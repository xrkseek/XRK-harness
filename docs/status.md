# Status（能力矩阵）

> 与实现对齐。三态：**能跑 / 未稳 / 未做**。基线：2026-08。

## 能跑

| 域 | 包 / 入口 | 规格 |
|----|-----------|------|
| Kernel / Compose C0·C1 | `@xrkseek/kernel` · `@xrkseek/compose` | [architecture](./architecture.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*` | [session.md](./session.md) · [tool-pipeline.md](./tool-pipeline.md) |
| Exec / Workspace / Policy | `exec-*` · `workspace` · `policy` | [seams.md](./seams.md) · [policy.md](./policy.md) |
| HTTP + Host + Face 主路径 | `server-*` | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| LLM replay / OpenAI 兼容 / Registry R0 | `llm-*` | [llm-provider-registry.md](./llm-provider-registry.md) |
| Presets / SDK | `presets/*` · `@xrkseek/harness` | [profiles.md](./profiles.md) |

## 未稳

| 域 | 说明 |
|----|------|
| Host Face ↔ DSH Web | 侧栏/settings/inbox spliced·queue.message 已接；**浏览器 E2E 未勾** |
| 产品 Web | `vendor/dsh-web-static` 可挂；对话窗/工具卡待硬刷 |
| 核心打磨 | run/serve 可用 ≠ 边界/错误/对照 bar·AGT 完成 |

## 未做

| 域 | 说明 |
|----|------|
| `@xrkseek/mcp` | `export {}` |
| Compose C2 · Registry R1+ · Face U3 | 未开工 |
| Face NI 方法 | 见 [host-face.md](./host-face.md) 表 |

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

[AGENTS.md](../AGENTS.md) · 基础原文 [upstream/deepseek-harness](./upstream/deepseek-harness/)
