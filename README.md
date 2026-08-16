<div align="center">

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

纯 Node / TypeScript 宿主 · 可组装 · 可审计 · session 事件为对话真源

[文档](./docs/README.md) · [能力矩阵](./docs/status.md) · [贡献](./CONTRIBUTING.md) · [MIT](./LICENSE) · [xrkseek](https://github.com/xrkseek)

</div>

---

## 完成度（2026-08）

| 域 | 状态 |
|----|------|
| Kernel · Compose（Scope / Ordering） | ✅ 已交付 |
| Session 事件 · admit · drain · delivery | ✅ 已交付 |
| Agent loop · tools · settle · compaction · safety | ✅ 已交付 |
| Exec（fs / shell / sandbox）· workspace · presets | ✅ 已交付 |
| HTTP Host · Plugin loader · Policy · 审批 UI | ✅ 已交付 |
| LLM（replay / OpenAI 兼容 / DeepSeek 预设）· Registry R0 | ✅ 已交付 |
| Host Face（RPC + 双 WS）· AppShell | ✅ 主路径已交付 |
| `@xrkseek/mcp` | ○ 空壳 |
| Face 附件 / 搜索等扩展 RPC · Compose C2 · Registry R1+ | ○ 未做 / 分期 |

**核心 serve / run 路径可用。** 细节与红线见 [docs/status.md](./docs/status.md)。

## 快速开始

```bash
pnpm install
pnpm check

# 无密钥一轮（replay LLM）
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"

# HTTP
node apps/cli/dist/bin.js serve --preset minimal --workspace .
```

示例：[examples/hello-agent](./examples/hello-agent) · HTTP：[docs/http-api.md](./docs/http-api.md)

## 原则

- 宿主仅 TypeScript（Node ≥20）
- Session 长寿 · turn / loop 短寿
- 模型可见输入必须可从 session 事件重建
- 无全局 Proxy 上帝对象；组合用显式对象图（`@xrkseek/compose`）
- presets 只组合、无业务逻辑；密钥不入库

决策记录：[docs/adr](./docs/adr/README.md)

## 仓库布局

```text
apps/cli · apps/web     CLI · AppShell
packages/*              kernel · compose · protocol · core* · llm · exec* · server · sdk …
presets/                minimal | harness | server
docs/                   产品规格 · ADR · 能力矩阵
templates/ · examples/
```

依赖纪律：[AGENTS.md](./AGENTS.md) · [docs/architecture.md](./docs/architecture.md)

## 文档

| 角色 | 入口 |
|------|------|
| 集成 | [docs/README.md](./docs/README.md) · [@xrkseek/harness](./packages/sdk/README.md) |
| 维护 | [CONTRIBUTING.md](./CONTRIBUTING.md) · [docs/testing.md](./docs/testing.md) |
| 状态 | [docs/status.md](./docs/status.md) |

---

<div align="center">

MIT © [xrkseek](https://github.com/xrkseek)

</div>
