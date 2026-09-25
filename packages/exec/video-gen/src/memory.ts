import { MEMORY_VIDEO_GEN_CAPABILITIES } from "./catalog.js";
import type {
  VideoGenCapabilities,
  VideoGenCreateKind,
  VideoGenJob,
  VideoGenRequest,
  VideoGenService,
  VideoGenStatus,
} from "./types.js";
import { VideoGenError } from "./types.js";

/**
 * Minimal MP4: a lone `ftyp` box (24 bytes). Enough for a stable format
 * signature without shipping a real encode in CI.
 */
export function minimalMp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24); // box size
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  bytes.set([0x69, 0x73, 0x6f, 0x6d], 8); // major brand 'isom'
  view.setUint32(12, 0x200); // minor version
  bytes.set([0x69, 0x73, 0x6f, 0x6d], 16); // compatible brand 'isom'
  bytes.set([0x69, 0x73, 0x6f, 0x32], 20); // compatible brand 'iso2'
  return bytes;
}

/** Each `get` advances one step, so polling reaches `completed` deterministically. */
const PROGRESS_STEPS: readonly { status: VideoGenStatus; progress: number }[] = [
  { status: "in_progress", progress: 33 },
  { status: "in_progress", progress: 66 },
  { status: "completed", progress: 100 },
];

interface MemoryJob {
  readonly id: string;
  readonly prompt: string;
  readonly model: string;
  readonly seconds: number;
  readonly size: string;
  readonly kind: VideoGenCreateKind;
  readonly modality: "text" | "image";
  readonly sourceVideoId?: string;
  readonly firstFrameLabel?: string;
  step: number;
  polls: number;
}

export interface MemoryVideoGenOptions {
  readonly note?: string;
  /**
   * Fail the job once `get` has been polled this many times. Omit to always
   * succeed — a test hook for the terminal-failure path.
   */
  readonly failAfter?: number;
  readonly capabilities?: VideoGenCapabilities;
}

/**
 * Deterministic in-memory Provider for CI / demos (`XRK_VIDEO_GEN=memory`).
 * Models the async lifecycle (incl. i2v / edit / extend) without network.
 */
export function createMemoryVideoGenProvider(
  options: MemoryVideoGenOptions = {},
): VideoGenService {
  const jobs = new Map<string, MemoryJob>();
  let seq = 0;
  const caps = options.capabilities ?? MEMORY_VIDEO_GEN_CAPABILITIES;

  const record = (jobId: unknown): MemoryJob => {
    const id = String(jobId ?? "").trim();
    const rec = jobs.get(id);
    if (!rec) {
      throw new VideoGenError(`unknown video job: ${id}`, "VIDEO_GEN_BAD_ARGS");
    }
    return rec;
  };

  const view = (rec: MemoryJob): VideoGenJob => {
    const step = PROGRESS_STEPS[Math.min(rec.step, PROGRESS_STEPS.length - 1)]!;
    const failed = options.failAfter !== undefined && rec.polls >= options.failAfter;
    const status: VideoGenStatus = failed ? "failed" : step.status;
    return {
      jobId: rec.id,
      status,
      ...(failed
        ? { error: "memory provider: simulated render failure" }
        : { progress: step.progress }),
      model: rec.model,
      seconds: rec.seconds,
      size: rec.size,
      provider: "memory",
      delivery: "memory",
      kind: rec.kind,
      modality: rec.modality,
      note:
        options.note ??
        `memory-video-gen:${rec.kind}:${rec.modality}:${rec.prompt.slice(0, 60)}`,
    };
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

      if (kind === "edit" || kind === "extend") {
        if (kind === "edit" && !caps.supportsEdit) {
          throw new VideoGenError(
            "memory Provider configured without edit capability",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        if (kind === "extend" && !caps.supportsExtend) {
          throw new VideoGenError(
            "memory Provider configured without extend capability",
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        const sourceId = String(req.sourceVideoId ?? "").trim();
        if (!sourceId) {
          throw new VideoGenError(
            `sourceVideoId is required for ${kind}`,
            "VIDEO_GEN_BAD_ARGS",
          );
        }
        // Source must exist (completed or otherwise) so tests can chain.
        if (!jobs.has(sourceId)) {
          throw new VideoGenError(
            `unknown source video job: ${sourceId}`,
            "VIDEO_GEN_BAD_ARGS",
          );
        }
      }

      const first = req.firstFrame;
      const extras = req.referenceImages ?? [];
      const stillCount = (first ? 1 : 0) + extras.length;
      if (stillCount > 0 && caps.maxReferenceImages <= 0) {
        throw new VideoGenError(
          "memory Provider configured without i2v capability",
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      if (stillCount > caps.maxReferenceImages) {
        throw new VideoGenError(
          `at most ${caps.maxReferenceImages} reference image(s) allowed`,
          "VIDEO_GEN_BAD_ARGS",
        );
      }

      const modality: "text" | "image" =
        kind === "generate" && stillCount > 0 ? "image" : "text";

      const rec: MemoryJob = {
        id: `video_mem_${(++seq).toString(16)}`,
        prompt,
        model: req.model ?? "sora-2",
        seconds: req.seconds ?? 4,
        size: req.size ?? "1280x720",
        kind,
        modality,
        ...(req.sourceVideoId ? { sourceVideoId: req.sourceVideoId } : {}),
        ...(first?.label ? { firstFrameLabel: first.label } : {}),
        step: 0,
        polls: 0,
      };
      jobs.set(rec.id, rec);
      return {
        jobId: rec.id,
        status: "queued",
        progress: 0,
        model: rec.model,
        seconds: rec.seconds,
        size: rec.size,
        provider: "memory",
        delivery: "memory",
        kind: rec.kind,
        modality: rec.modality,
        note: `memory-video-gen queued:${kind}:${modality}:${prompt.slice(0, 60)}`,
      };
    },

    async get(jobId: string): Promise<VideoGenJob> {
      const rec = record(jobId);
      rec.polls += 1;
      rec.step += 1;
      return view(rec);
    },

    async content(jobId: string) {
      const rec = record(jobId);
      const job = view(rec);
      if (job.status !== "completed") {
        throw new VideoGenError(
          `video job ${rec.id} is ${job.status}, not completed`,
          "VIDEO_GEN_NOT_READY",
        );
      }
      return {
        bytes: minimalMp4Bytes(),
        mimeType: "video/mp4" as const,
        provider: "memory",
        note: `memory-video:${rec.id}:${rec.kind}:${rec.modality}`,
      };
    },
  };
}
