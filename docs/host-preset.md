# host-preset

## Planes

| Plane | Preset | Role |
|-------|--------|------|
| Session | `minimal` / `harness` | tools + persona + pipeline + workspace inject |
| Host | `server` | HTTP lifecycle + agent factory |

Presets must not publish conflicting services to a root realm — composition only.

## Workspace inject

By default (when three-layer assemble is on), presets load `{workspace}/.xrk` into
`assemble.workspaceBlocks`. Opt out with `workspaceInject: false`.

Details: [workspace-inject.md](./workspace-inject.md).

## Serve

```bash
pnpm check
node apps/cli/dist/bin.js serve --preset minimal
# optional plugins (tools auto-wire into registry):
# XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js serve
```

Plugins: [plugin-loader.md](./plugin-loader.md). HTTP: [http-api.md](./http-api.md).
