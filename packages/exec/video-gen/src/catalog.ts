/**
 * OpenAI Videos family catalog + Hermes-scale FAL / OpenRouter / DeepInfra catalogs.
 * Provider `capabilities().families` surfaces this for `action=catalog`.
 */

import type {
  VideoGenCapabilities,
  VideoGenFamilyEntry,
  VideoGenSeconds,
  VideoGenSize,
} from "./types.js";

export const VIDEO_GEN_SECONDS: readonly VideoGenSeconds[] = [4, 8, 12];

export const VIDEO_GEN_SIZES: readonly VideoGenSize[] = [
  "720x1280",
  "1280x720",
  "1024x1792",
  "1792x1024",
];

function falFamily(
  id: string,
  displayName: string,
  note: string,
  modalities: readonly ("text" | "image")[] = ["text", "image"],
  seconds: readonly VideoGenSeconds[] = VIDEO_GEN_SECONDS,
): VideoGenFamilyEntry {
  return {
    id,
    displayName,
    modalities,
    seconds,
    sizes: VIDEO_GEN_SIZES,
    supportsEdit: false,
    supportsExtend: false,
    note,
  };
}

/** Sora-2 family: t2v + first-frame i2v + edit + extend. */
export const OPENAI_VIDEO_GEN_FAMILIES: readonly VideoGenFamilyEntry[] = [
  {
    id: "sora-2",
    displayName: "Sora 2",
    modalities: ["text", "image"],
    seconds: VIDEO_GEN_SECONDS,
    sizes: VIDEO_GEN_SIZES,
    supportsEdit: true,
    supportsExtend: true,
    note: "OpenAI Videos — first frame via input_reference; edit/extend via /videos/edits|/videos/extensions.",
  },
  {
    id: "sora-2-pro",
    displayName: "Sora 2 Pro",
    modalities: ["text", "image"],
    seconds: VIDEO_GEN_SECONDS,
    sizes: VIDEO_GEN_SIZES,
    supportsEdit: true,
    supportsExtend: true,
    note: "Higher-fidelity Sora tier; same i2v / edit / extend surface as sora-2.",
  },
];

/** Caps + catalog for the OpenAI Videos Provider. */
export const OPENAI_VIDEO_GEN_CAPABILITIES: VideoGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 1,
  supportsEdit: true,
  supportsExtend: true,
  families: OPENAI_VIDEO_GEN_FAMILIES,
};

/** Memory Provider mirrors OpenAI surface so CI exercises the full schema. */
export const MEMORY_VIDEO_GEN_CAPABILITIES: VideoGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 1,
  supportsEdit: true,
  supportsExtend: true,
  families: [
    {
      id: "sora-2",
      displayName: "Memory (Sora-shaped)",
      modalities: ["text", "image"],
      seconds: VIDEO_GEN_SECONDS,
      sizes: VIDEO_GEN_SIZES,
      supportsEdit: true,
      supportsExtend: true,
      note: "Deterministic in-memory stand-in for CI / demos.",
    },
  ],
};

/**
 * Hermes `FAL_FAMILIES` main-path catalog (tool seconds clamped to 4|8|12).
 * Host Settings `model` selects a family id.
 */
export const FAL_VIDEO_GEN_FAMILIES: readonly VideoGenFamilyEntry[] = [
  falFamily("ltx-2.3", "LTX 2.3 (22B)", "FAL cheap — native audio."),
  falFamily("ltx-2.5", "LTX 2.5", "FAL cheap — Lightricks audio-video."),
  falFamily("pixverse-v6", "Pixverse v6", "FAL cheap default — t2v + i2v."),
  falFamily("seedance-2.0-mini", "Seedance 2.0 Mini", "FAL cheap — ByteDance mini."),
  falFamily(
    "veo3.1",
    "Veo 3.1",
    "FAL premium — Google Veo via queue.",
    ["text", "image"],
    [4, 8],
  ),
  falFamily("seedance-2.0", "Seedance 2.0", "FAL premium — ByteDance cinematic."),
  falFamily("seedance-2.5", "Seedance 2.5", "FAL premium — ByteDance flagship."),
  falFamily("minimax-h3", "MiniMax H3", "FAL premium — MiniMax frontier."),
  falFamily("minimax-h3-max", "MiniMax H3 Max", "FAL premium — fal post-train Max."),
  falFamily(
    "minimax-h3-max-turbo",
    "MiniMax H3 Max Turbo",
    "FAL premium — throughput-tuned Max.",
  ),
  falFamily("flux-3", "FLUX 3", "FAL premium — Black Forest Labs video."),
  falFamily("grok-imagine-1.5", "Grok Imagine 1.5", "FAL premium — xAI via FAL."),
  falFamily(
    "gemini-omni-flash",
    "Gemini Omni Flash 1.1",
    "FAL premium — Google Omni Flash.",
  ),
  falFamily("kling-v3", "Kling 3.0", "FAL premium — Kling standard; start_image_url."),
  falFamily("kling-v3-pro", "Kling 3.0 Pro", "FAL premium — Kling Pro."),
  falFamily("kling-v3-4k", "Kling v3 4K", "FAL premium — Kling 4K."),
  falFamily("kling-o3", "Kling O3", "FAL premium — multi-shot storytelling."),
  falFamily("wan-3.0", "Wan 3.0", "FAL premium — Alibaba Wan."),
  falFamily("wan-3.0-prime", "Wan 3.0 Prime", "FAL premium — Alibaba Wan Prime."),
  falFamily("happy-horse", "Happy Horse 1.1", "FAL premium — Alibaba Happy Horse."),
];

export const FAL_VIDEO_GEN_CAPABILITIES: VideoGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 1,
  supportsEdit: false,
  supportsExtend: false,
  families: FAL_VIDEO_GEN_FAMILIES,
};

/** xAI Grok Imagine video caps (Hermes video_gen/xai). */
export const XAI_VIDEO_GEN_CAPABILITIES: VideoGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 7,
  supportsEdit: true,
  supportsExtend: true,
  families: [
    {
      id: "grok-imagine-video",
      displayName: "Grok Imagine Video",
      modalities: ["text", "image"],
      seconds: VIDEO_GEN_SECONDS,
      sizes: VIDEO_GEN_SIZES,
      supportsEdit: true,
      supportsExtend: true,
      note: "xAI t2v / reference-to-video; edit/extend via public MP4 URL.",
    },
    {
      id: "grok-imagine-video-1.5",
      displayName: "Grok Imagine Video 1.5",
      modalities: ["image"],
      seconds: VIDEO_GEN_SECONDS,
      sizes: VIDEO_GEN_SIZES,
      supportsEdit: false,
      supportsExtend: false,
      note: "xAI image-to-video tier.",
    },
  ],
};

/** OpenRouter Videos offline seed (live `/videos/models` when reachable). */
export const OPENROUTER_VIDEO_GEN_FAMILIES: readonly VideoGenFamilyEntry[] = [
  falFamily(
    "minimax/hailuo-3-max",
    "MiniMax Hailuo 3 Max",
    "OpenRouter default — first-frame i2v when catalog allows.",
  ),
  falFamily(
    "google/veo-3.1",
    "Google Veo 3.1",
    "OpenRouter — Veo via unified videos API.",
  ),
  falFamily(
    "openai/sora-2",
    "OpenAI Sora 2",
    "OpenRouter — Sora when billed on the account.",
  ),
  falFamily(
    "x-ai/grok-imagine-video",
    "Grok Imagine Video",
    "OpenRouter — xAI video.",
  ),
];

export const OPENROUTER_VIDEO_GEN_CAPABILITIES: VideoGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 3,
  supportsEdit: false,
  supportsExtend: false,
  families: OPENROUTER_VIDEO_GEN_FAMILIES,
};

/** DeepInfra OpenAI-compatible Videos (Hermes: live catalog; offline seed). */
export const DEEPINFRA_VIDEO_GEN_CAPABILITIES: VideoGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 1,
  supportsEdit: false,
  supportsExtend: false,
  families: [
    falFamily(
      "Wan-AI/Wan2.1-T2V-14B",
      "Wan 2.1 T2V 14B",
      "DeepInfra OpenAI-compatible videos; pin model via Settings when catalog differs.",
    ),
  ],
};

/** Format family rows for `action=catalog` tool text. */
export function formatVideoGenCatalog(
  families: readonly VideoGenFamilyEntry[],
): string {
  if (families.length === 0) {
    return "catalog=empty (Provider has no family list)";
  }
  const lines = ["catalog:"];
  for (const f of families) {
    const mods = f.modalities.join("+");
    const flags = [
      f.supportsEdit ? "edit" : "",
      f.supportsExtend ? "extend" : "",
    ]
      .filter(Boolean)
      .join(",");
    lines.push(
      [
        `- id=${f.id}`,
        `display=${f.displayName}`,
        `modalities=${mods}`,
        `seconds=${f.seconds.join("|")}`,
        `sizes=${f.sizes.join("|")}`,
        flags ? `ops=${flags}` : "",
        f.note ? `note=${f.note}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return lines.join("\n");
}
