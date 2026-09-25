/** System-prompt fragment for video_analyze (boundary vs browser_vision). */

export const VIDEO_ANALYZE_PROMPT_TEXT = [
  "## Video analysis",
  "Use `video_analyze` for video files or video URLs (mp4/webm/mov/…). ",
  "It sends the whole clip to a video-capable multimodal model and returns a text analysis — not frame extraction. ",
  "Do **not** use it for live browser pages (use `browser_vision`) or static images (use `read_image`). ",
  "Do **not** use `video_generate` here — that tool creates videos, it does not understand them. ",
  "Large clips (>20 MB) may be slow; hard limit ~50 MB.",
].join("");
