---
name: xrk-attachment
description: >-
  Content-addressed attachments (sha256 ids), on-disk layout, and read-back.
  Use when tracing an attachmentId, opening a chat image/file by id, or when
  the user says 附件、溯源、sha256、attachment.
---

# Attachments (content-addressed)

Attachment id `sha256:<hex>` **is** the address: bytes SHA-256. Derive the path from the id — **never** search the disk.

## Layout (`{XRK_HOME}`)

| Kind | Path |
|------|------|
| Image object | `attachments/v1/objects/<sha256 前 2 位>/<sha256>` |
| Ordinary file | `attachments/v1/files/<sha256 前 2 位>/<sha256>/<原始文件名>` |
| Request image cache (rebuildable) | `cache/attachments/request-images/` |

## Read-back

- `read_image file_path=sha256:…` or `attachment:sha256:…` — tool re-reads by id and re-admits.
- `image_generate` results expose `attachmentId=sha256:…` — same read path.
- Chat / tool-result refs use the same id → path derivation.
- UI reads via Face `session.attachment` (only ids referenced in that session).

Contract detail: `docs/modules/attachment.md`.
