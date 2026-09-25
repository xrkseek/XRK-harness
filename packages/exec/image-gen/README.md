# @xrkseek/exec-image-gen

Text-to-image / image-to-image Provider seam for the model tool surface.

**Product path**: Settings → Plugins → Image generation (Face ns `image-gen`). Credentials hold `XRK_IMAGE_GEN_OPENAI_KEY`. Env (`XRK_IMAGE_GEN=memory` / `=1`) is CI / headless bypass only — see [docs/image-gen.md](../../../docs/image-gen.md).

- **Definition**: `ImageGenService.generate` + optional `capabilities()`
- **Provider**: `createMemoryImageGenProvider` · `createOpenAiImageGenProvider` (generations + edits)
- **Consumer**: `createImageGenTools` → `image_generate` (schema rebuilt from capabilities)

Edit args (`image_url` · `reference_image_urls` · `reference_attachment_ids`) appear only when the Provider advertises image modalities.

See also [docs/seams.md](../../../docs/seams.md).
