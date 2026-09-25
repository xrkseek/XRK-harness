export const VIDEO_GEN_PROMPT_TEXT = [
  "Video generation:",
  "- Use `video_generate` for text-to-video or image-to-video. Renders are **asynchronous**: `action=start` (default) returns a `jobId`; poll with `action=status` (or `action=wait` to block) until `status=completed`; then `action=content` downloads the MP4.",
  "- Put a complete visual prompt in `prompt` (subject, motion, camera, lighting). Optional `seconds` (4 · 8 · 12) and `size` (e.g. 1280x720).",
  "- Image-to-video: pass `first_frame` or `image_url` (https / data: / attachment:<id>) as the opening still; optional `reference_attachment_ids`. Use `action=catalog` to list model families.",
  "- Edit / extend (when the Provider supports them): `action=edit` or `action=extend` with `job_id` of a prior completed video plus a new `prompt`.",
  "- Video renders take minutes — call `start`, then poll `status` instead of blocking the turn.",
  "- Without `XRK_VIDEO_GEN=1` (OpenAI key) or `XRK_VIDEO_GEN=memory`, the tool stays visible and fails honestly.",
].join("\n");
