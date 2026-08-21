# host-preset

> **读者**：集成者 · 贡献者。

## Planes

| Plane | 名字 | Role |
|-------|------|------|
| Session | `minimal` / `harness`（UI：**XRK Harness**） | tools + persona + pipeline + workspace inject |
| Host | `server`（CLI / `@xrkseek/preset-server`） | HTTP lifecycle + agent factory；**工具面 = harness** |
| Workspace seed | `templates/office-agent` · `templates/xrk-harness` | `.xrk` 人格 / 插件开发喂法 |

`server` 不是第三套工具表。产品徽章只展示 Minimal / XRK Harness；遗留 wire 值 `server` → `harness`。选型表：[profiles.md](./profiles.md)。

Presets must not publish conflicting services to a root realm — composition only.

## Workspace inject

By default (when three-layer assemble is on), presets append durable workspace
injects (`skill-catalog` / `agent-instructions` `user/message` rows) at turn
start. Opt out with `workspaceInject: false`.

Details: [workspace-inject.md](./workspace-inject.md). Plugin how-to: [plugin-development.md](./plugin-development.md).

## Serve

```bash
pnpm check
node apps/cli/dist/bin.js web
# free a stuck port:
# node apps/cli/dist/bin.js web --force
# XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --force
```

`web` / `serve` 默认 **harness**（含 `web_search` / `web_fetch`）。仅烟测可 `--preset minimal`。  
`restart`：读 `~/.xrk/run/host-<port>.pid.json`，优雅停本机 XRK Host 再起（不是「杀端口上任意进程」）。  
`--force`：仅停指纹匹配的 XRK Host；非 XRK 占用则失败。  
Host 工厂按**会话徽章**选 composition；`--preset` 只种子化新会话默认值。

Plugins: [plugin-loader.md](./plugin-loader.md) · [plugin-development.md](./plugin-development.md). HTTP: [http-api.md](./http-api.md).
