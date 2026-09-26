import type { AttachmentStore } from "@xrkseek/attachment";
import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import { formatVideoGenCatalog, VIDEO_GEN_SECONDS, VIDEO_GEN_SIZES } from "./catalog.js";
import { VIDEO_GEN_PROMPT_TEXT } from "./format.js";
import { resolveVideoGenReferenceImages } from "./references.js";
import {
  buildVideoGenToolDescription,
  buildVideoGenToolParameters,
  videoGenActionsForCapabilities,
} from "./schema.js";
import {
  VideoGenError,
  isTerminalStatus,
  isVideoGenError,
  resolveVideoGenCapabilities,
  videoGenSupportsI2v,
  type VideoGenCreateKind,
  type VideoGenJob,
  type VideoGenSeconds,
  type VideoGenService,
  type VideoGenSize,
} from "./types.js";

export { VIDEO_GEN_PROMPT_TEXT };

export function videoGenUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
  product?: { readonly mode?: string },
): string {
  const envRaw = String(env.XRK_VIDEO_GEN ?? "").trim();
  const productMode = String(product?.mode ?? "").trim().toLowerCase();
  const known = new Set(["openai", "fal", "xai", "openrouter", "deepinfra"]);
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
      "Error: video generation is not enabled. Use Settings → Plugins → Video gen " +
      "(openai / fal / xai / openrouter / deepinfra), or set XRK_VIDEO_GEN=memory (CI/demo) " +
      "/=1|openai|fal|xai|openrouter|deepinfra with the matching key. See docs/video-gen.md."
    );
  }
  if (flag === "1" || flag === "openai") {
    return (
      "Error: video gen (openai) is enabled but no API key. Set Credentials XRK_VIDEO_GEN_OPENAI_KEY " +
      "(or OPENAI_API_KEY); optional base URL / model via Settings or env."
    );
  }
  if (flag === "fal") {
    return (
      "Error: video gen (fal) is enabled but no API key. Set Credentials XRK_VIDEO_GEN_FAL_KEY " +
      "(or FAL_KEY); optional family / model via Settings or env."
    );
  }
  if (flag === "xai") {
    return (
      "Error: video gen (xai) is enabled but no API key. Set Credentials XRK_VIDEO_GEN_XAI_KEY " +
      "(or XAI_API_KEY); optional base URL / model via Settings or env."
    );
  }
  if (flag === "openrouter") {
    return (
      "Error: video gen (openrouter) is enabled but no API key. Set Credentials XRK_VIDEO_GEN_OPENROUTER_KEY " +
      "(or OPENROUTER_API_KEY)."
    );
  }
  if (flag === "deepinfra") {
    return (
      "Error: video gen (deepinfra) is enabled but no API key. Set Credentials XRK_VIDEO_GEN_DEEPINFRA_KEY " +
      "(or DEEPINFRA_API_KEY)."
    );
  }
  return "Error: no VideoGenService Provider is configured. Inject a service or set XRK_VIDEO_GEN.";
}

export interface CreateVideoGenToolsOptions {
  readonly service?: VideoGenService;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: { readonly mode?: string };
  /** When set, persist the finished MP4 and return an attachment id. */
  readonly attachments?: AttachmentStore;
  /** Injected sleep for `action=wait`; tests avoid real polling delays. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
}

interface VideoGenToolArgs {
  action?: string;
  prompt?: string;
  job_id?: string;
  model?: string;
  seconds?: number;
  size?: string;
  timeout_ms?: number;
  poll_interval_ms?: number;
  first_frame?: string;
  image_url?: string;
  reference_image_urls?: string[];
  reference_attachment_ids?: string[];
}

function fail(err: unknown): ToolResultContent {
  const message = isVideoGenError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseSize(raw: unknown): VideoGenSize | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim() as VideoGenSize;
  if (!(VIDEO_GEN_SIZES as readonly string[]).includes(s)) {
    throw new VideoGenError(
      `size must be one of ${VIDEO_GEN_SIZES.join(", ")}`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  return s;
}

function parseSeconds(raw: unknown): VideoGenSeconds | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!(VIDEO_GEN_SECONDS as readonly number[]).includes(n)) {
    throw new VideoGenError(
      `seconds must be one of ${VIDEO_GEN_SECONDS.join(", ")}`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  return n as VideoGenSeconds;
}

function formatJob(job: VideoGenJob): string {
  return [
    `jobId=${job.jobId}`,
    `status=${job.status}`,
    job.progress !== undefined ? `progress=${job.progress}` : "",
    job.error ? `error=${job.error}` : "",
    job.model ? `model=${job.model}` : "",
    job.seconds !== undefined ? `seconds=${job.seconds}` : "",
    job.size ? `size=${job.size}` : "",
    job.kind ? `kind=${job.kind}` : "",
    job.modality ? `modality=${job.modality}` : "",
    job.note ? `note=${job.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Model-facing `video_generate` tool.
 *
 * Static fields are an initial bake; `dynamicSchema` rebuilds from live
 * Provider `capabilities()` on each materialize (Hermes get_definitions).
 * Video renders are asynchronous: `start` → `status` / `wait` → `content`.
 */
export function createVideoGenTools(
  options: CreateVideoGenToolsOptions = {},
): ToolDefinition[] {
  const missing = videoGenUnavailableMessage(
    options.env ?? process.env,
    options.product,
  );
  const service = options.service;
  const attachments = options.attachments;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const caps = resolveVideoGenCapabilities(service);

  const parseAction = (raw: unknown, allowed: readonly string[]): string => {
    if (raw === undefined || raw === null || raw === "") return "start";
    const a = String(raw).trim().toLowerCase();
    if (!allowed.includes(a)) {
      throw new VideoGenError(
        `action must be one of ${allowed.join(", ")}`,
        "VIDEO_GEN_BAD_ARGS",
      );
    }
    return a;
  };

  const tool: ToolDefinition<VideoGenToolArgs> = {
    name: "video_generate",
    description: buildVideoGenToolDescription(caps),
    parameters: buildVideoGenToolParameters(caps) as unknown as Record<
      string,
      unknown
    >,
    dynamicSchema: () => {
      const live = resolveVideoGenCapabilities(service);
      return {
        description: buildVideoGenToolDescription(live),
        parameters: buildVideoGenToolParameters(live) as unknown as Record<
          string,
          unknown
        >,
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Video generate",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args) {
      if (!service) return { content: missing, isError: true };
      try {
        const liveCaps = resolveVideoGenCapabilities(service);
        const allowedActions = videoGenActionsForCapabilities(liveCaps);
        const action = parseAction(args.action, allowedActions);

        if (action === "catalog") {
          const families = liveCaps.families ?? [];
          return { content: formatVideoGenCatalog(families) };
        }

        if (action === "start" || action === "edit" || action === "extend") {
          const prompt = String(args.prompt ?? "").trim();
          if (!prompt) {
            throw new VideoGenError(
              `prompt is required for action=${action}`,
              "VIDEO_GEN_BAD_ARGS",
            );
          }
          const seconds = parseSeconds(args.seconds);
          const size = parseSize(args.size);
          const kind: VideoGenCreateKind =
            action === "edit"
              ? "edit"
              : action === "extend"
                ? "extend"
                : "generate";

          if (kind === "edit" || kind === "extend") {
            const sourceVideoId = String(args.job_id ?? "").trim();
            if (!sourceVideoId) {
              throw new VideoGenError(
                `job_id (source video) is required for action=${action}`,
                "VIDEO_GEN_BAD_ARGS",
              );
            }
            const job = await service.create({
              prompt,
              kind,
              sourceVideoId,
              ...(seconds !== undefined ? { seconds } : {}),
              ...(args.model ? { model: String(args.model) } : {}),
            });
            return {
              content: [
                `provider=${job.provider} delivery=${job.delivery}`,
                formatJob(job),
                "Next: action=status with job_id until status=completed, then action=content.",
              ].join("\n"),
            };
          }

          // start — t2v / i2v
          let firstFrame;
          let referenceImages;
          if (videoGenSupportsI2v(liveCaps)) {
            const stills = await resolveVideoGenReferenceImages({
              ...(args.first_frame ? { firstFrame: args.first_frame } : {}),
              ...(args.image_url ? { imageUrl: args.image_url } : {}),
              ...(args.reference_image_urls
                ? { referenceImageUrls: args.reference_image_urls }
                : {}),
              ...(args.reference_attachment_ids
                ? { referenceAttachmentIds: args.reference_attachment_ids }
                : {}),
              ...(attachments ? { attachments } : {}),
              maxReferenceImages: liveCaps.maxReferenceImages,
              ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            });
            if (stills.length > 0) {
              firstFrame = stills[0];
              if (stills.length > 1) {
                referenceImages = stills.slice(1);
              }
            }
          } else if (
            args.first_frame ||
            args.image_url ||
            (args.reference_image_urls && args.reference_image_urls.length > 0) ||
            (args.reference_attachment_ids &&
              args.reference_attachment_ids.length > 0)
          ) {
            throw new VideoGenError(
              "This video Provider does not support first-frame / reference images (i2v).",
              "VIDEO_GEN_BAD_ARGS",
            );
          }

          const job = await service.create({
            prompt,
            kind: "generate",
            ...(seconds !== undefined ? { seconds } : {}),
            ...(size ? { size } : {}),
            ...(args.model ? { model: String(args.model) } : {}),
            ...(firstFrame ? { firstFrame } : {}),
            ...(referenceImages ? { referenceImages } : {}),
          });
          return {
            content: [
              `provider=${job.provider} delivery=${job.delivery}`,
              formatJob(job),
              "Next: action=status with job_id until status=completed, then action=content.",
            ].join("\n"),
          };
        }

        const jobId = String(args.job_id ?? "").trim();
        if (!jobId) {
          throw new VideoGenError(
            `job_id is required for action=${action}`,
            "VIDEO_GEN_BAD_ARGS",
          );
        }

        if (action === "status") {
          const job = await service.get(jobId);
          return { content: formatJob(job), isError: job.status === "failed" };
        }

        if (action === "wait") {
          const timeoutMs = clamp(args.timeout_ms ?? 120_000, 1_000, 600_000);
          const interval = clamp(args.poll_interval_ms ?? 10_000, 250, 60_000);
          const deadline = now() + timeoutMs;
          let job = await service.get(jobId);
          while (!isTerminalStatus(job.status) && now() < deadline) {
            await sleep(interval);
            job = await service.get(jobId);
          }
          const timedOut = !isTerminalStatus(job.status);
          return {
            content: [
              timedOut ? `timeout=true waited_ms=${timeoutMs}` : "",
              formatJob(job),
            ]
              .filter(Boolean)
              .join("\n"),
            isError: job.status === "failed",
          };
        }

        // action=content
        try {
          const media = await service.content(jobId);
          let attachmentId: string | undefined;
          let fileName: string | undefined;
          if (attachments) {
            const ref = await attachments.saveFile({
              data: media.bytes,
              mediaType: media.mimeType,
              name: `video_generate_${jobId}.mp4`,
            });
            attachmentId = ref.attachmentId;
            fileName = ref.name;
          }
          return {
            content: [
              `jobId=${jobId} provider=${media.provider} mime=${media.mimeType} bytes=${media.bytes.byteLength}`,
              media.note ? `note=${media.note}` : "",
              attachmentId ? `attachmentId=${attachmentId}` : "",
              fileName ? `file=${fileName}` : "",
              attachmentId
                ? ""
                : "note=no AttachmentStore is wired; the MP4 is not persisted and cannot be returned inline.",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        } catch (err) {
          if (isVideoGenError(err) && err.code === "VIDEO_GEN_NOT_READY") {
            const job = await service.get(jobId).catch(() => undefined);
            return {
              content: ["not_ready=true", job ? formatJob(job) : `jobId=${jobId}`]
                .filter(Boolean)
                .join("\n"),
            };
          }
          throw err;
        }
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [tool];
}
