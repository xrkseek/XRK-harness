/**
 * Kilo free pool (https://api.kilo.ai/api/gateway) — keyless OpenAI-compatible.
 * Roster = listing `isFree: true`. No per-model chat probe (OFM).
 */

export const KILO_BASE = (
  process.env.XRK_SUNFLOWER_KILO_BASE?.trim() ||
  "https://api.kilo.ai/api/gateway"
).replace(/\/+$/, "");

/**
 * @param {unknown} row
 * @returns {boolean}
 */
export function isKiloFreeRow(row) {
  return (
    row !== null &&
    typeof row === "object" &&
    /** @type {{ isFree?: unknown; id?: unknown }} */ (row).isFree === true &&
    typeof /** @type {{ id?: unknown }} */ (row).id === "string" &&
    /** @type {{ id: string }} */ (row).id.trim() !== ""
  );
}

/**
 * @param {{ id?: unknown; name?: unknown }} row
 * @returns {string}
 */
export function kiloDisplayName(row) {
  const raw = typeof row?.name === "string" ? row.name.trim() : "";
  const bare = (raw !== "" ? raw : String(row?.id ?? ""))
    .replace(/^[^:]{1,40}:\s+/, "")
    .replace(/\s*\(free\)\s*$/i, "")
    .trim();
  const pretty =
    bare !== ""
      ? bare
      : String(row?.id ?? "")
          .replace(/[-_.]+/g, " ")
          .trim();
  return `Kilo ${pretty}`;
}

/**
 * @param {unknown} n
 * @returns {number | undefined}
 */
function positiveInt(n) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return Math.floor(v);
}

/**
 * Face / brand catalog row from one listing object.
 * @param {unknown} row
 * @returns {{
 *   id: string;
 *   name: string;
 *   contextWindow: number;
 *   inputModalities: ("text" | "image")[];
 *   description?: string;
 * }}
 */
export function kiloCatalogEntry(row) {
  const r = /** @type {{
    id: string;
    architecture?: { input_modalities?: unknown };
    context_length?: unknown;
    top_provider?: { context_length?: unknown };
  }} */ (row);
  const mods = Array.isArray(r.architecture?.input_modalities)
    ? r.architecture.input_modalities.map((m) => String(m).toLowerCase())
    : [];
  const vision = mods.includes("image");
  const contextWindow =
    positiveInt(r.context_length) ??
    positiveInt(r.top_provider?.context_length) ??
    131_072;
  return {
    id: String(r.id).trim(),
    name: kiloDisplayName(r),
    contextWindow,
    inputModalities: vision ? ["text", "image"] : ["text"],
    ...(vision ? { description: "多模态 · 支持图片" } : {}),
  };
}

/**
 * Fetch free-pool catalog. Empty / unreachable → [].
 * Honors `XRK_SUNFLOWER_KILO_PROXY` (or [options.proxyUrl]) via undici ProxyAgent.
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string; proxyUrl?: string }} [options]
 */
export async function fetchKiloFreeCatalog(options = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? KILO_BASE).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 15000;
  const proxy = (options.proxyUrl ?? process.env.XRK_SUNFLOWER_KILO_PROXY)?.trim();
  /** @type {Record<string, unknown>} */
  const init = {
    headers: {
      accept: "application/json",
      "user-agent": "xrk-sunflower-free",
    },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (proxy && !options.fetchImpl) {
    try {
      const { ProxyAgent } = await import("undici");
      init.dispatcher = new ProxyAgent(proxy);
    } catch {
      /* no undici — fall through to direct */
    }
  }
  try {
    const res = await doFetch(`${base}/models`, init);
    if (!res.ok) return [];
    const payload = await res.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const seen = new Set();
    /** @type {ReturnType<typeof kiloCatalogEntry>[]} */
    const out = [];
    for (const row of data) {
      if (!isKiloFreeRow(row)) continue;
      const entry = kiloCatalogEntry(row);
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}
