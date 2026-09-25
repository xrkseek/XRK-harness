# @xrkseek/exec-image-gen

Text-to-image / image-to-image Provider seam for the model tool surface.

- **Definition**: `ImageGenService.generate` + optional `capabilities()`
- **Provider**: `createMemoryImageGenProvider` · `createOpenAiImageGenProvider` (generations + edits)
- **Consumer**: `createImageGenTools` → `image_generate` (schema rebuilt from capabilities)

Edit args (`image_url` · `reference_image_urls` · `reference_attachment_ids`) appear only when the Provider advertises image modalities.

Env: `XRK_IMAGE_GEN=memory` | `XRK_IMAGE_GEN=1` + `OPENAI_API_KEY` / `XRK_IMAGE_GEN_OPENAI_KEY`.

See [docs/image-gen.md](../../../docs/image-gen.md) · [docs/seams.md](../../../docs/seams.md).
