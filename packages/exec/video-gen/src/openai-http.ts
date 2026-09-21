/**
 * OpenAI Videos API Provider (Sora): `POST /videos` → `GET /videos/{id}` →
 * `GET /videos/{id}/content`, the documented async render lifecycle.
 * @see https://developers.openai.com/api/docs/guides/video-generation
 */
import type {
  VideoGenContent,
  VideoGenJob,
  VideoGenRequest,
  VideoGenSeconds,
  VideoGenService,
  VideoGenSize,
  VideoGenStatus,
} from "./types.js";
import { VideoGenError } from "./types.js";

export interface OpenAiVideoGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly defaultSeconds?: VideoGenSeconds;
  readonly defaultSize?: VideoGenSize;
}

const STATUSES: readonly VideoGenStatus[] = [
  "queued",
  "in_progress",
  "completed",
  "failed",
];

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

interface RawVideoRow {
  readonly id?: string;
  readonly status?: string;
  readonly progress?: number;
  readonly model?: string;
  readonly seconds?: string | number;
  readonly size?: string;
  readonly error?: { readonly message?: string } | null;
}

function parseJob(json: unknown): VideoGenJob {
  const row = (json ?? {}) as RawVideoRow;
  const jobId = String(row.id ?? "").trim();
  if (!jobId) {
    throw new VideoGenError("OpenAI video response missing id", "VIDEO_GEN_BACKEND");
  }
  const status = String(row.status ?? "").trim() as VideoGenStatus;
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new VideoGenError(
      `OpenAI video status unknown: ${String(row.status ?? "")}`,
      "VIDEO_GEN_BACKEND",
    );
  }
  const progress =
    typeof row.progress === "number" && Number.isFinite(row.progress)
      ? Math.trunc(row.progress)
      : undefined;
  const seconds = row.seconds !== undefined ? Number(row.seconds) : undefined;
  const message =
    row.error && typeof row.error === "object"
      ? String(row.error.message ?? "").trim()
      : "";
  return {
    jobId,
    status,
    ...(progress !== undefined ? { progress } : {}),
    ...(row.model ? { model: String(row.model) } : {}),
    ...(seconds !== undefined && Number.isFinite(seconds) ? { seconds } : {}),
    ...(row.size ? { size: String(row.size) } : {}),
    ...(message ? { error: message } : {}),
    provider: "openai",
    delivery: "openai",
    note: `openai-videos status=${status}`,
  };
}

export function createOpenAiVideoGenProvider(
  options: OpenAiVideoGenOptions,
): VideoGenService {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "sora-2";
  const defaultSeconds = options.defaultSeconds ?? 4;
  const defaultSize = options.defaultSize ?? "1280x720";
  const auth = { Authorization: `Bearer ${options.apiKey}` };

  const requireId = (jobId: unknown): string => {
    const id = String(jobId ?? "").trim();
    if (!id) {
      throw new VideoGenError("job id is empty", "VIDEO_GEN_BAD_ARGS");
    }
    return id;
  };

  const getJob = async (id: string): Promise<VideoGenJob> => {
    const res = await fetchImpl(joinUrl(baseUrl, `videos/${encodeURIComponent(id)}`), {
      method: "GET",
      headers: auth,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VideoGenError(
        `OpenAI video status HTTP ${res.status}: ${body.slice(0, 200)}`,
        "VIDEO_GEN_BACKEND",
      );
    }
    return parseJob(await res.json());
  };

  return {
    async create(req: VideoGenRequest): Promise<VideoGenJob> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new VideoGenError("prompt is empty", "VIDEO_GEN_BAD_ARGS");
      }
      const form = new FormData();
      form.append("model", req.model ?? model);
      form.append("prompt", prompt);
      form.append("seconds", String(req.seconds ?? defaultSeconds));
      form.append("size", req.size ?? defaultSize);
      const res = await fetchImpl(joinUrl(baseUrl, "videos"), {
        method: "POST",
        headers: auth,
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new VideoGenError(
          `OpenAI videos HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      return parseJob(await res.json());
    },

    async get(jobId: string): Promise<VideoGenJob> {
      return getJob(requireId(jobId));
    },

    async content(jobId: string): Promise<VideoGenContent> {
      const id = requireId(jobId);
      // Confirm the render finished before pulling the (large) media body.
      const job = await getJob(id);
      if (job.status !== "completed") {
        throw new VideoGenError(
          `video job ${id} is ${job.status}, not completed`,
          "VIDEO_GEN_NOT_READY",
        );
      }
      const res = await fetchImpl(
        joinUrl(baseUrl, `videos/${encodeURIComponent(id)}/content`),
        { method: "GET", headers: auth },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new VideoGenError(
          `OpenAI video content HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      const ab = await res.arrayBuffer();
      return {
        bytes: new Uint8Array(ab),
        mimeType: "video/mp4",
        provider: "openai",
        note: `openai-videos bytes=${ab.byteLength}`,
      };
    },
  };
}
