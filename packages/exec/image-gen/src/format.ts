/**
 * Model-facing image_generate envelopes — short, location-clear (Codex-style).
 */

export const IMAGE_GEN_PROMPT_TEXT = [
  "Image generation:",
  "- Call `image_generate` with a full visual `prompt` (optional `size` / `n`). Edit/i2i when the Provider allows refs.",
  "- Edit refs: pass `reference_attachment_ids` (or `image_url=attachment:<id>` / https). Never paste `data:image/…;base64,…` into tool args — the call truncates (INCOMPLETE_TOOL_CALL).",
  "- Result: chat shows the image; text gives `attachmentId=sha256:…`. That id is the durable address — not a filesystem path.",
  "- Re-inspect or zoom: `read_image` with `file_path` set to that id (or `attachment:<id>`). Do not search `~/.xrk` or invent paths.",
  "- Reuse as edit input: `reference_attachment_ids` / `image_url=attachment:<id>`.",
].join("\n");

/** One generated image row in the model-visible tool text. */
export function formatImageGenImageLines(input: {
  readonly index: number;
  readonly mimeType: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly attachmentId?: string;
  readonly revisedPrompt?: string;
  readonly url?: string;
}): string[] {
  const lines: string[] = [`--- image ${input.index} ---`];
  const size =
    input.width !== undefined && input.height !== undefined
      ? ` ${input.width}x${input.height}`
      : "";
  lines.push(`mime=${input.mimeType} bytes=${input.bytes}${size}`);
  if (input.revisedPrompt) lines.push(`revised_prompt=${input.revisedPrompt}`);
  if (input.url) lines.push(`url=${input.url}`);
  if (input.attachmentId) {
    lines.push(`attachmentId=${input.attachmentId}`);
    lines.push(
      "use=Shown in chat. Re-inspect: read_image file_path=<attachmentId>. Not a disk path.",
    );
  } else {
    lines.push(
      "use=No AttachmentStore — image not durable; enable Host attachments for chat preview.",
    );
  }
  return lines;
}
