/**
 * Build model-facing tool parameters from Provider capabilities
 * (Hermes `_build_dynamic_video_schema`).
 */

import { VIDEO_GEN_SECONDS, VIDEO_GEN_SIZES } from "./catalog.js";
import {
  videoGenSupportsI2v,
  type VideoGenCapabilities,
} from "./types.js";

export interface VideoGenToolParameters {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
}

const BASE_ACTIONS = ["start", "status", "content", "wait", "catalog"] as const;

/** Actions exposed given caps (edit/extend only when supported). */
export function videoGenActionsForCapabilities(
  caps: VideoGenCapabilities,
): readonly string[] {
  const actions: string[] = [...BASE_ACTIONS];
  if (caps.supportsEdit) actions.push("edit");
  if (caps.supportsExtend) actions.push("extend");
  return actions;
}

/** Static base + i2v / edit / extend args only when capabilities allow. */
export function buildVideoGenToolParameters(
  caps: VideoGenCapabilities,
): VideoGenToolParameters {
  const actions = videoGenActionsForCapabilities(caps);
  const properties: Record<string, unknown> = {
    action: {
      type: "string",
      enum: [...actions],
      description:
        "start (default, t2v/i2v) | status | content | wait | catalog" +
        (caps.supportsEdit ? " | edit" : "") +
        (caps.supportsExtend ? " | extend" : "") +
        ". start needs `prompt`; status/content/wait need `job_id`; " +
        "edit/extend need `job_id` (source) + `prompt`; catalog lists families.",
    },
    prompt: {
      type: "string",
      description:
        "Complete visual prompt for start/edit/extend (subject, motion, camera, lighting).",
    },
    job_id: {
      type: "string",
      description:
        "Job id from start (status/content/wait), or source video id for edit/extend.",
    },
    model: {
      type: "string",
      description:
        "Optional model / family override (e.g. sora-2, sora-2-pro). See action=catalog.",
    },
    seconds: {
      type: "number",
      enum: [...VIDEO_GEN_SECONDS],
      description: "Clip duration in seconds (default 4; also used by extend).",
    },
    size: {
      type: "string",
      enum: [...VIDEO_GEN_SIZES],
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
  };

  if (videoGenSupportsI2v(caps)) {
    properties.first_frame = {
      type: "string",
      description:
        "First-frame still for image-to-video: https URL, data:image/…;base64,…, or attachment:<attachmentId>. Alias of image_url.",
    };
    properties.image_url = {
      type: "string",
      description:
        "Hermes-compatible alias of first_frame (same schemes). Prefer first_frame when both are set as primary.",
    };
    properties.reference_image_urls = {
      type: "array",
      items: { type: "string" },
      description: `Additional reference still URLs (same schemes). Max ${caps.maxReferenceImages} source(s) total (OpenAI first-frame = 1).`,
    };
    properties.reference_attachment_ids = {
      type: "array",
      items: { type: "string" },
      description:
        "Host AttachmentStore image ids as first-frame / refs (preferred when already attached).",
    };
  }

  return { type: "object", properties };
}

export function buildVideoGenToolDescription(
  caps: VideoGenCapabilities,
): string {
  const parts = [
    "Generate a video via the Host video Provider. Renders are asynchronous: " +
      "action=start (default) returns a jobId; poll with action=status (or action=wait); " +
      "action=content downloads the MP4. action=catalog lists model families.",
  ];
  if (videoGenSupportsI2v(caps)) {
    parts.push(
      `With first_frame / image_url / reference_* (≤${caps.maxReferenceImages}) → image-to-video (first frame).`,
    );
  } else {
    parts.push("This Provider is text-to-video only (no first-frame input).");
  }
  if (caps.supportsEdit) {
    parts.push("action=edit: rewrite an existing completed video (job_id + prompt).");
  }
  if (caps.supportsExtend) {
    parts.push(
      "action=extend: continue a completed video (job_id + prompt; optional seconds).",
    );
  }
  parts.push(
    "The MP4 is saved to the Host attachment store when one is wired; video bytes are never inlined into tool text.",
  );
  return parts.join(" ");
}
