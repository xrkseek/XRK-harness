# 快速开始

能力边界见 [status.md](./status.md)；环境变量见 [configuration.md](./configuration.md)。

## 前置

| 项 | 要求 |
|----|------|
| Node.js | **≥ 26** |
| 用法 | **CLI**（`run`）或 **Web**（`web` / `serve`） |

```bash
node -v    # ≥ v26
```

## 安装运行

```bash
npx @xrkseek/harness-cli web
npx @xrkseek/harness-cli run --preset minimal --prompt "ping"
```

壳在 CLI 包内 `product-web/`。Packages registry 见 [publishing.md](./publishing.md)。

## 从源码

```bash
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

monorepo 里 `serve`/`web` 缺 `apps/web/dist` 时代编三步；`XRK_WEB_DIST` 若设置则必须已存在。发行：`pnpm release:stage` / `pnpm release`。

## 接真模型

```bash
export XRK_LLM_PRESET=openrouter
export OPENROUTER_API_KEY=…
npx @xrkseek/harness-cli serve --preset harness --workspace .
```

## MCP（可选）

默认 deny。`XRK_MCP_ALLOW=1`，或 Settings → Plugins → MCP。

## 下一步

| 目标 | 文档 |
|------|------|
| 能力边界 | [status.md](./status.md) |
| HTTP / Face | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| 发布 | [publishing.md](./publishing.md) |
| 排障 | [troubleshooting.md](./troubleshooting.md) |
