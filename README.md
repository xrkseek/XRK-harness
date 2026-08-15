# XRK-Harness

TypeScript **Agent Harness + Server Kit** — 纯 TypeScript / Node 宿主。

可组装、可审计、可分发的 Agent 运行时：轻量 `run`，完整 `serve`。独立 npm 产品族（`@xrkseek/*`），不依附 XRK-AGT 源码树。

## 能力矩阵（诚实）

| 能力 | 状态 |
|------|------|
| Session 事件真源 · admit/continueTurn · drain wake/resume | **已落地** |
| Delivery：queue 默认 · steer 优先 promote · HTTP 透传 | **已落地**（steer 批量配额等见规格剩余项） |
| Tool 瀑布 · guards · settle · output bound | **已落地** |
| Exec seams：fs（含 glob/grep）· shell · sandbox | **已落地** |
| 三层消息 · workspace `.xrk` inject · presets | **已落地** |
| HTTP serve · API key · SSE | **已落地** |
| Compaction / overflow 一次重试 · session safety | **已落地** |
| `@xrkseek/mcp` | **空壳**（未开工） |
| `@xrkseek/policy` | **薄壳**（仅再导出 tool denylist guard） |
| openai-compatible / deepseek 适配 | **空壳**（用 `LlmAdapter` + replay 测） |
| `apps/web` | **M3 占位** |

详见 [docs/status.md](./docs/status.md)。

## 快速开始

```bash
pnpm install
pnpm check

# 无密钥一轮（replay LLM）
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"

# HTTP（开发可空 XRK_API_KEY）
node apps/cli/dist/bin.js serve --preset minimal --workspace .
```

更多：[examples/hello-agent](./examples/hello-agent) · [docs/http-api.md](./docs/http-api.md) · [docs/README.md](./docs/README.md)

## 原则

- **宿主**：仅 Node/TypeScript（无 Go 网关）— [ADR-0001](./docs/adr/0001-typescript-only-host.md)
- **不并入上游源码** — [ADR-0002](./docs/adr/0002-no-embed-upstream.md)
- **Session 长寿 · loop 短寿** — [ADR-0003](./docs/adr/0003-session-long-loop-short.md)
- **无 Effect 运行时** — [ADR-0004](./docs/adr/0004-no-effect-runtime.md)
- **调研优先级**：DeepSeek Harness → XRK-AGT 契约 → cline/opencode 分层 → 自研

## 布局

```text
apps/cli              xrk-harness（run · serve · doctor · dump-config）
packages/*            kernel · protocol · core* · llm · exec* · server · sdk …
presets/              minimal | harness | server（只组合，无业务逻辑）
docs/                 产品规格 · ADR · learn（调研笔记）
templates/office-agent  产品种子
examples/             可运行示例
```

依赖方向见 [AGENTS.md](./AGENTS.md) 与 [docs/architecture.md](./docs/architecture.md)。

## 文档入口

| 你是… | 打开 |
|-------|------|
| 集成方 | [docs/README.md](./docs/README.md) · [@xrkseek/harness SDK](./packages/sdk/README.md) |
| 维护者 | [CONTRIBUTING.md](./CONTRIBUTING.md) · [docs/testing.md](./docs/testing.md) |
| 决策考古 | [docs/adr](./docs/adr/README.md) · [docs/learn](./docs/learn/README.md) |

## License

MIT · [xrkseek](https://github.com/xrkseek)
