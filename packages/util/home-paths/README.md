Shared product-home helpers (`XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME` → `~/.xrk`).

Leaf packages and Host import this instead of inlining env loops.
`xrkCachePath` joins under `{home}/cache/…` for rebuildable data (e.g. request-image variants).
