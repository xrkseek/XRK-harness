export const IMAGE_GEN_PROMPT_TEXT = [
  "Image generation:",
  "- Use `image_generate` for text-to-image and (when the Provider advertises it) image edit / i2i.",
  "- Put a complete visual prompt in `prompt`. Optional `size` and `n`.",
  "- Edit / i2i: pass `image_url` and/or `reference_image_urls` and/or `reference_attachment_ids` (Host attachments preferred).",
  "- Schema is capability-gated: if the active Provider is text-only, reference args are omitted.",
  "- Returns PNG bytes as base64; when AttachmentStore is wired, also an attachment id.",
  "- Without Settings Image gen / `XRK_IMAGE_GEN=1` (+ key) / `memory`, the tool stays visible and fails honestly.",
].join("\n");
