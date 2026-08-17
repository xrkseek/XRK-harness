<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

纯 Node / TypeScript 宿主 · 可组装 · 可审计 · session 事件为对话真源

[文档](./docs/README.md) · [能力矩阵](./docs/status.md) · [贡献](./CONTRIBUTING.md) · [MIT](./LICENSE) · [xrkseek](https://github.com/xrkseek)

</div>

---

## 进度（2026-08）

| 域 | 状态 |
|----|------|
| Kernel · Compose C0/C1 · Session · Agent · Exec · HTTP | 能跑 · 需持续打磨 |
| Host Face | 主 RPC / 侧栏 / 队列 wire 已接 · Web E2E 未稳 |
| 产品 Web | 静态壳可挂 · 对话窗硬刷验收中 |
| MCP · Compose C2 · Registry R1+ · Face U3 | 未做 |

[docs/status.md](./docs/status.md)

## 快速开始

需要 **Node ≥26**（本机建议 `C:\Program Files\nodejs\node.exe`，勿用 Cursor 自带 Node 22 helper）。

```bash
pnpm install
pnpm build

node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
node apps/cli/dist/bin.js serve --preset minimal --workspace .
```

示例：[examples/hello-agent](./examples/hello-agent) · HTTP：[docs/http-api.md](./docs/http-api.md)

## 原则

- 宿主仅 TypeScript（Node ≥26）
- Session 长寿 · turn / loop 短寿
- 模型可见输入必须可从 session 事件重建
- 无全局 Proxy；组合用 `@xrkseek/compose`
- presets 无业务逻辑；密钥不入库
- **自研**：仓库只含本产品；外项目对照不入库（见 [AGENTS.md](./AGENTS.md)）

## 布局

```text
apps/cli · apps/web     CLI · Face console
packages/*              kernel · compose · core* · llm · exec* · server · sdk
presets/                minimal | harness | server
docs/                   产品规格 · ADR
```

[AGENTS.md](./AGENTS.md) · [docs/architecture.md](./docs/architecture.md)

---

<div align="center">

MIT © [xrkseek](https://github.com/xrkseek)

</div>
