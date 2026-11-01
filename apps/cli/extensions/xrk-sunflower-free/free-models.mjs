/**
 * OpenCode anonymous free-lane candidates + capacity table.
 *
 * Boot: `probe.mjs` pings each id (OFM shape); one `available` → fuzzy-mount
 * the full roster. Efforts mirror OFM `FREE_ID_OVERRIDES` / family caps.
 */

/** Candidate OpenCode free ids advertised when the sidecar is up. */
export const FREE_MODELS = Object.freeze([
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "big-pickle",
  "mimo-v2.6-flash-free",
  "flint-40b-free",
]);

export const DEFAULT_FREE_MODEL = FREE_MODELS[0];

/**
 * Exact-id capacity (OFM FREE_ID_OVERRIDES + flint).
 * Unknown ids → 131072 / text-only / no effort menu.
 * @type {Readonly<Record<string, {
 *   contextWindow: number;
 *   vision?: boolean;
 *   name?: string;
 *   efforts?: readonly string[];
 *   effortDefault?: string;
 * }>>}
 */
export const FREE_MODEL_CAPS = Object.freeze({
  "deepseek-v4.1-flash-free": {
    contextWindow: 1_048_576,
    vision: true,
    name: "DeepSeek V4.1 Flash",
    // OFM: effort.values includes none → Face `off` (wire → none).
    efforts: ["off", "low", "high", "max"],
    effortDefault: "high",
  },
  "glm-5.3-flash-free": {
    contextWindow: 1_048_576,
    vision: true,
    name: "GLM 5.3 Flash",
    // OFM: no none — Off would not honour.
    efforts: ["low", "high", "max"],
    effortDefault: "high",
  },
  "big-pickle": {
    contextWindow: 262_144,
    vision: true,
    name: "Big Pickle",
  },
  "mimo-v2.6-flash-free": {
    contextWindow: 1_048_576,
    vision: true,
    name: "MiMo V2.6 Flash",
    // OFM family row: reasoning but no effort.values → no menu (token ladder).
  },
  "flint-40b-free": {
    contextWindow: 131_072,
    vision: false,
    name: "Flint 40B",
  },
});

const DEFAULT_CAPS = Object.freeze({
  contextWindow: 131_072,
  vision: false,
});

/**
 * @param {string} modelId
 * @returns {{
 *   id: string;
 *   name: string;
 *   contextWindow: number;
 *   inputModalities: ("text"|"image")[];
 *   description?: string;
 *   reasoning?: { efforts: { id: string; name: string }[]; defaultEffort?: string };
 * }}
 */
export function openCodeCatalogEntry(modelId) {
  const id = String(modelId ?? "").trim();
  const caps = FREE_MODEL_CAPS[id] ?? DEFAULT_CAPS;
  const vision = caps.vision === true;
  const efforts = Array.isArray(caps.efforts) ? caps.efforts : undefined;
  const reasoning =
    efforts && efforts.length > 0
      ? {
          efforts: efforts.map((effortId) => ({
            id: effortId,
            name: effortId.charAt(0).toUpperCase() + effortId.slice(1),
          })),
          ...(typeof caps.effortDefault === "string" &&
          efforts.includes(caps.effortDefault)
            ? { defaultEffort: caps.effortDefault }
            : {}),
        }
      : undefined;
  return {
    id,
    name: caps.name ?? id,
    contextWindow: caps.contextWindow ?? DEFAULT_CAPS.contextWindow,
    inputModalities: vision ? ["text", "image"] : ["text"],
    ...(vision ? { description: "多模态 · 支持图片" } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}
