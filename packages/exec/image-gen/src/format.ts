/**
 * Model-facing image_generate envelopes — short, location-clear (Codex-style).
 * Tool `description` already covers t2i vs edit; this fragment only adds
 * anti-patterns that schema text alone often fails to stop.
 */

export const IMAGE_GEN_PROMPT_TEXT = [
  "Image generation (`image_generate`):",
  "- Refs: `reference_attachment_ids` or `image_url=attachment:<id>` / https — never paste `data:image…;base64,…` (truncates).",
  "- Result `attachmentId=sha256:…` is the durable address (re-inspect: `read_image`; reuse as edit ref). Not a disk path.",
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
