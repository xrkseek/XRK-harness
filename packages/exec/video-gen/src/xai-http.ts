/**
 * xAI Grok Imagine video Provider — `/v1/videos/generations` (+ edits/extensions).
 * Hermes `plugins/video_gen/xai`: poll `/videos/{request_id}` until `done`.
 */
import { XAI_VIDEO_GEN_CAPABILITIES } from "./catalog.js";
import type {
  VideoGenCapabilities,
  VideoGenContent,
  VideoGenCreateKind,
  VideoGenJob,
  VideoGenRequest,
  VideoGenService,
  VideoGenSize,
  VideoGenSourceImage,
  VideoGenStatus,
} from "./types.js";
import { VideoGenError } from "./types.js";

export interface XaiVideoGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  /** Override i2v model when firstFrame is set (default grok-imagine-video-1.5). */
  readonly i2vModel?: string;
  readonly capabilities?: VideoGenCapabilities;
}

const DEFAULT_T2V = "grok-imagine-video";
const DEFAULT_I2V = "grok-imagine-video-1.5";

interface JobRecord {
  status: VideoGenStatus;
  progress?: number;
  model?: string;
  seconds?: number;
  size?: string;
  error?: string;
  kind: VideoGenCreateKind;
  modality: "text" | "image";
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

function resolutionForSize(size: VideoGenSize | undefined): string {
  if (size === "1024x1792" || size === "1792x1024") return "720p";
  return "720p";
}

function bytesToDataUrl(img: VideoGenSourceImage): string {
  return `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`;
}

function mapStatus(raw: string): VideoGenStatus {
  const s = raw.toLowerCase();
  if (s === "done" || s === "completed") return "completed";
  if (s === "failed" || s === "error" || s === "expired" || s === "cancelled") {
    return "failed";
  }
  if (s === "queued" || s === "pending") return "queued";
  return "in_progress";
}

export function createXaiVideoGenProvider(
  options: XaiVideoGenOptions,
): VideoGenService {
  const baseUrl = (options.baseUrl ?? "https://api.x.ai/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultModel = options.model?.trim() || DEFAULT_T2V;
  const caps = options.capabilities ?? XAI_VIDEO_GEN_CAPABILITIES;
  const jobs = new Map<string, JobRecord>();
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };

  function toJob(jobId: string, rec: JobRecord): VideoGenJob {
    return {
      jobId,
      status: rec.status,
      ...(rec.progress !== undefined ? { progress: rec.progress } : {}),
      ...(rec.model ? { model: rec.model } : {}),
      ...(rec.seconds !== undefined ? { seconds: rec.seconds } : {}),
      ...(rec.size ? { size: rec.size } : {}),
      ...(rec.error ? { error: rec.error } : {}),
      provider: "xai",
      delivery: "xai",
      note: `xai-video status=${rec.status}`,
      kind: rec.kind,
      modality: rec.modality,
    };
  }

  function resolveVideoUrl(sourceVideoId: string | undefined): string | undefined {
    const raw = String(sourceVideoId ?? "").trim();
    if (!raw) return undefined;
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:video/")) return raw;
    const prior = jobs.get(raw);
    return prior?.videoUrl;
  }

  async function refresh(jobId: string, rec: JobRecord): Promise<JobRecord> {
    if (rec.status === "completed" || rec.status === "failed") return rec;
    const res = await fetchImpl(joinUrl(baseUrl, `videos/${jobId}`), {
      headers,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new VideoGenError(
        `xAI video status HTTP ${res.status}: ${text.slice(0, 200)}`,
        "VIDEO_GEN_BACKEND",
      );
    }
    let body: {
      status?: string;
      model?: string;
      video?: {
        url?: string;
        duration?: number;
        file_output?: { public_url?: string };
      };
      error?: { message?: string } | string;
      message?: string;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new VideoGenError("xAI video status was not JSON", "VIDEO_GEN_BACKEND");
    }
    const status = mapStatus(String(body.status ?? ""));
    rec.status = status;
    if (body.model) rec.model = String(body.model);
    if (status === "completed") {
      const video = body.video ?? {};
      const publicUrl = video.file_output?.public_url?.trim();
      const tempUrl = video.url?.trim();
      const url = publicUrl || tempUrl || "";
      if (!url) {
        rec.status = "failed";
        rec.error = "xAI completed without video URL";
      } else {
        rec.videoUrl = url;
        rec.progress = 100;
        if (typeof video.duration === "number") rec.seconds = video.duration;
      }
    } else if (status === "failed") {
      const err =
        typeof body.error === "string"
          ? body.error
          : body.error && typeof body.error === "object"
            ? String(body.error.message ?? "")
            : String(body.message ?? "");
      rec.error = err || "xAI video failed";
    } else {
      rec.progress = status === "queued" ? 5 : 40;
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
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new VideoGenError("prompt is empty", "VIDEO_GEN_BAD_ARGS");
      }

      let endpoint = "videos/generations";
      let modality: "text" | "image" = "text";
      let resolvedModel = req.model?.trim() || defaultModel;
      const payload: Record<string, unknown> = {
        model: resolvedModel,
        prompt,
      };

      if (kind === "edit" || kind === "extend") {
        if (!caps.supportsEdit && kind === "edit") {
          throw new VideoGenError(
            "xAI Provider configured without edit",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        if (!caps.supportsExtend && kind === "extend") {
          throw new VideoGenError(
            "xAI Provider configured without extend",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        const videoUrl = resolveVideoUrl(req.sourceVideoId);
        if (!videoUrl) {
          throw new VideoGenError(
            "sourceVideoId must be a prior xAI job id or public HTTPS MP4 URL",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        endpoint = kind === "edit" ? "videos/edits" : "videos/extensions";
        payload.video = { url: videoUrl };
        if (kind === "extend") {
          payload.duration = req.seconds ?? 6;
        }
        modality = "text";
      } else {
        const first = req.firstFrame;
        const refs = req.referenceImages ?? [];
        if (first && refs.length > 0) {
          throw new VideoGenError(
            "xAI cannot combine firstFrame and referenceImages",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        if (refs.length > caps.maxReferenceImages) {
          throw new VideoGenError(
            `at most ${caps.maxReferenceImages} reference image(s) for xAI video`,
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        if (first) {
          modality = "image";
          resolvedModel =
            req.model?.trim() || options.i2vModel?.trim() || DEFAULT_I2V;
          payload.model = resolvedModel;
          payload.image = { url: bytesToDataUrl(first) };
        } else if (refs.length > 0) {
          modality = "image";
          resolvedModel = req.model?.trim() || DEFAULT_T2V;
          payload.model = resolvedModel;
          payload.reference_images = refs.map((img) => ({
            url: bytesToDataUrl(img),
          }));
        }
        payload.duration = req.seconds ?? 8;
        payload.aspect_ratio = aspectForSize(req.size);
        payload.resolution = resolutionForSize(req.size);
      }

      const res = await fetchImpl(joinUrl(baseUrl, endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new VideoGenError(
          `xAI video submit HTTP ${res.status}: ${text.slice(0, 240)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      let body: { request_id?: string; id?: string };
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        throw new VideoGenError("xAI video submit was not JSON", "VIDEO_GEN_BACKEND");
      }
      const jobId = String(body.request_id ?? body.id ?? "").trim();
      if (!jobId) {
        throw new VideoGenError(
          "xAI video response missing request_id",
          "VIDEO_GEN_BACKEND",
        );
      }
      const rec: JobRecord = {
        status: "queued",
        progress: 0,
        model: resolvedModel,
        ...(req.seconds !== undefined ? { seconds: req.seconds } : {}),
        ...(req.size ? { size: req.size } : {}),
        kind,
        modality,
      };
      jobs.set(jobId, rec);
      return toJob(jobId, rec);
    },
    async get(jobId: string): Promise<VideoGenJob> {
      const rec = jobs.get(jobId);
      if (!rec) {
        // Allow poll of externally known request ids (e.g. after restart).
        const fresh: JobRecord = {
          status: "queued",
          kind: "generate",
          modality: "text",
        };
        jobs.set(jobId, fresh);
        return toJob(jobId, await refresh(jobId, fresh));
      }
      return toJob(jobId, await refresh(jobId, rec));
    },
    async content(jobId: string): Promise<VideoGenContent> {
      let rec = jobs.get(jobId);
      if (!rec) {
        rec = { status: "queued", kind: "generate", modality: "text" };
        jobs.set(jobId, rec);
      }
      rec = await refresh(jobId, rec);
      if (rec.status !== "completed" || !rec.videoUrl) {
        throw new VideoGenError(
          `xAI video job not ready (status=${rec.status})`,
          "VIDEO_GEN_NOT_READY",
        );
      }
      const res = await fetchImpl(rec.videoUrl);
      if (!res.ok) {
        throw new VideoGenError(
          `xAI video download HTTP ${res.status}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      const ab = await res.arrayBuffer();
      return {
        bytes: new Uint8Array(ab),
        mimeType: "video/mp4",
        provider: "xai",
        note: `xai-video job=${jobId}`,
      };
    },
  };
}

export { XAI_VIDEO_GEN_CAPABILITIES };
