# @xrkseek/session-projection

> **Audience**: Integrators · Contributors

Session-projection **seam**: dual type tables + drive registry.

Host Face (or any carrier) owns mux / history blocks. Domain code registers
pure fold units. Clients never fold domain events — they receive finished
wire values.

## Public API

| Symbol | Role |
| --- | --- |
| `SessionProjectionMap` | Merge-extensible **client** view table |
| `SessionProjectionStateMap` | Merge-extensible **host** fold-state table |
| `ProjectionDefinition` | `{ key, stateVersion, init, apply, wire? }` — omit `wire` for host-only |
| `createSessionProjectionRegistry` | `register` · `drive` · `snapshot` (views only) · `stateOf` · `checkpoint` · `restoreFloor` / `viewCheckpoint` / `restore` · `onChanged` · `setSidecar` |

No Cordis. No protocol vocabulary on this layer.

Face default keys (including **`turnOutline`**) and push tiers: [docs/modules/session-projection.md](../../../docs/modules/session-projection.md).

## Related

Face carrier + default units: `@xrkseek/server-face`. Client type outlet stub: `@xrkseek/xrk-session-projection`.
