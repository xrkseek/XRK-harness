<div align="center">

<img src="./docs/assets/logo-plate.png" alt="XRK Harness" width="128" />

# XRK-Harness

**TypeScript Agent Harness + Server Kit**

可组装的 Node 宿主 · session 事件为对话真源 · Host Face 对接产品壳

[文档中心](./docs/README.md) · [能力矩阵](./docs/status.md) · [快速开始](./docs/getting-started.md) · [配置](./docs/configuration.md) · [贡献](./CONTRIBUTING.md) · [MIT](./LICENSE)

</div>

---

## 这是什么

XRK-Harness（npm scope `@xrkseek/*`）是纯 **TypeScript / Node ≥26** 的 Agent 运行时与 Server Kit：

- **Session 为真源**：对话与工具调用以 append-only 事件日志重建，turn / loop 短寿
- **可组装**：`minimal` / `harness` / `server` preset 只接线，不写业务；能力经 compose 与工具瀑布组合
- **Host + Face**：HTTP / RPC / 双 WebSocket；产品壳为 `apps/web` + `packages/client`（serve 托管 `apps/web/dist`）
- **MCP**：stdio 与 streamable-http；文件真源下 Settings 落盘后可热挂载

当前以 **clone 本仓** 使用为主。npm 公开发布尚未完成（全仓 `private: true`）。能正式用到哪一层，见 [docs/status.md](./docs/status.md)。

## 状态摘要

| 域 | 状态 |
|----|------|
| Kernel · Compose · Session · Agent · Exec · HTTP · Host Face | 能跑 |
| MCP（stdio · HTTP · 热挂载 · Plugins 卡）· Attachment | 能跑 |
| 产品 Web 全量组装 · 浏览器 E2E | 未稳（需 `web:build` + bundle + assemble） |
| Registry 官方协议扩展 · npm 公开发布 | 未做 |

完整矩阵与分层说明：[docs/status.md](./docs/status.md)。

## 快速开始

需要 **Node.js ≥26** 与 **pnpm 9**（见根 `packageManager`）。

```bash
git clone https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
pnpm install
pnpm build

# 无 API key：replay LLM
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"

# HTTP + Face（无产品壳 dist 时回退 apps/console）
node apps/cli/dist/bin.js serve --preset server --workspace .
```

接真模型时设置 `XRK_LLM_*`（见 [配置](./docs/configuration.md)）。一步步说明、产品壳组装与常见问题：[docs/getting-started.md](./docs/getting-started.md)。

示例：[examples/hello-agent](./examples/hello-agent)。

## 仓库布局

```text
apps/cli · apps/web · apps/console     CLI · 产品壳 · Face 验证台
packages/client                        壳客户端包（与 apps/web 成对）
packages/*                             @xrkseek 库（kernel · compose · core* · llm · mcp · server · …）
presets/                               minimal | harness | server
docs/                                  规格 · ADR · 模块地图
extensions/                            进程插件示例
```

包平面与依赖边：[docs/architecture.md](./docs/architecture.md) · [docs/modules/](./docs/modules/README.md)。

## 文档去哪读

| 你想… | 打开 |
|-------|------|
| 先跑起来 | [getting-started.md](./docs/getting-started.md) |
| 知道能正式用什么 | [status.md](./docs/status.md) |
| 配环境变量 / MCP / LLM | [configuration.md](./docs/configuration.md) |
| 懂架构 | [architecture.md](./docs/architecture.md) |
| 接 HTTP / Face | [http-api.md](./docs/http-api.md) · [host-face.md](./docs/host-face.md) |
| 排障 | [troubleshooting.md](./docs/troubleshooting.md) |
| 贡献 / 门禁 | [CONTRIBUTING.md](./CONTRIBUTING.md) · [testing.md](./docs/testing.md) |
| 全索引 | [docs/README.md](./docs/README.md) |

维护者与 Agent 约定留在 [AGENTS.md](./AGENTS.md)，不进产品说明。

## 许可

[MIT](./LICENSE) © [xrkseek](https://github.com/xrkseek)
