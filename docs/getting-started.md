# 快速开始

本页面向**第一次 clone 本仓**的开发者。能力边界见 [status.md](./status.md)；环境变量全集见 [configuration.md](./configuration.md)。

## 前置

| 项 | 要求 |
|----|------|
| Node.js | **≥ 26**（根 `engines` / `.nvmrc`） |
| 包管理 | **pnpm 9**（`packageManager` 锁定） |
| 系统 | Windows / macOS / Linux |

确认：

```bash
node -v    # ≥ v26
pnpm -v
```

若 shell 里 `node` 仍是旧版（例如 IDE 自带的 Node 22），请改用系统安装的 Node ≥26，或把其 `bin` 放在 PATH 前面。

## 安装与构建

```bash
git clone https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
pnpm install
pnpm build
```

可选门禁（与 CI 一致）：

```bash
pnpm check
```

说明见 [testing.md](./testing.md)。

## 第一条命令（无 API key）

`minimal` preset 使用 **replay LLM**，不需要密钥：

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

或：

```bash
pnpm exec xrk-harness run --preset minimal --prompt "ping"
```

预期 stdout 含 replay 文案与工具列表说明。逐步示例：[examples/hello-agent](../examples/hello-agent)。

## 起 Host（HTTP + Face）

```bash
node apps/cli/dist/bin.js serve --preset server --workspace .
# 等价：pnpm serve
```

- 默认监听见 [http-api.md](./http-api.md)（常用 `127.0.0.1:8787`）
- **未**编出 `apps/web/dist` 时：托管 Face 验证台 `apps/console`
- **已**组装产品壳时：托管完整 Web UI

健康检查：`GET /health` → `{ "ok": true }`。

## 接真模型

设置 Provider Registry 相关变量后，用 `harness` / `server` preset：

```bash
# 示例：OpenRouter（密钥环境变量名由 brand 的 apiKeyEnv 决定）
export XRK_LLM_PRESET=openrouter
export OPENROUTER_API_KEY=…          # deepseek → DEEPSEEK_API_KEY；见 llm-provider-presets
# 可选：XRK_LLM_MODEL · XRK_LLM_BASE_URL

node apps/cli/dist/bin.js serve --preset harness --workspace .
```

详情：[configuration.md](./configuration.md) · [llm-provider-registry.md](./llm-provider-registry.md) · [llm-provider-presets.md](./llm-provider-presets.md)。

## 产品壳（可选，Tier B）

完整聊天 UI 需要组装静态资源（产物 gitignore，不入库）：

```bash
pnpm web:build
pnpm client:bundle
pnpm web:assemble
node apps/cli/dist/bin.js serve --preset server --workspace .
```

浏览器硬刷（不进 `pnpm check`）：

```bash
pnpm --filter @xrkseek/web-frontend exec playwright install chromium
pnpm test:web
```

网络代理若影响 `localhost`，跑测前清掉 `HTTP(S)_PROXY` / `ALL_PROXY`。说明：[troubleshooting.md](./troubleshooting.md)。

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
