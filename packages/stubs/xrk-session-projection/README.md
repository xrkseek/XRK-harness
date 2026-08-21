# @xrkseek/xrk-session-projection

> **读者**：贡献者 · 产品壳客户端。

Client **type outlet** for session projections: merge-extensible
`SessionProjectionMap` (and host-side `SessionProjectionStateMap` for
declaration merge). This stub does **not** own the Host drive registry.

## Where the real seam lives

| Layer | Package |
| --- | --- |
| Drive registry + dual tables + optional `wire` | `@xrkseek/session-projection` |
| Default units + mux / history carrier | `@xrkseek/server-face` (`projections/`) |
| Client typed keys | this stub + other `xrk-*` stubs that declare-merge `SessionProjectionMap` |

Clients only consume **wire views** (`SessionProjectionMap`). Host fold state
stays on the server (`stateOf` / checkpoint); do not treat stub Cordis-shaped
sources as the Host API.

## Related

[docs/modules/session-projection.md](../../../docs/modules/session-projection.md) ·
[docs/modules/server-face.md](../../../docs/modules/server-face.md) ·
`@xrkseek/session-projection`
