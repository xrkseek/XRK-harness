/**
 * Fixed-density heuristic token pricing (DSH token-meter estimate.ts).
 * Shared by Face meter fold and compaction shadow-price producers.
 *
 * Route-aware image pricing lives in {@link priceRouteImageTokens}.
 * Surface fold has no live route → calls it without modalities (heuristic).
 * Soft-budget / request estimate passes adapter `inputModalities`.
 */

import { estimateImageTokens } from "@xrkseek/attachment";
import type { ImageMediaType, MessageContent, ToolCall } from "@xrkseek/protocol";
import { isImageMediaType, textOnlyImageText } from "@xrkseek/protocol";

const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
export const ROLE_OVERHEAD = 4;

export function estimateText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** CJK / kana / hangul — denser than ASCII under real BPE (often ≈1 tok/char). */
function isCjkDenseCodePoint(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0x3000 && cp <= 0x303f)
  );
}

/**
 * Soft-budget / overflow text density when the provider has not reported usage.
 * ASCII stays chars/4 (same as {@link estimateText}); CJK counts ~1 tok/char so
 * no-ring routes do not under-compact. Meter surface fold keeps {@link estimateText}.
 */
export function estimateTextForSoftBudget(text: string): number {
  if (!text) return 0;
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    units += isCjkDenseCodePoint(cp) ? 1 : 1 / CHARS_PER_TOKEN;
  }
  return Math.ceil(units);
}

export type InputModality = "text" | "image";

export type ImagePricingKind = "vision" | "text-placeholder" | "heuristic";

/**
 * Price image occurrences for the active route (A6).
 *
 * - `inputModalities` includes `"image"` → DeepSeek V41 vision tokens
 * - `inputModalities` text-only → placeholder text density
 * - modalities omitted → chars/4 heuristic (annotated; surface fold path)
 *
 * Fail loud when `expectedCount` disagrees with `images.length`.
 */
export function priceRouteImageTokens(
  images: readonly {
    readonly width: number;
    readonly height: number;
    readonly attachmentId?: string;
    readonly mediaType?: string;
    readonly bytes?: number;
    readonly name?: string;
  }[],
  options?: {
    readonly inputModalities?: readonly InputModality[];
    readonly expectedCount?: number;
  },
): {
  readonly tokens: number;
  readonly pricing: ImagePricingKind;
} {
  if (
    options?.expectedCount !== undefined &&
    images.length !== options.expectedCount
  ) {
    throw new Error(
      `image pricing: occurrence count ${images.length} !== expected ${options.expectedCount}`,
    );
  }

  const modalities = options?.inputModalities;
  const pricing: ImagePricingKind =
    modalities === undefined
      ? "heuristic"
      : modalities.includes("image")
        ? "vision"
        : "text-placeholder";

  let tokens = 0;
  for (const img of images) {
    if (pricing === "text-placeholder") {
      const mediaType: ImageMediaType = isImageMediaType(img.mediaType)
        ? img.mediaType
        : "image/png";
      tokens += estimateText(
        textOnlyImageText({
          attachmentId: img.attachmentId ?? "sha256:unknown",
          mediaType,
          bytes: img.bytes ?? 0,
          width: img.width,
          height: img.height,
          ...(img.name !== undefined ? { name: img.name } : {}),
        }),
      );
      continue;
    }
    if (pricing === "vision") {
      if (
        Number.isSafeInteger(img.width) &&
        Number.isSafeInteger(img.height) &&
        img.width > 0 &&
        img.height > 0
      ) {
        tokens += estimateImageTokens(img.width, img.height);
      } else {
        // Dims unusable — still under the vision arm; fall back to density.
        tokens += estimateText(JSON.stringify(img));
      }
      continue;
    }
    // heuristic: no route — chars/4 of a stable attachment summary
    tokens += estimateText(
      JSON.stringify({
        w: img.width,
        h: img.height,
        bytes: img.bytes ?? 0,
        id: img.attachmentId ?? "",
      }),
    );
  }
  return { tokens, pricing };
}

function imageBlockTokens(
  attachment: {
    readonly width: number;
    readonly height: number;
    readonly attachmentId: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly name?: string;
  },
  inputModalities?: readonly InputModality[],
): number {
  return priceRouteImageTokens(
    [
      {
        width: attachment.width,
        height: attachment.height,
        attachmentId: attachment.attachmentId,
        mediaType: attachment.mediaType,
        bytes: attachment.bytes,
        ...(attachment.name !== undefined ? { name: attachment.name } : {}),
      },
    ],
    {
      expectedCount: 1,
      ...(inputModalities !== undefined ? { inputModalities } : {}),
    },
  ).tokens;
}

export function estimateContent(
  content: MessageContent,
  options?: { readonly inputModalities?: readonly InputModality[] },
): number {
  if (typeof content === "string") {
    return estimateText(content) + BLOCK_OVERHEAD;
  }
  let tokens = 0;
  for (const block of content) {
    if (block.type === "text") {
      tokens += estimateText(block.text) + BLOCK_OVERHEAD;
    } else if (block.type === "image") {
      if (block.offloaded === true) continue;
      // ponytail: surface fold omits modalities → heuristic; soft-budget passes route.
      tokens +=
        imageBlockTokens(block.attachment, options?.inputModalities) +
        BLOCK_OVERHEAD;
    } else {
      tokens +=
        BLOCK_OVERHEAD +
        Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}

export function estimateMessageContent(
  content: MessageContent,
  options?: { readonly inputModalities?: readonly InputModality[] },
): number {
  return estimateContent(content, options) + ROLE_OVERHEAD;
}

export function estimateToolCall(call: ToolCall): number {
  const args =
    typeof call.arguments === "string"
      ? call.arguments
      : JSON.stringify(call.arguments ?? {});
  return estimateText(call.name) + estimateText(args) + BLOCK_OVERHEAD;
}

export function estimateAssistantSurface(
  content: string,
  toolCalls?: readonly ToolCall[],
): number {
  let tokens = estimateMessageContent(content);
  if (!toolCalls?.length) return tokens;
  for (const call of toolCalls) {
    tokens += estimateToolCall(call);
  }
  return tokens;
}

export function estimateSystemTokens(system: string | undefined): number {
  if (!system?.trim()) return 0;
  return estimateText(system) + ROLE_OVERHEAD;
}

export function estimateToolsTokens(
  tools:
    | readonly {
        readonly name: string;
        readonly description: string;
        readonly parameters: Record<string, unknown>;
      }[]
    | undefined,
): number {
  if (!tools || tools.length === 0) return 0;
  return (
    Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
  );
}
