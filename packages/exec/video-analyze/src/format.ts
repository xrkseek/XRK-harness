/** System-prompt fragment for video_analyze (boundary vs browser_vision / video_generate). */

export const VIDEO_ANALYZE_PROMPT_TEXT = [
  "Video analysis (`video_analyze`): whole clip → multimodal text analysis (not frame extract).",
  "Not for live pages (`browser_vision`), stills (`read_image`), or creating video (`video_generate`). ~50 MB hard cap.",
].join(" ");
