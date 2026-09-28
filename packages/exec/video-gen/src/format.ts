export const VIDEO_GEN_PROMPT_TEXT = [
  "Video generation:",
  "- `video_generate`: `action=start` → `jobId`; poll `status` / `wait`; then `content` for the MP4.",
  "- Prompt fully (subject, motion, camera). Optional `seconds` (4·8·12) and `size`.",
  "- i2v: `first_frame` / `image_url` / `reference_attachment_ids` (https · data: · attachment:<id>). `action=catalog` lists families.",
  "- Edit/extend when supported: `action=edit|extend` + prior `job_id` + new `prompt`.",
  "- Finished `content` returns `attachmentId=sha256:…` (Host file attachment — not a workspace path). Do not search disks for the MP4.",
  "- Without Settings Video gen / `XRK_VIDEO_GEN`, the tool stays visible and fails honestly.",
].join("\n");
