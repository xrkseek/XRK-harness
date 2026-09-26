import type { AttachmentStore } from "@xrkseek/attachment";
import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import { IMAGE_GEN_PROMPT_TEXT } from "./format.js";
import { resolveImageGenReferenceImages } from "./references.js";
import {
  buildImageGenToolDescription,
  buildImageGenToolParameters,
  IMAGE_GEN_SIZES,
} from "./schema.js";
import {
  ImageGenError,
  isImageGenError,
  resolveImageGenCapabilities,
  type ImageGenService,
  type ImageGenSize,
} from "./types.js";

export { IMAGE_GEN_PROMPT_TEXT };

export function imageGenUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
  product?: { readonly mode?: string },
): string {
  const envRaw = String(env.XRK_IMAGE_GEN ?? "").trim();
  const productMode = String(product?.mode ?? "").trim().toLowerCase();
  const known = new Set([
    "openai",
    "fal",
    "xai",
    "openrouter",
    "deepinfra",
    "krea",
    "meta-ai",
    "meta",
  ]);
  const flag =
    envRaw !== ""
      ? envRaw.toLowerCase()
      : known.has(productMode)
        ? productMode === "openai"
          ? "1"
          : productMode
        : "";
  if (!flag) {
    return (
      "Error: image generation is not enabled. Use Settings → Plugins → Image gen " +
      "(openai / fal / xai / openrouter / deepinfra / krea / meta-ai), or set XRK_IMAGE_GEN=memory (CI/demo) " +
      "/=1|openai|fal|xai|openrouter|deepinfra|krea|meta-ai with the matching key. See docs/image-gen.md."
    );
  }
  if (flag === "1" || flag === "openai") {
    return (
      "Error: image gen (openai) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_OPENAI_KEY " +
      "(or OPENAI_API_KEY); optional base URL / model via Settings or env."
    );
  }
  if (flag === "fal") {
    return (
      "Error: image gen (fal) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_FAL_KEY " +
      "(or FAL_KEY); optional endpoint / model via Settings or env."
    );
  }
  if (flag === "xai") {
    return (
      "Error: image gen (xai) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_XAI_KEY " +
      "(or XAI_API_KEY); optional base URL / model via Settings or env."
    );
  }
  if (flag === "openrouter") {
    return (
      "Error: image gen (openrouter) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_OPENROUTER_KEY " +
      "(or OPENROUTER_API_KEY)."
    );
  }
  if (flag === "deepinfra") {
    return (
      "Error: image gen (deepinfra) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_DEEPINFRA_KEY " +
      "(or DEEPINFRA_API_KEY)."
    );
  }
  if (flag === "krea") {
    return (
      "Error: image gen (krea) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_KREA_KEY " +
      "(or KREA_API_KEY)."
    );
  }
  if (flag === "meta-ai" || flag === "meta") {
    return (
      "Error: image gen (meta-ai) is enabled but no API key. Set Credentials XRK_IMAGE_GEN_META_KEY " +
      "(or META_MODEL_API_KEY)."
    );
  }
  return (
    "Error: no ImageGenService Provider is configured. Inject a service or set XRK_IMAGE_GEN."
  );
}

export interface CreateImageGenToolsOptions {
  readonly service?: ImageGenService;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: { readonly mode?: string };
  /** When set, persist generated images and resolve reference_attachment_ids. */
  readonly attachments?: AttachmentStore;
  readonly fetchImpl?: typeof fetch;
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
  if (!(IMAGE_GEN_SIZES as readonly string[]).includes(s)) {
    throw new ImageGenError(
      `size must be one of ${IMAGE_GEN_SIZES.join(", ")}`,
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  return s;
}

function asStringList(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ImageGenError(
      "reference lists must be arrays of strings",
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  return raw.map((item) => String(item));
}

/**
 * Model-facing `image_generate` tool (Hermes-style t2i + edit in one tool).
 * Static fields are an initial bake; `dynamicSchema` rebuilds from live
 * Provider `capabilities()` on each materialize (Hermes get_definitions).
 */
export function createImageGenTools(
  options: CreateImageGenToolsOptions = {},
): ToolDefinition[] {
  const missing = imageGenUnavailableMessage(
    options.env ?? process.env,
    options.product,
  );
  const service = options.service;
  const attachments = options.attachments;
  const caps = resolveImageGenCapabilities(service);

  const tool: ToolDefinition<{
    prompt?: string;
    size?: string;
    n?: number;
    model?: string;
    image_url?: string;
    reference_image_urls?: string[];
    reference_attachment_ids?: string[];
  }> = {
    name: "image_generate",
    description: buildImageGenToolDescription(caps),
    parameters: buildImageGenToolParameters(caps) as unknown as Record<
      string,
      unknown
    >,
    dynamicSchema: () => {
      const live = resolveImageGenCapabilities(service);
      return {
        description: buildImageGenToolDescription(live),
        parameters: buildImageGenToolParameters(live) as unknown as Record<
          string,
          unknown
        >,
      };
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
        const liveCaps = resolveImageGenCapabilities(service);
        const prompt = String(args.prompt ?? "").trim();
        const size = parseSize(args.size);
        const n =
          typeof args.n === "number" && Number.isFinite(args.n)
            ? Math.trunc(args.n)
            : undefined;
        const refUrls = asStringList(args.reference_image_urls);
        const refAttach = asStringList(args.reference_attachment_ids);
        const referenceImages = await resolveImageGenReferenceImages({
          maxReferenceImages: liveCaps.maxReferenceImages,
          ...(args.image_url ? { imageUrl: String(args.image_url) } : {}),
          ...(refUrls ? { referenceImageUrls: refUrls } : {}),
          ...(refAttach ? { referenceAttachmentIds: refAttach } : {}),
          ...(attachments ? { attachments } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const result = await service.generate({
          prompt,
          ...(size ? { size } : {}),
          ...(n !== undefined ? { n } : {}),
          ...(args.model ? { model: String(args.model) } : {}),
          ...(referenceImages.length > 0 ? { referenceImages } : {}),
        });
        const lines: string[] = [
          `provider=${result.provider} delivery=${result.delivery} modality=${result.modality ?? "text"} images=${result.images.length}`,
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
