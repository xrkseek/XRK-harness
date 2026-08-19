# 快速开始

本页面向**第一次 clone 本仓**的开发者。能力边界见 [status.md](./status.md)；环境变量全集见 [configuration.md](./configuration.md)。

产品路径对齐 DeepSeek Harness：**install → build → 再跑**。要 Web UI 就编出 `apps/web/dist`，再 `serve` / `web`。缺产物时 CLI 会代跑组装，不另开一套 UI。

## 前置

| 项 | 要求 |
|----|------|
| Node.js | **≥ 26**（根 `engines` / `.nvmrc`） |
| 包管理 | **pnpm 9**（`packageManager` 锁定） |
| 系统 | Windows / macOS / Linux |

```bash
node -v    # ≥ v26
pnpm -v
```

若 shell 里 `node` 仍是旧版，改用系统 Node ≥26，或把其 `bin` 放在 PATH 前面。

## 安装与构建

```bash
git clone --depth=1 https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
```

| 步 | 作用 |
|----|------|
| `pnpm build` | `tsc -b`：CLI / 库 `dist` |
| `web:build` | 产品壳 Vite → `apps/web/dist` 基座 |
| `client:bundle` | 客户端插件 `lib/client.js` |
| `web:assemble` | 插件装进 `dist/plugins` + `boot.json` |

可选门禁：`pnpm check`（见 [testing.md](./testing.md)）。

## 单 turn（无 API key）

`minimal` preset 使用 **replay LLM**：

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

或 `pnpm exec xrk-harness run --preset minimal --prompt "ping"`。  
示例：[examples/hello-agent](../examples/hello-agent)。

## Host + 产品壳

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
# 等价：pnpm serve   /   xrk-harness web --open
```

- 默认监听见 [http-api.md](./http-api.md)（常用 `127.0.0.1:8787`）
- 静态根：`apps/web/dist`（可用 `XRK_WEB_DIST` 覆盖；覆盖路径不存在则报错，不代编）
- 缺默认 dist 时：CLI 代跑 `web:build` + `client:bundle` + `web:assemble`
- 健康检查：`GET /health` → `{ "ok": true }`

## 接真模型

```bash
export XRK_LLM_PRESET=openrouter
export OPENROUTER_API_KEY=…          # deepseek → DEEPSEEK_API_KEY；见 llm-provider-presets
# 可选：XRK_LLM_MODEL · XRK_LLM_BASE_URL

node apps/cli/dist/bin.js serve --preset harness --workspace .
```

详情：[configuration.md](./configuration.md) · [llm-provider-registry.md](./llm-provider-registry.md) · [llm-provider-presets.md](./llm-provider-presets.md)。

## 浏览器硬刷（可选）

```bash
pnpm --filter @xrkseek/web-frontend exec playwright install chromium
pnpm test:web
```

不进 `pnpm check`。代理若劫持 `localhost`，测前清掉 `HTTP(S)_PROXY` / `ALL_PROXY`。见 [troubleshooting.md](./troubleshooting.md)。

## MCP（可选）

默认 **deny** `mcp.connect`。开发放行：

```bash
export XRK_MCP_ALLOW=1
# 或写 {workspace}/.xrk/host-settings.json 的 mcp.servers，经 Settings → Plugins → MCP 落盘热挂载
```

见 [modules/mcp.md](./modules/mcp.md) · [policy.md](./policy.md)。

## 下一步

| 目标 | 文档 |
|------|------|
| 正式用什么 / 不用什么 | [status.md](./status.md) |
| HTTP / SSE | [http-api.md](./http-api.md) |
| Face RPC · 产品壳 | [host-face.md](./host-face.md) |
| Preset 选型 | [profiles.md](./profiles.md) |
| 架构 | [architecture.md](./architecture.md) |
| 排障 | [troubleshooting.md](./troubleshooting.md) |
