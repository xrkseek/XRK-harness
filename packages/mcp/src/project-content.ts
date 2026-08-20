/**
 * MCP result → model-visible content (DSH mcp-client projectContent / extractText).
 * Trust boundary: fields MCP declares required may be missing from buggy servers.
 */

import type {
  AttachmentStore,
  ImageMediaType,
  SaveImageAttachment,
} from "@xrkseek/attachment";
import { IMAGE_MEDIA_TYPES } from "@xrkseek/attachment";
import type { ContentBlock, ImageAttachmentRef, MessageContent } from "@xrkseek/protocol";

/** Loose MCP content block at the network trust boundary. */
export interface McpContentBlock {
  type: string;
  text?: string;
  mimeType?: string;
  data?: string;
  name?: string;
  uri?: string;
}

/** Optional durable image admission (Host AttachmentStore + modality gate). */
export interface McpImageAdmission {
  readonly attachments: AttachmentStore;
  /** True when the active model route declares image input. */
  readonly allowsImageInput: () => boolean | Promise<boolean>;
}

/** Canonical RFC 4648 base64 (no whitespace / URL-safe aliases). */
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/** Stable diagnostic text for an image block that was not admitted. */
export function imageDiagnostic(block: McpContentBlock, reason: string): string {
  const mediaType = block.mimeType ?? "unknown media type";
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`;
}

/** Decode one untrusted MCP image block without accepting base64 aliases. */
export function decodeMcpImage(block: McpContentBlock): SaveImageAttachment {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error("the declared media type is not PNG, JPEG, WebP, or GIF");
  }
  if (block.data === undefined || !CANONICAL_BASE64.test(block.data)) {
    throw new Error("the image data is not canonical base64");
  }
  const data = Buffer.from(block.data, "base64");
  if (data.toString("base64") !== block.data) {
    throw new Error("the image data is not canonical base64");
  }
  return { data, mediaType: block.mimeType };
}

export function mcpContentHasImage(content: readonly unknown[]): boolean {
  return content.some((value) => isRecord(value) && value.type === "image");
}

/**
 * Project ordered MCP blocks into the core content vocabulary.
 * Text-like runs are newline-coalesced; admitted images split those runs.
 */
export function projectMcpContent(
  mcpContent: readonly unknown[],
  toolName: string,
  image: (
    block: McpContentBlock,
    index: number,
  ) => ContentBlock = (block) => ({
    type: "text",
    text: imageDiagnostic(
      block,
      "this result was not admitted to durable model context",
    ),
  }),
): ContentBlock[] {
  const projected: ContentBlock[] = [];
  const text: string[] = [];
  const flushText = (): void => {
    if (text.length === 0) return;
    projected.push({ type: "text", text: text.splice(0).join("\n") });
  };

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push("[unsupported MCP content block: expected an object]");
      continue;
    }
    const block = value as unknown as McpContentBlock;
    switch (block.type) {
      case "text":
        if (block.text !== undefined) text.push(block.text);
        break;
      case "image":
        flushText();
        projected.push(image(block, index));
        break;
      case "resource_link":
        if (block.name === undefined || block.uri === undefined) {
          text.push(
            "[resource link unavailable: the MCP block is missing its name or URI]",
          );
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`);
        }
        break;
      case "audio":
        text.push(
          `[audio result unsupported: ${block.mimeType ?? "unknown media type"}; raw audio data remains available to programmatic callers]`,
        );
        break;
      case "resource":
        text.push(
          "[embedded resource unsupported; raw resource data remains available to programmatic callers]",
        );
        break;
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`);
    }
  }
  flushText();
  return projected.length > 0
    ? projected
    : [{ type: "text", text: `(${toolName} returned no model-visible content)` }];
}

/**
 * Extract text from an MCP content array into a single string.
 * Image / audio / resource blocks become explicit diagnostics — never JSON dumps.
 */
export function extractMcpText(
  mcpContent: readonly unknown[],
  toolName: string,
): string {
  const content = projectMcpContent(mcpContent, toolName);
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text (raw bytes stay out of the model log).
 */
export async function prepareMcpImageProjection(
  mcpContent: readonly unknown[],
  toolName: string,
  admission: McpImageAdmission,
): Promise<ContentBlock[]> {
  const decoded: SaveImageAttachment[] = [];
  const validationErrors = new Map<number, string>();
  const imageIndexes: number[] = [];

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value) || value.type !== "image") continue;
    imageIndexes.push(index);
    try {
      decoded.push(decodeMcpImage(value as unknown as McpContentBlock));
    } catch (error: unknown) {
      validationErrors.set(
        index,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (validationErrors.size > 0) {
    return projectMcpContent(mcpContent, toolName, (block, index) => ({
      type: "text",
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ??
          "another image in the same result was invalid",
      ),
    }));
  }

  let allows = false;
  try {
    allows = await admission.allowsImageInput();
  } catch (error: unknown) {
    const reason =
      error instanceof Error
        ? error.message
        : "the current model route could not be verified";
    return projectMcpContent(mcpContent, toolName, (block) => ({
      type: "text",
      text: imageDiagnostic(block, reason),
    }));
  }
  if (!allows) {
    return projectMcpContent(mcpContent, toolName, (block) => ({
      type: "text",
      text: imageDiagnostic(block, "the current model does not declare image input"),
    }));
  }

  try {
    const refs = await admission.attachments.saveImages(decoded);
    const byIndex = new Map(
      imageIndexes.map(
        (index, offset) =>
          [index, refs[offset] as ImageAttachmentRef] as const,
      ),
    );
    return projectMcpContent(mcpContent, toolName, (_block, index) => ({
      type: "image",
      attachment: byIndex.get(index) as ImageAttachmentRef,
    }));
  } catch (error: unknown) {
    const reason =
      error instanceof Error
        ? `image admission rejected the result: ${error.message}`
        : "durable image storage rejected the result";
    return projectMcpContent(mcpContent, toolName, (block) => ({
      type: "text",
      text: imageDiagnostic(block, reason),
    }));
  }
}

/**
 * Map an MCP tools/call payload to model-visible {@link MessageContent}.
 * Images → attachment refs when admission succeeds; otherwise diagnostic text.
 */
export async function mapMcpCallContent(
  raw: unknown,
  toolName: string,
  admission?: McpImageAdmission,
): Promise<{
  readonly content: MessageContent;
  readonly isError?: boolean;
}> {
  const isError =
    typeof raw === "object" &&
    raw !== null &&
    "isError" in raw &&
    Boolean((raw as { isError?: boolean }).isError);

  const payload =
    typeof raw === "object" && raw !== null && "content" in raw
      ? (raw as { content: unknown }).content
      : raw;

  if (!Array.isArray(payload)) {
    const text =
      typeof payload === "string"
        ? payload
        : payload === undefined || payload === null
          ? `(${toolName} returned no model-visible content)`
          : JSON.stringify(payload);
    return { content: text, ...(isError ? { isError: true as const } : {}) };
  }

  if (mcpContentHasImage(payload) && admission !== undefined) {
    const blocks = await prepareMcpImageProjection(payload, toolName, admission);
    // All-text projection collapses to a string (matches DSH extractText path).
    if (blocks.every((b) => b.type === "text")) {
      return {
        content: blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n"),
        ...(isError ? { isError: true as const } : {}),
      };
    }
    return {
      content: blocks,
      ...(isError ? { isError: true as const } : {}),
    };
  }

  return {
    content: extractMcpText(payload, toolName),
    ...(isError ? { isError: true as const } : {}),
  };
}
