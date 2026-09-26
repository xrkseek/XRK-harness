/**
 * Krea 2 async image Provider (Hermes plugins/image_gen/krea).
 * Submit → poll `/jobs/{id}` → download result URL.
 */
import type {
  ImageGenCapabilities,
  ImageGenRequest,
  ImageGenResult,
  ImageGenService,
  ImageGenSize,
  ImageGenSourceImage,
} from "./types.js";
import { ImageGenError } from "./types.js";

export interface KreaImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly capabilities?: ImageGenCapabilities;
}

const MODEL_PATHS: Readonly<Record<string, string>> = {
  "krea-2-medium": "medium",
  "krea-2-large": "large",
  "krea-2-medium-turbo": "medium-turbo",
};

const DEFAULT_MODEL = "krea-2-medium";
const DEFAULT_CAPS: ImageGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 10,
};

function sizeToAspect(size: ImageGenSize | undefined): string {
  switch (size) {
    case "1792x1024":
      return "16:9";
    case "1024x1792":
      return "9:16";
    default:
      return "1:1";
  }
}

function bytesToDataUrl(img: ImageGenSourceImage): string {
  return `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function createKreaImageGenProvider(
  options: KreaImageGenOptions,
): ImageGenService {
  const baseUrl = (options.baseUrl ?? "https://api.krea.ai").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model?.trim() || DEFAULT_MODEL;
  const caps = options.capabilities ?? DEFAULT_CAPS;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const auth = {
    Authorization: `Bearer ${options.apiKey}`,
    "User-Agent": "XRK-Harness/1.0 (krea-image-gen)",
    "Content-Type": "application/json",
  };

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
      if (refs.length > caps.maxReferenceImages) {
        throw new ImageGenError(
          `at most ${caps.maxReferenceImages} style reference(s) for Krea`,
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      const resolved = req.model?.trim() || model;
      const pathSeg = MODEL_PATHS[resolved] ?? MODEL_PATHS[DEFAULT_MODEL]!;
      const body: Record<string, unknown> = {
        prompt,
        aspect_ratio: sizeToAspect(req.size),
        resolution: "1K",
        creativity: "medium",
      };
      if (refs.length > 0) {
        body.style_references = refs.map((img) => ({
          url: bytesToDataUrl(img),
          strength: 0.6,
        }));
      }
      const submitRes = await fetchImpl(
        `${baseUrl}/generate/image/krea/${pathSeg}`,
        {
          method: "POST",
          headers: auth,
          body: JSON.stringify(body),
        },
      );
      const submitText = await submitRes.text().catch(() => "");
      if (!submitRes.ok) {
        throw new ImageGenError(
          `Krea submit HTTP ${submitRes.status}: ${submitText.slice(0, 200)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      let submit: { job_id?: string; id?: string };
      try {
        submit = JSON.parse(submitText) as typeof submit;
      } catch {
        throw new ImageGenError("Krea submit was not JSON", "IMAGE_GEN_BACKEND");
      }
      const jobId = String(submit.job_id ?? submit.id ?? "").trim();
      if (!jobId) {
        throw new ImageGenError("Krea submit missing job_id", "IMAGE_GEN_BACKEND");
      }

      const deadline = Date.now() + timeoutMs;
      let interval = pollIntervalMs;
      while (Date.now() < deadline) {
        await sleep(interval);
        interval = Math.min(interval * 1.3, 5000);
        const stRes = await fetchImpl(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
          headers: auth,
        });
        const stText = await stRes.text().catch(() => "");
        if (!stRes.ok) {
          throw new ImageGenError(
            `Krea poll HTTP ${stRes.status}: ${stText.slice(0, 200)}`,
            "IMAGE_GEN_BACKEND",
          );
        }
        let statusBody: {
          status?: string;
          state?: string;
          result?: { url?: string; image_url?: string };
          error?: string;
        };
        try {
          statusBody = JSON.parse(stText) as typeof statusBody;
        } catch {
          throw new ImageGenError("Krea poll was not JSON", "IMAGE_GEN_BACKEND");
        }
        const status = String(
          statusBody.status ?? statusBody.state ?? "",
        ).toLowerCase();
        if (status === "completed" || status === "succeeded" || status === "success") {
          const url =
            statusBody.result?.url?.trim() ||
            statusBody.result?.image_url?.trim() ||
            "";
          if (!url) {
            throw new ImageGenError(
              "Krea completed without image URL",
              "IMAGE_GEN_BACKEND",
            );
          }
          const imgRes = await fetchImpl(url);
          if (!imgRes.ok) {
            throw new ImageGenError(
              `Krea image download HTTP ${imgRes.status}`,
              "IMAGE_GEN_BACKEND",
            );
          }
          const ab = await imgRes.arrayBuffer();
          return {
            images: [
              {
                bytes: new Uint8Array(ab),
                mimeType: "image/png",
                url,
              },
            ],
            provider: "krea",
            delivery: "krea",
            modality: refs.length > 0 ? "image" : "text",
            note: `krea-images model=${resolved} refs=${refs.length}`,
          };
        }
        if (
          status === "failed" ||
          status === "cancelled" ||
          status === "canceled" ||
          status === "error"
        ) {
          throw new ImageGenError(
            `Krea job ${status}: ${statusBody.error ?? "no detail"}`,
            "IMAGE_GEN_BACKEND",
          );
        }
      }
      throw new ImageGenError(
        `Krea timed out after ${timeoutMs}ms`,
        "IMAGE_GEN_BACKEND",
      );
    },
  };
}
