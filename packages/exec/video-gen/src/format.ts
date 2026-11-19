/**
 * System-prompt fragment for video_generate.
 * Schema + description own the action surface; keep only the job lifecycle
 * and attachment address that models otherwise invent.
 */
export const VIDEO_GEN_PROMPT_TEXT = [
  "Video generation (`video_generate`):",
  "- Lifecycle: `action=start` → `jobId`; poll `status` / `wait`; then `content` for the MP4.",
  "- i2v / refs: `first_frame` · `image_url` · `reference_attachment_ids`. `action=catalog` lists families; `edit`/`extend` need prior `job_id`.",
  "- Finished `content` → `attachmentId=sha256:…` (Host file attachment — not a workspace path).",
].join("\n");
