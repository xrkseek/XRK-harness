/**
 * OpenAI Videos family catalog (Hermes fal `MODEL_FAMILIES` shape, thinner).
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
