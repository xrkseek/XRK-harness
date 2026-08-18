# `@xrkseek/attachment`（文件地图）

| 文件 | 职责 |
|------|------|
| `types.ts` | limits · SaveImage · StoredImage；`ImageAttachmentRef` 复用 protocol |
| `store.ts` | `AttachmentStore` 缝 |
| `memory.ts` | 内容寻址内存实现（Host 默认） |
| `image-meta.ts` | magic sniff + 头解析宽高 |
| `digest.ts` | `sha256:<hex>` id |
| `error.ts` | `AttachmentError` + 稳定 `code` |

## 不变量

1. 事件日志只存 ref，不存 base64 / 路径 / URL。  
2. `saveImages`：先整批 validate，再写；validate 失败无部分提交。  
3. Host Face：`inputModalities` 无 `image` → prompt 图在写盘前拒（`unsupported-modality`）。默认 Host 含 `image`；LLM 适配器仍可 text-only。

相关：[protocol-events.md](../protocol-events.md) · [host-face.md](../host-face.md) · [server-face.md](./server-face.md)
