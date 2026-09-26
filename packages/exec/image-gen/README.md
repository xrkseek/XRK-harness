# @xrkseek/exec-image-gen

Text-to-image / image-to-image Provider seam for the model tool surface.

**Product path**: Settings → Plugins → Image generation (Face ns `image-gen`). Modes: `off` · `openai` · `fal` · `xai`. Credentials hold `XRK_IMAGE_GEN_OPENAI_KEY` / `XRK_IMAGE_GEN_FAL_KEY` / `XRK_IMAGE_GEN_XAI_KEY` (runtime also accepts `OPENAI_API_KEY` · `FAL_KEY` · `XAI_API_KEY`). Env (`XRK_IMAGE_GEN=memory` / `=1` / `fal` / `xai`) is CI / headless bypass only — see [docs/image-gen.md](../../../docs/image-gen.md).

- **Definition**: `ImageGenService.generate` + optional `capabilities()`
- **Provider**: `createMemoryImageGenProvider` · `createOpenAiImageGenProvider` (generations + edits)
- **Consumer**: `createImageGenTools` → `image_generate` (schema rebuilt from capabilities)

Edit args (`image_url` · `reference_image_urls` · `reference_attachment_ids`) appear only when the Provider advertises image modalities.

See also [docs/seams.md](../../../docs/seams.md).
