/**
 * OpenAI Videos API Provider (Sora): `POST /videos` → `GET /videos/{id}` →
 * `GET /videos/{id}/content`, plus i2v (`input_reference`), edit
 * (`POST /videos/edits`), and extend (`POST /videos/extensions`).
 * @see https://developers.openai.com/api/docs/guides/video-generation
 */
import { OPENAI_VIDEO_GEN_CAPABILITIES } from "./catalog.js";
import type {
  VideoGenCapabilities,
  VideoGenContent,
  VideoGenCreateKind,
  VideoGenDelivery,
  VideoGenJob,
  VideoGenRequest,
  VideoGenSeconds,
  VideoGenService,
  VideoGenSize,
  VideoGenSourceImage,
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
  /** Override caps (tests); default = OpenAI family catalog. */
  readonly capabilities?: VideoGenCapabilities;
  /** Result label (DeepInfra / OpenRouter-compatible reuse). */
  readonly delivery?: VideoGenDelivery;
  readonly providerName?: string;
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

function extForMime(mime: VideoGenSourceImage["mimeType"]): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
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

function parseJob(
  json: unknown,
  extras?: {
    readonly kind?: VideoGenCreateKind;
    readonly modality?: "text" | "image";
    readonly delivery?: VideoGenDelivery;
    readonly providerName?: string;
  },
): VideoGenJob {
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
  const delivery = extras?.delivery ?? "openai";
  const providerName = extras?.providerName ?? "openai";
  return {
    jobId,
    status,
    ...(progress !== undefined ? { progress } : {}),
    ...(row.model ? { model: String(row.model) } : {}),
    ...(seconds !== undefined && Number.isFinite(seconds) ? { seconds } : {}),
    ...(row.size ? { size: String(row.size) } : {}),
    ...(message ? { error: message } : {}),
    provider: providerName,
    delivery,
    note: `${providerName}-videos status=${status}`,
    ...(extras?.kind ? { kind: extras.kind } : {}),
    ...(extras?.modality ? { modality: extras.modality } : {}),
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
  const caps = options.capabilities ?? OPENAI_VIDEO_GEN_CAPABILITIES;
  const delivery = options.delivery ?? "openai";
  const providerName = options.providerName ?? "openai";
  const auth = { Authorization: `Bearer ${options.apiKey}` };
  const jobExtras = { delivery, providerName };

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
        `${providerName} video status HTTP ${res.status}: ${body.slice(0, 200)}`,
        "VIDEO_GEN_BACKEND",
      );
    }
    return parseJob(await res.json(), jobExtras);
  };

  const postJson = async (
    path: string,
    body: Record<string, unknown>,
    kind: VideoGenCreateKind,
  ): Promise<VideoGenJob> => {
    const res = await fetchImpl(joinUrl(baseUrl, path), {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new VideoGenError(
        `${providerName} ${path} HTTP ${res.status}: ${text.slice(0, 200)}`,
        "VIDEO_GEN_BACKEND",
      );
    }
    return parseJob(await res.json(), { kind, modality: "text", ...jobExtras });
  };

  return {
    capabilities(): VideoGenCapabilities {
      return caps;
    },

    async create(req: VideoGenRequest): Promise<VideoGenJob> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new VideoGenError("prompt is empty", "VIDEO_GEN_BAD_ARGS");
      }
      const kind: VideoGenCreateKind = req.kind ?? "generate";

      if (kind === "edit") {
        if (!caps.supportsEdit) {
          throw new VideoGenError(
            `${providerName} Provider configured without edit capability`,
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        const sourceId = String(req.sourceVideoId ?? "").trim();
        if (!sourceId) {
          throw new VideoGenError(
            "sourceVideoId is required for edit",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        return postJson(
          "videos/edits",
          { video: { id: sourceId }, prompt },
          "edit",
        );
      }

      if (kind === "extend") {
        if (!caps.supportsExtend) {
          throw new VideoGenError(
            `${providerName} Provider configured without extend capability`,
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        const sourceId = String(req.sourceVideoId ?? "").trim();
        if (!sourceId) {
          throw new VideoGenError(
            "sourceVideoId is required for extend",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        const body: Record<string, unknown> = {
          video: { id: sourceId },
          prompt,
          seconds: String(req.seconds ?? defaultSeconds),
        };
        return postJson("videos/extensions", body, "extend");
      }

      // kind === generate (t2v / i2v)
      const first = req.firstFrame;
      const extras = req.referenceImages ?? [];
      const stills = first ? [first, ...extras] : [...extras];
      if (stills.length > 0 && caps.maxReferenceImages <= 0) {
        throw new VideoGenError(
          `${providerName} Provider configured without i2v capability`,
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      if (stills.length > caps.maxReferenceImages) {
        throw new VideoGenError(
          `at most ${caps.maxReferenceImages} reference image(s) for ${providerName} i2v`,
          "VIDEO_GEN_BAD_ARGS",
        );
      }

      const form = new FormData();
      form.append("model", req.model ?? model);
      form.append("prompt", prompt);
      form.append("seconds", String(req.seconds ?? defaultSeconds));
      form.append("size", req.size ?? defaultSize);
      if (stills[0]) {
        const src = stills[0];
        const blob = new Blob([src.bytes], { type: src.mimeType });
        form.append(
          "input_reference",
          blob,
          `first_frame.${extForMime(src.mimeType)}`,
        );
      }
      const res = await fetchImpl(joinUrl(baseUrl, "videos"), {
        method: "POST",
        headers: auth,
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new VideoGenError(
          `${providerName} videos HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      return parseJob(await res.json(), {
        kind: "generate",
        modality: stills.length > 0 ? "image" : "text",
        ...jobExtras,
      });
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
          `${providerName} video content HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VIDEO_GEN_BACKEND",
        );
      }
      const ab = await res.arrayBuffer();
      return {
        bytes: new Uint8Array(ab),
        mimeType: "video/mp4",
        provider: providerName,
        note: `${providerName}-videos bytes=${ab.byteLength}`,
      };
    },
  };
}
