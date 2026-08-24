# Host 与 Preset / Host Preset

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

## 平面 / Planes

| 平面 / Plane | 名字 / Name | 职责 / Role |
|-------|------|------|
| Session | `minimal` / `harness`（UI：**XRK Harness**） | tools + persona + pipeline + workspace inject |
| Host | `server`（CLI / `@xrkseek/preset-server`） | HTTP lifecycle + agent factory；**工具面 = harness** / **tool surface = harness** |
| Workspace agent | 仓库 `.agents/` · `~/.agents/` · `{workspace}/.xrk` | inject + skills / persona / plugin-authoring |

`server` 不是第三套工具表。产品徽章只展示 Minimal / XRK Harness；遗留 wire 值 `server` → `harness`。选型表：[profiles.md](./profiles.md)。

`server` is not a third tool table. Product badges show only Minimal / XRK Harness; legacy wire value `server` → `harness`. Selection table: [profiles.md](./profiles.md).

Presets 不得向根 realm 发布冲突服务——只做组合。

Presets must not publish conflicting services to a root realm — composition only.

## 工作区 inject / Workspace Inject

默认（三层 assemble 开启时），preset 在 turn 开始时追加 durable workspace inject（`skill-catalog` / `agent-instructions` 的 `user/message` 行）。可用 `workspaceInject: false` 关闭。

By default (when three-layer assemble is on), presets append durable workspace injects (`skill-catalog` / `agent-instructions` `user/message` rows) at turn start. Opt out with `workspaceInject: false`.

详情 / Details：[workspace-inject.md](./workspace-inject.md)。插件写法 / Plugin how-to：[plugin-development.md](./plugin-development.md)。

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

`web` / `serve` default to **harness** (including `web_search` / `web_fetch`). Use `--preset minimal` for smoke tests only.  
`restart` reads `~/.xrk/run/host-<port>.pid.json`, gracefully stops that local XRK Host, then starts again (it does not kill whatever owns the port).  
`--force` stops only fingerprint-matched XRK Hosts; failure if a non-XRK process holds the port.  
The Host factory picks composition by **session badge**; `--preset` only seeds the default for new sessions.

插件 / Plugins：[plugin-loader.md](./plugin-loader.md) · [plugin-development.md](./plugin-development.md)。HTTP：[http-api.md](./http-api.md)。
