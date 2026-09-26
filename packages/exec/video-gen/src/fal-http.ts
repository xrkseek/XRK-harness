/**
 * FAL.ai queue video Provider — t2v / i2v (Hermes `plugins/video_gen/fal` full catalog).
 * Async job lifecycle: submit → poll status → download MP4.
 */
import {
  FAL_VIDEO_GEN_CAPABILITIES,
} from "./catalog.js";
import type {
  VideoGenCapabilities,
  VideoGenContent,
  VideoGenJob,
  VideoGenRequest,
  VideoGenSeconds,
  VideoGenService,
  VideoGenSize,
  VideoGenSourceImage,
  VideoGenStatus,
} from "./types.js";
import { VideoGenError } from "./types.js";

export interface FalVideoGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Default family id (Hermes DEFAULT_MODEL = pixverse-v6). */
  readonly model?: string;
  readonly pollIntervalMs?: number;
  readonly capabilities?: VideoGenCapabilities;
}

interface FalFamilyMeta {
  readonly textEndpoint: string;
  readonly imageEndpoint: string;
  readonly imageParamKey?: string;
  readonly durationInt?: boolean;
  readonly durationSuffix?: string;
  readonly imageDropAspect?: boolean;
}

/** Hermes FAL_FAMILIES endpoint routing (main path). */
const FAMILY_META: Readonly<Record<string, FalFamilyMeta>> = {
  "ltx-2.3": {
    textEndpoint: "fal-ai/ltx-2.3-22b/text-to-video",
    imageEndpoint: "fal-ai/ltx-2.3-22b/image-to-video",
  },
  "ltx-2.5": {
    textEndpoint: "lightricks/ltx-2.5/text-to-video/fast",
    imageEndpoint: "lightricks/ltx-2.5/image-to-video/fast",
    durationInt: true,
  },
  "pixverse-v6": {
    textEndpoint: "fal-ai/pixverse/v6/text-to-video",
    imageEndpoint: "fal-ai/pixverse/v6/image-to-video",
  },
  "seedance-2.0-mini": {
    textEndpoint: "bytedance/seedance-2.0/mini/text-to-video",
    imageEndpoint: "bytedance/seedance-2.0/mini/image-to-video",
  },
  "veo3.1": {
    textEndpoint: "fal-ai/veo3.1",
    imageEndpoint: "fal-ai/veo3.1/image-to-video",
    durationSuffix: "s",
  },
  "seedance-2.0": {
    textEndpoint: "bytedance/seedance-2.0/text-to-video",
    imageEndpoint: "bytedance/seedance-2.0/image-to-video",
  },
  "seedance-2.5": {
    textEndpoint: "bytedance/seedance-2.5/text-to-video",
    imageEndpoint: "bytedance/seedance-2.5/image-to-video",
    imageDropAspect: true,
  },
  "minimax-h3": {
    textEndpoint: "minimax/h3/text-to-video",
    imageEndpoint: "minimax/h3/image-to-video",
    durationInt: true,
    imageDropAspect: true,
  },
  "minimax-h3-max": {
    textEndpoint: "minimax/h3-max/text-to-video",
    imageEndpoint: "minimax/h3-max/image-to-video",
    durationInt: true,
    imageDropAspect: true,
  },
  "minimax-h3-max-turbo": {
    textEndpoint: "minimax/h3-max-turbo/text-to-video",
    imageEndpoint: "minimax/h3-max-turbo/image-to-video",
    durationInt: true,
    imageDropAspect: true,
  },
  "flux-3": {
    textEndpoint: "blackforestlabs/flux-3/text-to-video",
    imageEndpoint: "blackforestlabs/flux-3/image-to-video",
    durationInt: true,
  },
  "grok-imagine-1.5": {
    textEndpoint: "xai/grok-imagine-video/v1.5/text-to-video",
    imageEndpoint: "xai/grok-imagine-video/v1.5/image-to-video",
    durationInt: true,
    imageDropAspect: true,
  },
  "gemini-omni-flash": {
    textEndpoint: "google/gemini-omni-flash/v1.1/text-to-video",
    imageEndpoint: "google/gemini-omni-flash/v1.1/image-to-video",
    durationInt: true,
  },
  "kling-v3": {
    textEndpoint: "fal-ai/kling-video/v3/standard/text-to-video",
    imageEndpoint: "fal-ai/kling-video/v3/standard/image-to-video",
    imageParamKey: "start_image_url",
    imageDropAspect: true,
  },
  "kling-v3-pro": {
    textEndpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    imageEndpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    imageParamKey: "start_image_url",
    imageDropAspect: true,
  },
  "kling-v3-4k": {
    textEndpoint: "fal-ai/kling-video/v3/4k/text-to-video",
    imageEndpoint: "fal-ai/kling-video/v3/4k/image-to-video",
    imageParamKey: "start_image_url",
  },
  "kling-o3": {
    textEndpoint: "fal-ai/kling-video/o3/standard/text-to-video",
    imageEndpoint: "fal-ai/kling-video/o3/standard/image-to-video",
    imageDropAspect: true,
  },
  "wan-3.0": {
    textEndpoint: "alibaba/wan-3.0/text-to-video",
    imageEndpoint: "alibaba/wan-3.0/image-to-video",
    imageParamKey: "start_image_url",
    durationInt: true,
  },
  "wan-3.0-prime": {
    textEndpoint: "alibaba/wan-3.0-prime/text-to-video",
    imageEndpoint: "alibaba/wan-3.0-prime/image-to-video",
    imageParamKey: "start_image_url",
    durationInt: true,
  },
  "happy-horse": {
    textEndpoint: "alibaba/happy-horse/v1.1/text-to-video",
    imageEndpoint: "alibaba/happy-horse/v1.1/image-to-video",
    durationInt: true,
    imageDropAspect: true,
  },
};

const DEFAULT_FAMILY = "pixverse-v6";

interface JobRecord {
  status: VideoGenStatus;
  progress?: number;
  model?: string;
  seconds?: number;
  size?: string;
  error?: string;
  kind: "generate";
  modality: "text" | "image";
  statusUrl: string;
  responseUrl: string;
  videoUrl?: string;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function aspectForSize(size: VideoGenSize | undefined): string {
  switch (size) {
    case "720x1280":
    case "1024x1792":
      return "9:16";
    case "1280x720":
    case "1792x1024":
      return "16:9";
    default:
      return "16:9";
  }
}

function bytesToDataUrl(img: VideoGenSourceImage): string {
  return `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`;
}

function resolveFamily(model: string | undefined): { id: string; meta: FalFamilyMeta } {
  const raw = (model ?? "").trim() || DEFAULT_FAMILY;
  const direct = FAMILY_META[raw];
  if (direct) return { id: raw, meta: direct };
  for (const [id, meta] of Object.entries(FAMILY_META)) {
    if (
      raw === meta.textEndpoint ||
      raw === meta.imageEndpoint ||
      raw.includes(id)
    ) {
      return { id, meta };
    }
  }
  return { id: DEFAULT_FAMILY, meta: FAMILY_META[DEFAULT_FAMILY]! };
}

function mapDuration(
  meta: FalFamilyMeta,
  seconds: VideoGenSeconds | undefined,
): string | number | undefined {
  if (seconds === undefined) return undefined;
  if (meta.durationInt) return seconds;
  return `${seconds}${meta.durationSuffix ?? ""}`;
}

export function createFalVideoGenProvider(
  options: FalVideoGenOptions,
): VideoGenService {
  const baseUrl = (options.baseUrl ?? "https://queue.fal.run").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultModel = options.model?.trim() || DEFAULT_FAMILY;
  const caps = options.capabilities ?? FAL_VIDEO_GEN_CAPABILITIES;
  const jobs = new Map<string, JobRecord>();
  const auth = { Authorization: `Key ${options.apiKey}` };

  function toJob(jobId: string, rec: JobRecord): VideoGenJob {
    return {
      jobId,
      status: rec.status,
      ...(rec.progress !== undefined ? { progress: rec.progress } : {}),
      ...(rec.model ? { model: rec.model } : {}),
      ...(rec.seconds !== undefined ? { seconds: rec.seconds } : {}),
      ...(rec.size ? { size: rec.size } : {}),
      ...(rec.error ? { error: rec.error } : {}),
      provider: "fal",
      delivery: "fal",
      note: `fal-video status=${rec.status}`,
      kind: rec.kind,
      modality: rec.modality,
    };
  }

  async function refresh(jobId: string, rec: JobRecord): Promise<JobRecord> {
    if (rec.status === "completed" || rec.status === "failed") return rec;
    const stRes = await fetchImpl(rec.statusUrl, { headers: auth });
    const stText = await stRes.text().catch(() => "");
    if (!stRes.ok) {
      throw new VideoGenError(
        `FAL video status HTTP ${stRes.status}: ${stText.slice(0, 200)}`,
        "VIDEO_GEN_BACKEND",
      );
    }
    let body: { status?: string; response_url?: string; error?: string };
    try {
      body = JSON.parse(stText) as typeof body;
    } catch {
      throw new VideoGenError("FAL video status was not JSON", "VIDEO_GEN_BACKEND");
    }
    const status = String(body.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      const outUrl = body.response_url?.trim() || rec.responseUrl;
      const outRes = await fetchImpl(outUrl, { headers: auth });
      const outText = await outRes.text().catch(() => "");
      if (!outRes.ok) {
        throw new VideoGenError(
          `FAL video result HTTP ${outRes.status}: ${outText.slice(0, 200)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      let result: { video?: { url?: string } | string };
      try {
        result = JSON.parse(outText) as typeof result;
      } catch {
        throw new VideoGenError("FAL video result was not JSON", "VIDEO_GEN_BACKEND");
      }
      const video = result.video;
      const url =
        typeof video === "string"
          ? video
          : video && typeof video === "object"
            ? String(video.url ?? "").trim()
            : "";
      if (!url) {
        rec.status = "failed";
        rec.error = "FAL returned no video URL";
      } else {
        rec.status = "completed";
        rec.progress = 100;
        rec.videoUrl = url;
      }
    } else if (
      status === "FAILED" ||
      status === "CANCELLED" ||
      status === "ERROR"
    ) {
      rec.status = "failed";
      rec.error = body.error ?? status;
    } else if (status === "IN_PROGRESS" || status === "IN_QUEUE") {
      rec.status = status === "IN_QUEUE" ? "queued" : "in_progress";
      rec.progress = status === "IN_QUEUE" ? 5 : 40;
    } else {
      rec.status = "in_progress";
    }
    jobs.set(jobId, rec);
    return rec;
  }

  return {
    capabilities() {
      return caps;
    },
    async create(req: VideoGenRequest): Promise<VideoGenJob> {
      const kind = req.kind ?? "generate";
      if (kind !== "generate") {
        throw new VideoGenError(
          "FAL video Provider does not support edit/extend",
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new VideoGenError("prompt is empty", "VIDEO_GEN_BAD_ARGS");
      }
      const first = req.firstFrame;
      const extras = req.referenceImages ?? [];
      const still = first ?? extras[0];
      const modality: "text" | "image" = still ? "image" : "text";
      if (modality === "image" && caps.maxReferenceImages <= 0) {
        throw new VideoGenError(
          "FAL Provider configured without i2v capability",
          "VIDEO_GEN_BAD_ARGS",
        );
      }

      const { id: familyId, meta } = resolveFamily(req.model ?? defaultModel);
      const endpoint =
        modality === "image" ? meta.imageEndpoint : meta.textEndpoint;
      const payload: Record<string, unknown> = { prompt };
      const aspect = aspectForSize(req.size);
      if (!(modality === "image" && meta.imageDropAspect)) {
        payload.aspect_ratio = aspect;
      }
      const duration = mapDuration(meta, req.seconds);
      if (duration !== undefined) payload.duration = duration;
      if (still) {
        const key = meta.imageParamKey ?? "image_url";
        payload[key] = bytesToDataUrl(still);
      }

      const submitRes = await fetchImpl(joinUrl(baseUrl, endpoint), {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const submitText = await submitRes.text().catch(() => "");
      if (!submitRes.ok) {
        throw new VideoGenError(
          `FAL video submit HTTP ${submitRes.status}: ${submitText.slice(0, 240)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      let submit: {
        request_id?: string;
        status_url?: string;
        response_url?: string;
      };
      try {
        submit = JSON.parse(submitText) as typeof submit;
      } catch {
        throw new VideoGenError("FAL video submit was not JSON", "VIDEO_GEN_BACKEND");
      }
      const jobId = String(submit.request_id ?? "").trim();
      const statusUrl = String(submit.status_url ?? "").trim();
      const responseUrl = String(submit.response_url ?? "").trim();
      if (!jobId || !statusUrl || !responseUrl) {
        throw new VideoGenError(
          "FAL video submit missing request_id / status_url / response_url",
          "VIDEO_GEN_BACKEND",
        );
      }
      const rec: JobRecord = {
        status: "queued",
        progress: 0,
        model: familyId,
        ...(req.seconds !== undefined ? { seconds: req.seconds } : {}),
        ...(req.size ? { size: req.size } : {}),
        kind: "generate",
        modality,
        statusUrl,
        responseUrl,
      };
      jobs.set(jobId, rec);
      return toJob(jobId, rec);
    },
    async get(jobId: string): Promise<VideoGenJob> {
      const rec = jobs.get(jobId);
      if (!rec) {
        throw new VideoGenError(
          `unknown FAL video job: ${jobId}`,
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      return toJob(jobId, await refresh(jobId, rec));
    },
    async content(jobId: string): Promise<VideoGenContent> {
      const rec0 = jobs.get(jobId);
      if (!rec0) {
        throw new VideoGenError(
          `unknown FAL video job: ${jobId}`,
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      const rec = await refresh(jobId, rec0);
      if (rec.status !== "completed" || !rec.videoUrl) {
        throw new VideoGenError(
          `FAL video job not ready (status=${rec.status})`,
          "VIDEO_GEN_NOT_READY",
        );
      }
      const res = await fetchImpl(rec.videoUrl);
      if (!res.ok) {
        throw new VideoGenError(
          `FAL video download HTTP ${res.status}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      const ab = await res.arrayBuffer();
      return {
        bytes: new Uint8Array(ab),
        mimeType: "video/mp4",
        provider: "fal",
        note: `fal-video job=${jobId}`,
      };
    },
  };
}

/** Exported for tests / catalog sanity. */
export const FAL_VIDEO_FAMILY_IDS = Object.keys(FAMILY_META);
