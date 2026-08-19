# 排障

按症状定位。仍不通时对照 [status.md](./status.md) 是否落在「未稳 / 未做」，以及 [testing.md](./testing.md) 门禁是否绿。

## Node / pnpm

| 症状 | 处理 |
|------|------|
| `engines` / `Unsupported environment`，Node 22 | 换系统 Node **≥26**；勿让 IDE 自带 Node 抢 PATH |
| `pnpm check` 第一步 `tsc` 失败 | 先 `pnpm install`；看项目引用断裂包 |
| Windows 上 `node` 版本对但 pnpm 仍报旧引擎 | 同一终端确认 `where node` / `Get-Command node` 指向 ≥26 |

## CLI / Host

| 症状 | 处理 |
|------|------|
| `serve` 无产品壳 / `GET /` 404 | 发行包应有 `product-web/`。源码：`pnpm web:build && pnpm client:bundle && pnpm web:assemble`。`XRK_WEB_DIST` 指错则报错 |
| 绑定失败 / 拒绝 `0.0.0.0` | CLI 故意拒绝全网卡；用 `127.0.0.1` 或本机局域网地址 |
| `/api/*` 401 | 设置了 `XRK_API_KEY` 但请求未带 Bearer / `x-api-key` |
| session busy `409` | 同 session 已有 turn 在飞；等结束或换 sessionId |
| 无 LLM 回复 / 适配器错 | `minimal` 用 replay；真模型检查 `XRK_LLM_*`（[configuration.md](./configuration.md)） |

## 产品壳 / 浏览器

| 症状 | 处理 |
|------|------|
| `pnpm test:web` skip | 无完整 `apps/web/dist`（缺 index / boot / plugins） |
| `test:web` 失败且提到 Chromium | `pnpm --filter @xrkseek/web-frontend exec playwright install chromium` |
| 浏览器打不开本机 Host / 请求走代理 | 清掉 `HTTP_PROXY` · `HTTPS_PROXY` · `ALL_PROXY`（或设 `NO_PROXY=localhost,127.0.0.1`）后再测 |
| Vite 直接 `serve`/`dev` 被拒 | 产品入口是 `xrk-harness web` / Host serve，不是裸 Vite |

## MCP

| 症状 | 处理 |
|------|------|
| connect 被拒 | 默认 deny → `XRK_MCP_ALLOW=1` 或 policy allow |
| mutate 后不热挂载 | 若设了 `XRK_MCP_SERVERS`，env 赢过文件 → `applies: restart`，需重启 Host |
| 工具消失 / gave-up | 进程重连帽满或 `reconnect.enabled: false`；看 Face `connectFailures` / `connected[].status` |
| stdio 命令找不到 | 检查 PATH 与 `command`/`args`/`cwd` |

见 [modules/mcp.md](./modules/mcp.md) · [policy.md](./policy.md)。

## 工具诚实失败（不是 bug）

下列在**未配置**时仍可能出现在工具表，execute 回明文错误：

- `web_search` — 无 Tavily/Brave 密钥
- `lsp` — 无 `XRK_LSP_COMMAND`
- `terminal_open` — 无可用 `node-pty` native

## Session / 仓

| 症状 | 处理 |
|------|------|
| 重启丢会话 | Host 未设 `XRK_SESSIONS_DIR` 且非 CLI serve 默认路径 → 内存仓 |
| JSONL 损坏 | hydrate 丢弃末行坏 JSON 或 schema 失败并回写；中段损坏跳过该会话 |

见 [session.md](./session.md)。

## 打包 / 发布

| 症状 | 处理 |
|------|------|
| `npx` / Packages 找不到包 | 配置 `@xrkseek` → `npm.pkg.github.com`；或下发行版 tarball。见 [publishing.md](./publishing.md) |
| `pnpm release:stage` 失败 | 先 `pnpm build`；确认 `apps/web/dist/index.html`；deploy 需能解析 CLI workspace 依赖 |

## 仍需深入

- 架构与依赖边：[architecture.md](./architecture.md)
- Face 能力面：[host-face.md](./host-face.md)
- 安全清单：[security-checklist.md](./security-checklist.md)
- 包内文件地图：[modules/](./modules/README.md)
