# `@xrkseek/attachment`（文件地图）

> **读者**：贡献者 · 维护者

| 文件 | 职责 |
|------|------|
| `types.ts` | limits · SaveImage · StoredImage；`ImageAttachmentRef` 复用 protocol |
| `store.ts` | `AttachmentStore` 缝 |
| `memory.ts` | 内容寻址内存实现（Host 默认） |
| `image-meta.ts` | magic sniff + 头解析宽高 |
| `image-region.ts` | Hermes 式 `[x1,y1,x2,y2]` 解析 / 夹紧（裁剪在 normalize 前） |
| `digest.ts` | `sha256:<hex>` id |
| `error.ts` | `AttachmentError` + 稳定 `code` |

## 不变量

1. 事件日志只存 ref，不存 base64 / 路径 / URL。  
2. `saveImages`：先整批 validate，再写；validate 失败无部分提交。  
3. Host Face：`inputModalities` 无 `image` → prompt 图在写盘前拒（`unsupported-modality`）。默认 Host 含 `image`；LLM 适配器仍可 text-only。

本地盘仓（`@xrkseek/attachment-local`）：持久原图在 `{XRK_HOME}/attachments/v1`；请求变体缓存在 `{XRK_HOME}/cache/attachments/request-images/`（可删可重建，不碰原图）。`cropImageRegion`（sharp）供 `read_image.region` 在 admission normalize 前裁剪。

相关：[protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) · [server-face.md](./server-face.md)

---

# `@xrkseek/attachment` (file map)

> **Audience**: Contributors · Maintainers

| File | Responsibility |
|------|----------------|
| `types.ts` | limits · SaveImage · StoredImage; `ImageAttachmentRef` from protocol |
| `store.ts` | `AttachmentStore` seam |
| `memory.ts` | Content-addressed in-memory store (Host default) |
| `image-meta.ts` | Magic sniff + header width/height |
| `image-region.ts` | Hermes-style `[x1,y1,x2,y2]` parse / clamp (crop before normalize) |
| `digest.ts` | `sha256:<hex>` id |
| `error.ts` | `AttachmentError` + stable `code` |

## Invariants

1. The event log stores refs only — never base64, paths, or URLs.  
2. `saveImages` validates the whole batch before write; validation failure commits nothing.  
3. Host Face: if `inputModalities` lacks `image`, prompt images are rejected before disk (`unsupported-modality`). Default Host includes `image`; LLM adapters may still be text-only.

Local disk store (`@xrkseek/attachment-local`): durable originals under `{XRK_HOME}/attachments/v1`; request variants under `{XRK_HOME}/cache/attachments/request-images/` (rebuildable; clearing cache never deletes originals). `cropImageRegion` (sharp) backs `read_image.region` before admission normalize.

See: [protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) · [server-face.md](./server-face.md)
