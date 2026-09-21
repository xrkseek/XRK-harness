export const IMAGE_GEN_PROMPT_TEXT = [
  "Image generation:",
  "- Use `image_generate` for text-to-image. Put a complete visual prompt in `prompt` (subject, style, composition).",
  "- Optional `size` (e.g. 1024x1024) and `n`. Returns PNG bytes as base64; when AttachmentStore is wired, also an attachment id.",
  "- Without `XRK_IMAGE_GEN=1` (OpenAI key) or `XRK_IMAGE_GEN=memory`, the tool stays visible and fails honestly.",
].join("\n");
