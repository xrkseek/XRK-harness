# @xrkseek/attachment-local

Disk-backed attachment store under `{XRK_HOME}/attachments/v1` with sharp
normalization. Deterministic `readImageRequest` variants live under the
rebuildable `{XRK_HOME}/cache/attachments/request-images/` tree (via
`xrkCachePath`); clearing that cache never deletes durable originals.
