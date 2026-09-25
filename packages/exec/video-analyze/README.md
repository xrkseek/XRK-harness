# `@xrkseek/exec-video-analyze`

Hermes-style **video understanding** tool (`video_analyze`).

- **In**: video URL or workspace path + question  
- **Out**: JSON `{ success, analysis, … }` text (whole-clip multimodal LLM — not frame extraction)  
- **Not**: `browser_vision` (live page screenshot) · `video_generate` (create video) · `read_image` (stills)

Providers: `memory` (CI) · OpenAI-compatible chat with `video_url` part (needs a video-capable model such as Gemini).

See [docs/video-analyze.md](../../../docs/video-analyze.md).
