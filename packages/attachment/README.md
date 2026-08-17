# `@xrkseek/attachment`

Durable **image** blob store (DSH-aligned). Session events hold `ImageAttachmentRef` only; bytes live here.

## Exports

- `createMemoryAttachmentStore` — content-addressed in-memory store
- `AttachmentStore` — `validateImage` / `saveImages` / `readImage`
- `AttachmentError` — stable `code` (`IMAGE_TOO_LARGE`, `NOT_FOUND`, …)

## Non-goals (v1)

- Disk / `$HOME` layout (Host may add later)
- PDF / audio / video
- GC / retention

文件地图：[docs/modules/attachment.md](../../docs/modules/attachment.md)（若有）· [docs/learn.md](../../docs/learn.md)
