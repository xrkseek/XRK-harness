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

## 附件溯源（公开契约）

附件 id（`sha256:<hex>`）是**内容寻址**的：它即字节的 SHA-256，本身就是持久地址，且由 id **可直接推导落盘路径**（无需搜索磁盘）：

| 内容 | 路径 |
|------|------|
| 图片原图（admission normalize 后） | `{XRK_HOME}/attachments/v1/objects/<sha256 前 2 位>/<sha256>` |
| 普通文件 | `{XRK_HOME}/attachments/v1/files/<sha256 前 2 位>/<sha256>/<原始文件名>` |
| 请求变体缓存（可重建，删除不碰原图） | `{XRK_HOME}/cache/attachments/request-images/` |

读取入口（均按 id，模型可见，不翻磁盘）：

- `read_image file_path=sha256:…` / `attachment:sha256:…` — 回读图片并（重新）入库；
- `image_generate` 结果文本信封给 `attachmentId=sha256:…`，可再 `read_image` 溯源 / 放大；
- Face `session.attachment` — 按会话事件引用授权读取（仅本 session 引用过的 id），UI 端 base64 展示。

聊天记录里的图片/文件引用同样走这套：事件日志只存 ref，id → 路径推导一致，跨会话可溯源。

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

## Attachment tracing (public contract)

An attachment id (`sha256:<hex>`) is **content-addressed**: it *is* the SHA-256 of the bytes, a durable address, and the on-disk path is **derivable from the id alone** (no disk hunt):

| Content | Path |
|---------|------|
| Image originals (post admission-normalize) | `{XRK_HOME}/attachments/v1/objects/<first-2-hex>/<sha256>` |
| Generic files | `{XRK_HOME}/attachments/v1/files/<first-2-hex>/<sha256>/<sanitized-name>` |
| Request-variant cache (rebuildable; clearing never touches originals) | `{XRK_HOME}/cache/attachments/request-images/` |

Read entrypoints (all by id, model-visible, no disk search):

- `read_image file_path=sha256:…` / `attachment:sha256:…` — read an image back and (re-)persist;
- `image_generate` result text envelope carries `attachmentId=sha256:…`, re-inspectable / zoomable via `read_image`;
- Face `session.attachment` — authorized by session-event references (only ids referenced by this session), served as base64 to the UI.

Image/file references in chat history use the same scheme: the event log stores refs only, id → path derivation is uniform, traceable across sessions.

See: [protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) · [server-face.md](./server-face.md)
