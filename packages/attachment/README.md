# `@xrkseek/attachment`

Durable **image** + generic-file blob store (DSH-aligned). Session events hold
`ImageAttachmentRef` / `FileAttachmentRef` only; bytes live here.

## Exports

- `createMemoryAttachmentStore` — content-addressed in-memory store
- `AttachmentStore` — `validateImage` / `saveImages` / `readImage` / `readImageRequest`
- `AttachmentError` — stable `code` (`IMAGE_TOO_LARGE`, `IMAGE_TOO_MANY_PIXELS`, …)
- `sniffImageMediaType` / `readImageSize` — header sniff + intrinsic size
- `requestImageDimensions` / `longEdgeDimensions` — pure projection geometry
- `estimateImageTokens` / `requestImageTokenDimensions` — DeepSeek V41 vision-token
  accounting (soft-budget + route request projection)
- `offloadRequestImages` — wire safety net for oversized base64 payloads

## Non-goals (v1)

- Disk / `$HOME` layout (see `@xrkseek/attachment-local`)
- PDF / audio / video
- GC / retention

文件地图：[docs/modules/attachment.md](../../docs/modules/attachment.md)（若有）· [docs/status.md](../../docs/status.md)
