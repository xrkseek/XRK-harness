# host-preset

> **读者**：集成者 · 贡献者。

## Planes

| Plane | 名字 | Role |
|-------|------|------|
| Session | `minimal` / `harness` | tools + persona + pipeline + workspace inject（会话 `agentPreset`） |
| Host | `server`（CLI / `@xrkseek/preset-server`） | HTTP lifecycle + agent factory；**工具面 = harness** |

`server` 不是第三套工具表。产品徽章只展示 Minimal / Harness；遗留 wire 值 `server` → `harness`。选型表：[profiles.md](./profiles.md)。

Presets must not publish conflicting services to a root realm — composition only.

## Workspace inject

By default (when three-layer assemble is on), presets load `{workspace}/.xrk` into
`assemble.workspaceBlocks`. Opt out with `workspaceInject: false`.

Details: [workspace-inject.md](./workspace-inject.md).

## Serve

```bash
pnpm check
node apps/cli/dist/bin.js web
# or explicit:
# node apps/cli/dist/bin.js serve --preset harness
# XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js serve
```

`web` / `serve` 默认 **harness**（含 `web_search` / `web_fetch`）。仅烟测可 `--preset minimal`。  
Host 工厂按**会话徽章**选 composition（与 DSH「徽章即组合」一致）；`--preset` 只种子化新会话默认值。

Plugins: [plugin-loader.md](./plugin-loader.md). HTTP: [http-api.md](./http-api.md).
