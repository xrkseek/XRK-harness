# @xrkseek/exec-video-gen

Text-to-video / image-to-video Provider seam for the model tool surface.

**Product path**: Settings → Plugins → Video generation (Face ns `video-gen`). Modes: `off` · `openai` · `fal` · `xai`. Credentials hold `XRK_VIDEO_GEN_OPENAI_KEY` / `XRK_VIDEO_GEN_FAL_KEY` / `XRK_VIDEO_GEN_XAI_KEY` (runtime also accepts `OPENAI_API_KEY` · `FAL_KEY` · `XAI_API_KEY`). Env (`XRK_VIDEO_GEN=memory` / `=1` / `fal` / `xai`) is CI / headless bypass only — see [docs/video-gen.md](../../../docs/video-gen.md).

- **Definition**: `VideoGenService` — `create` · `get` · `content` (+ optional `capabilities`)
- **Provider**: `createMemoryVideoGenProvider` · `createOpenAiVideoGenProvider` · Host-injected
- **Consumer**: `createVideoGenTools` → `video_generate` (schema rebuilt from `capabilities()`)

Renders are asynchronous, so the seam exposes job semantics instead of one-shot bytes:
`create` returns a `jobId`, `get` polls status, and `content` downloads the MP4 once
`status=completed` (an early `content` call raises `VIDEO_GEN_NOT_READY`).

**i2v**: pass a decoded `firstFrame` (tools resolve `first_frame` / `image_url` /
`reference_attachment_ids`). OpenAI uploads it as multipart `input_reference`.

**edit / extend**: `create({ kind: "edit"|"extend", sourceVideoId, prompt })` →
`POST /videos/edits` · `/videos/extensions`. Tools expose `action=edit|extend|catalog`.

**Family catalog**: `capabilities().families` (Hermes fal-style; OpenAI lists sora-2 / sora-2-pro).

Video bytes are never inlined into tool text; with an `AttachmentStore` the finished MP4 is
persisted via `saveFile` and returned as an attachment id.

See also [docs/seams.md](../../../docs/seams.md).
