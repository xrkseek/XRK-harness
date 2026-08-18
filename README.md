<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

纯 Node / TypeScript 宿主 · 可组装 · 可审计 · session 事件为对话真源

[文档](./docs/README.md) · [能力矩阵](./docs/status.md) · [贡献](./CONTRIBUTING.md) · [MIT](./LICENSE) · [xrkseek](https://github.com/xrkseek)

</div>

---

## 进度

以 [docs/status.md](./docs/status.md) 为准。摘要：

| 域 | 状态 |
|----|------|
| Kernel · Compose · Session · Agent · Exec · HTTP · Host Face 主路径 | 能跑 |
| MCP（stdio · HTTP · list_changed）· Attachment（Face 可图） | 能跑 |
| Host Face ↔ 产品 Web · 浏览器 E2E | 未稳 |
| Registry R1 官方协议 · MCP 设置 UI | 未做 |

## 快速开始

需要 **Node ≥26**。

```bash
pnpm install
pnpm build

node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
node apps/cli/dist/bin.js serve --preset server --workspace .
# or: pnpm serve   /   xrk-harness web --open
```

示例：[examples/hello-agent](./examples/hello-agent) · HTTP：[docs/http-api.md](./docs/http-api.md)

## 原则

- 宿主仅 TypeScript（Node ≥26）
- Session 长寿 · turn / loop 短寿
- 模型可见输入必须可从 session 事件重建
- 无全局 Proxy；组合用 `@xrkseek/compose`
- presets 无业务逻辑；密钥不入库

## 布局

树与依赖：[docs/architecture.md](./docs/architecture.md)。包索引：[docs/modules/README.md](./docs/modules/README.md)。

```text
apps/cli · apps/web · apps/web-static   CLI · Face console · 产品壳（DSH 捕获）
packages/*              30 个 @xrkseek 库（kernel · compose · core* · llm · exec* · server · mcp · …）
presets/                minimal | harness | server
docs/                   规格 · ADR · modules 文件地图
```

[AGENTS.md](./AGENTS.md)

---

<div align="center">

MIT © [xrkseek](https://github.com/xrkseek)

</div>
