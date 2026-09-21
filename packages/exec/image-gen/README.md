# @xrkseek/exec-image-gen

Text-to-image Provider seam for the model tool surface.

- **Definition**: `ImageGenService.generate`
- **Provider**: `createMemoryImageGenProvider` · `createOpenAiImageGenProvider` · Host-injected
- **Consumer**: `createImageGenTools` → `image_generate`

Env: `XRK_IMAGE_GEN=memory` | `XRK_IMAGE_GEN=1` + `OPENAI_API_KEY` / `XRK_IMAGE_GEN_OPENAI_KEY`.

See [docs/image-gen.md](../../../docs/image-gen.md) · [docs/seams.md](../../../docs/seams.md).
