import type { AttachmentStore } from "@xrkseek/attachment";
import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import { VIDEO_GEN_PROMPT_TEXT } from "./format.js";
import {
  VideoGenError,
  isTerminalStatus,
  isVideoGenError,
  type VideoGenJob,
  type VideoGenSeconds,
  type VideoGenService,
  type VideoGenSize,
} from "./types.js";

export { VIDEO_GEN_PROMPT_TEXT };

const SIZES: readonly VideoGenSize[] = [
  "720x1280",
  "1280x720",
  "1024x1792",
  "1792x1024",
];

const SECONDS: readonly VideoGenSeconds[] = [4, 8, 12];

const ACTIONS = ["start", "status", "content", "wait"] as const;
type VideoGenAction = (typeof ACTIONS)[number];

export function videoGenUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const flag = String(env.XRK_VIDEO_GEN ?? "")
    .trim()
    .toLowerCase();
  if (!flag) {
    return (
      "Error: video generation is not enabled. Set XRK_VIDEO_GEN=memory (CI/demo) or " +
      "XRK_VIDEO_GEN=1 with OPENAI_API_KEY / XRK_VIDEO_GEN_OPENAI_KEY. See docs/video-gen.md."
    );
  }
  if (flag === "1") {
    return (
      "Error: XRK_VIDEO_GEN=1 but no API key. Set OPENAI_API_KEY or XRK_VIDEO_GEN_OPENAI_KEY " +
      "(optional XRK_VIDEO_GEN_BASE_URL / XRK_VIDEO_GEN_MODEL)."
    );
  }
  return "Error: no VideoGenService Provider is configured. Inject a service or set XRK_VIDEO_GEN.";
}

export interface CreateVideoGenToolsOptions {
  readonly service?: VideoGenService;
  readonly env?: NodeJS.ProcessEnv;
  /** When set, persist the finished MP4 and return an attachment id. */
  readonly attachments?: AttachmentStore;
  /** Injected sleep for `action=wait`; tests avoid real polling delays. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
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

function parseAction(raw: unknown): VideoGenAction {
  if (raw === undefined || raw === null || raw === "") return "start";
  const a = String(raw).trim().toLowerCase() as VideoGenAction;
  if (!(ACTIONS as readonly string[]).includes(a)) {
    throw new VideoGenError(
      `action must be one of ${ACTIONS.join(", ")}`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  return a;
}

function parseSize(raw: unknown): VideoGenSize | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim() as VideoGenSize;
  if (!(SIZES as readonly string[]).includes(s)) {
    throw new VideoGenError(
      `size must be one of ${SIZES.join(", ")}`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  return s;
}

function parseSeconds(raw: unknown): VideoGenSeconds | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!(SECONDS as readonly number[]).includes(n)) {
    throw new VideoGenError(
      `seconds must be one of ${SECONDS.join(", ")}`,
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
    job.note ? `note=${job.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Model-facing `video_generate` tool.
 *
 * Video renders are asynchronous, so the tool exposes the job lifecycle rather
 * than blocking a turn for minutes: `start` → `status` / `wait` → `content`.
 */
export function createVideoGenTools(
  options: CreateVideoGenToolsOptions = {},
): ToolDefinition[] {
  const missing = videoGenUnavailableMessage(options.env ?? process.env);
  const service = options.service;
  const attachments = options.attachments;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const tool: ToolDefinition<VideoGenToolArgs> = {
    name: "video_generate",
    description:
      "Generate a video from a text prompt via the Host text-to-video Provider. Renders are asynchronous: " +
      "action=start (default) returns a jobId, poll with action=status (or action=wait to block), then " +
      "action=content downloads the MP4. The MP4 is saved to the Host attachment store when one is wired; " +
      "video bytes are never inlined into tool text.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...ACTIONS],
          description:
            "start (default) | status | content | wait. start needs `prompt`; the others need `job_id`.",
        },
        prompt: {
          type: "string",
          description:
            "Complete visual prompt for action=start (subject, motion, camera, lighting).",
        },
        job_id: {
          type: "string",
          description: "Job id returned by action=start.",
        },
        model: {
          type: "string",
          description: "Optional model override (e.g. sora-2, sora-2-pro).",
        },
        seconds: {
          type: "number",
          enum: [...SECONDS],
          description: "Clip duration in seconds (default 4).",
        },
        size: {
          type: "string",
          enum: [...SIZES],
          description: "Output size (provider-dependent; default 1280x720).",
        },
        timeout_ms: {
          type: "number",
          description: "action=wait: give up after this long (default 120000).",
        },
        poll_interval_ms: {
          type: "number",
          description: "action=wait: poll spacing (default 10000).",
        },
      },
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
        const action = parseAction(args.action);

        if (action === "start") {
          const prompt = String(args.prompt ?? "").trim();
          if (!prompt) {
            throw new VideoGenError(
              "prompt is required for action=start",
              "VIDEO_GEN_BAD_ARGS",
            );
          }
          const seconds = parseSeconds(args.seconds);
          const size = parseSize(args.size);
          const job = await service.create({
            prompt,
            ...(seconds !== undefined ? { seconds } : {}),
            ...(size ? { size } : {}),
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
