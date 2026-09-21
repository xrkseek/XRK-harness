import type { AttachmentStore } from "@xrkseek/attachment";
import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import { IMAGE_GEN_PROMPT_TEXT } from "./format.js";
import {
  ImageGenError,
  isImageGenError,
  type ImageGenService,
  type ImageGenSize,
} from "./types.js";

export { IMAGE_GEN_PROMPT_TEXT };

const SIZES: readonly ImageGenSize[] = [
  "256x256",
  "512x512",
  "1024x1024",
  "1792x1024",
  "1024x1792",
];

export function imageGenUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const flag = String(env.XRK_IMAGE_GEN ?? "").trim().toLowerCase();
  if (!flag) {
    return (
      "Error: image generation is not enabled. Set XRK_IMAGE_GEN=memory (CI/demo) or " +
      "XRK_IMAGE_GEN=1 with OPENAI_API_KEY / XRK_IMAGE_GEN_OPENAI_KEY. See docs/image-gen.md."
    );
  }
  if (flag === "1") {
    return (
      "Error: XRK_IMAGE_GEN=1 but no API key. Set OPENAI_API_KEY or XRK_IMAGE_GEN_OPENAI_KEY " +
      "(optional XRK_IMAGE_GEN_BASE_URL / XRK_IMAGE_GEN_MODEL)."
    );
  }
  return (
    "Error: no ImageGenService Provider is configured. Inject a service or set XRK_IMAGE_GEN."
  );
}

export interface CreateImageGenToolsOptions {
  readonly service?: ImageGenService;
  readonly env?: NodeJS.ProcessEnv;
  /** When set, persist generated images and return attachment ids. */
  readonly attachments?: AttachmentStore;
}

function fail(err: unknown): ToolResultContent {
  const message = isImageGenError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

function parseSize(raw: unknown): ImageGenSize | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim() as ImageGenSize;
  if (!(SIZES as readonly string[]).includes(s)) {
    throw new ImageGenError(
      `size must be one of ${SIZES.join(", ")}`,
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  return s;
}

/**
 * Model-facing `image_generate` tool (Hermes-style text-to-image).
 */
export function createImageGenTools(
  options: CreateImageGenToolsOptions = {},
): ToolDefinition[] {
  const missing = imageGenUnavailableMessage(options.env ?? process.env);
  const service = options.service;
  const attachments = options.attachments;

  const tool: ToolDefinition<{
    prompt?: string;
    size?: string;
    n?: number;
    model?: string;
  }> = {
    name: "image_generate",
    description:
      "Generate an image from a text prompt via the Host text-to-image Provider. " +
      "Returns PNG as base64 (truncated in tool text) and optional attachment id when the Host attachment store is wired.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Full visual description (subject, style, composition).",
        },
        size: {
          type: "string",
          enum: [...SIZES],
          description: "Output size (provider-dependent; default 1024x1024).",
        },
        n: {
          type: "number",
          description: "Number of images (1–4; dall-e-3 forces 1).",
        },
        model: {
          type: "string",
          description: "Optional model override (e.g. dall-e-3, gpt-image-1).",
        },
      },
      required: ["prompt"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Image generate",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args) {
      if (!service) return { content: missing, isError: true };
      try {
        const prompt = String(args.prompt ?? "").trim();
        const size = parseSize(args.size);
        const n =
          typeof args.n === "number" && Number.isFinite(args.n)
            ? Math.trunc(args.n)
            : undefined;
        const result = await service.generate({
          prompt,
          ...(size ? { size } : {}),
          ...(n !== undefined ? { n } : {}),
          ...(args.model ? { model: String(args.model) } : {}),
        });
        const lines: string[] = [
          `provider=${result.provider} delivery=${result.delivery} images=${result.images.length}`,
        ];
        if (result.note) lines.push(`note=${result.note}`);

        for (let i = 0; i < result.images.length; i += 1) {
          const img = result.images[i]!;
          let attachmentId: string | undefined;
          if (attachments) {
            const ref = await attachments.saveImage({
              data: img.bytes,
              mediaType: img.mimeType,
              name: `image_generate_${i + 1}.png`,
            });
            attachmentId = ref.attachmentId;
          }
          const b64 = Buffer.from(img.bytes).toString("base64");
          const preview =
            b64.length > 96 ? `${b64.slice(0, 96)}…(${b64.length} chars)` : b64;
          lines.push(`--- image ${i + 1} ---`);
          lines.push(`mime=${img.mimeType} bytes=${img.bytes.byteLength}`);
          if (img.revisedPrompt) lines.push(`revised_prompt=${img.revisedPrompt}`);
          if (img.url) lines.push(`url=${img.url}`);
          if (attachmentId) lines.push(`attachmentId=${attachmentId}`);
          lines.push(`image_base64=${preview}`);
        }
        return { content: lines.join("\n") };
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [tool];
}
