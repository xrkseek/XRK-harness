/**
 * FAL.ai queue HTTP Provider — text-to-image + edit (Hermes fal catalog).
 * Uses the public queue REST API (no fal_client SDK).
 * @see https://fal.ai/docs
 */
import { resolveFalImageModel } from "./catalog.js";
import type {
  ImageGenCapabilities,
  ImageGenRequest,
  ImageGenResult,
  ImageGenService,
  ImageGenSize,
  ImageGenSourceImage,
} from "./types.js";
import { ImageGenError } from "./types.js";

export interface FalImageGenOptions {
  readonly apiKey: string;
  /** Queue origin; default `https://queue.fal.run`. */
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** T2I endpoint id (default Hermes DEFAULT_MODEL). */
  readonly model?: string;
  /** Edit endpoint; default from catalog or `${model}/edit`. */
  readonly editModel?: string;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly capabilities?: ImageGenCapabilities;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function falImageSize(size: ImageGenSize | undefined): string {
  switch (size) {
    case "1792x1024":
    case "1024x1792":
      return size.startsWith("1792") ? "landscape_16_9" : "portrait_16_9";
    case "512x512":
    case "256x256":
      return "square";
    case "1024x1024":
    default:
      return "square_hd";
  }
}

function bytesToDataUrl(img: ImageGenSourceImage): string {
  const b64 = Buffer.from(img.bytes).toString("base64");
  return `data:${img.mimeType};base64,${b64}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

interface FalSubmitResponse {
  readonly request_id?: string;
  readonly status_url?: string;
  readonly response_url?: string;
}

interface FalStatusResponse {
  readonly status?: string;
  readonly response_url?: string;
  readonly error?: string;
}

interface FalImageResult {
  readonly images?: Array<{ url?: string; content_type?: string }>;
  readonly image?: { url?: string };
}

async function downloadImage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" }> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new ImageGenError(
      `FAL image download HTTP ${res.status}`,
      "IMAGE_GEN_BACKEND",
    );
  }
  const ab = await res.arrayBuffer();
  const ct = (res.headers.get("content-type") ?? "image/png").split(";")[0]?.trim().toLowerCase();
  const mimeType =
    ct === "image/jpeg" || ct === "image/webp" || ct === "image/png"
      ? ct
      : ("image/png" as const);
  return { bytes: new Uint8Array(ab), mimeType };
}

/**
 * Poll FAL queue until COMPLETED, then GET response_url.
 */
async function waitFalResult(
  submit: FalSubmitResponse,
  options: {
    readonly apiKey: string;
    readonly fetchImpl: typeof fetch;
    readonly pollIntervalMs: number;
    readonly timeoutMs: number;
  },
): Promise<FalImageResult> {
  const statusUrl = submit.status_url?.trim();
  const responseUrl = submit.response_url?.trim();
  if (!statusUrl || !responseUrl) {
    throw new ImageGenError(
      "FAL submit missing status_url / response_url",
      "IMAGE_GEN_BACKEND",
    );
  }
  const headers = { Authorization: `Key ${options.apiKey}` };
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const stRes = await options.fetchImpl(statusUrl, { headers });
    const stText = await stRes.text().catch(() => "");
    if (!stRes.ok) {
      throw new ImageGenError(
        `FAL status HTTP ${stRes.status}: ${stText.slice(0, 200)}`,
        "IMAGE_GEN_BACKEND",
      );
    }
    let statusBody: FalStatusResponse;
    try {
      statusBody = JSON.parse(stText) as FalStatusResponse;
    } catch {
      throw new ImageGenError("FAL status was not JSON", "IMAGE_GEN_BACKEND");
    }
    const status = String(statusBody.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      const outUrl = statusBody.response_url?.trim() || responseUrl;
      const outRes = await options.fetchImpl(outUrl, { headers });
      const outText = await outRes.text().catch(() => "");
      if (!outRes.ok) {
        throw new ImageGenError(
          `FAL result HTTP ${outRes.status}: ${outText.slice(0, 200)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      try {
        return JSON.parse(outText) as FalImageResult;
      } catch {
        throw new ImageGenError("FAL result was not JSON", "IMAGE_GEN_BACKEND");
      }
    }
    if (status === "FAILED" || status === "CANCELLED" || status === "ERROR") {
      throw new ImageGenError(
        `FAL request ${status}: ${statusBody.error ?? "no detail"}`,
        "IMAGE_GEN_BACKEND",
      );
    }
    await sleep(options.pollIntervalMs);
  }
  throw new ImageGenError(
    `FAL timed out after ${options.timeoutMs}ms`,
    "IMAGE_GEN_BACKEND",
  );
}

export function createFalImageGenProvider(
  options: FalImageGenOptions,
): ImageGenService {
  const baseUrl = (options.baseUrl ?? "https://queue.fal.run").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const catalogEntry = resolveFalImageModel(options.model);
  const model = catalogEntry.id;
  const editModel =
    options.editModel?.trim() ||
    catalogEntry.editEndpoint ||
    (model.endsWith("/edit") ? model : `${model}/edit`);
  const caps: ImageGenCapabilities = options.capabilities ?? {
    modalities:
      catalogEntry.maxReferenceImages > 0
        ? (["text", "image"] as const)
        : (["text"] as const),
    maxReferenceImages: catalogEntry.maxReferenceImages,
  };
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 180_000;

  return {
    capabilities() {
      return caps;
    },
    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new ImageGenError("prompt is empty", "IMAGE_GEN_BAD_ARGS");
      }
      const refs = req.referenceImages ?? [];
      const isEdit = refs.length > 0;
      if (isEdit && caps.maxReferenceImages <= 0) {
        throw new ImageGenError(
          "FAL Provider configured without edit capability",
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      if (isEdit && refs.length > caps.maxReferenceImages) {
        throw new ImageGenError(
          `at most ${caps.maxReferenceImages} reference image(s) for FAL edit`,
          "IMAGE_GEN_BAD_ARGS",
        );
      }

      const endpoint = isEdit ? editModel : model;
      const payload: Record<string, unknown> = {
        prompt,
        num_images: 1,
        output_format: "png",
        enable_safety_checker: false,
      };
      if (isEdit) {
        payload.image_urls = refs.map(bytesToDataUrl);
      } else {
        payload.image_size = falImageSize(req.size);
        payload.num_inference_steps = 4;
      }

      const submitRes = await fetchImpl(joinUrl(baseUrl, endpoint), {
        method: "POST",
        headers: {
          Authorization: `Key ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const submitText = await submitRes.text().catch(() => "");
      if (!submitRes.ok) {
        throw new ImageGenError(
          `FAL submit HTTP ${submitRes.status}: ${submitText.slice(0, 240)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      let submitBody: FalSubmitResponse;
      try {
        submitBody = JSON.parse(submitText) as FalSubmitResponse;
      } catch {
        throw new ImageGenError("FAL submit was not JSON", "IMAGE_GEN_BACKEND");
      }

      const result = await waitFalResult(submitBody, {
        apiKey: options.apiKey,
        fetchImpl,
        pollIntervalMs,
        timeoutMs,
      });
      const rows =
        result.images ??
        (result.image?.url ? [{ url: result.image.url }] : []);
      if (rows.length === 0 || !rows[0]?.url) {
        throw new ImageGenError(
          "FAL returned no image URL",
          "IMAGE_GEN_BACKEND",
        );
      }
      const images = [];
      for (const row of rows.slice(0, 4)) {
        if (!row.url) continue;
        const downloaded = await downloadImage(row.url, fetchImpl);
        images.push({
          ...downloaded,
          url: row.url,
        });
      }
      if (images.length === 0) {
        throw new ImageGenError(
          "FAL returned no downloadable images",
          "IMAGE_GEN_BACKEND",
        );
      }
      return {
        images,
        provider: "fal",
        delivery: "fal",
        modality: isEdit ? "image" : "text",
        note: `fal endpoint=${endpoint}`,
      };
    },
  };
}
