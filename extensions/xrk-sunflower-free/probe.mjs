/**
 * OFM-shaped availability ping for the OpenCode free roster.
 *
 * Shape: `ping` + `max_tokens: 16` + stream first-byte; one session per model;
 * fan-out concurrency 2 (wide burst → 429 on the same quota window).
 *
 * Product rule (stricter than OFM picker): only `available` enters the Host
 * catalog. `throttled` (FreeUsageLimit) / `unavailable` / `unknown` → omit.
 * Kilo stays listing-only (no chat probe).
 */
import { FREE_MODELS } from "./free-models.mjs";

async function healthy(handle, timeoutMs = 4000) {
  try {
    const health = await fetch(
      `${String(handle.url).replace(/\/v1\/?$/, "")}/__sunflower/health`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return health.ok;
  } catch {
    return false;
  }
}

function looksUnavailable(text) {
  return /unavailable|not supported|no such model|unknown model|FreeUsageLimit/i.test(
    text,
  );
}

/**
 * @returns {Promise<"available"|"unavailable"|"throttled"|"unknown">}
 */
export async function probeOneModel(handle, model, timeoutMs = 45000) {
  try {
    const res = await fetch(`${handle.url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sunflower-key": handle.key,
        "x-xrk-session": `xrkh-probe-${model}`,
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        stream: true,
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      if (/FreeUsageLimit/i.test(body)) return "throttled";
      return "throttled";
    }
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      return "unavailable";
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (looksUnavailable(body)) {
        return /FreeUsageLimit/i.test(body) ? "throttled" : "unavailable";
      }
      return "unknown";
    }
    if (!res.body) return "available";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (/"(?:type"\s*:\s*"error"|"error"\s*:)/.test(buf)) {
        await reader.cancel().catch(() => {});
        if (/FreeUsageLimit/i.test(buf)) return "throttled";
        return looksUnavailable(buf) ? "unavailable" : "unknown";
      }
      if (
        /data:\s*\{/.test(buf) ||
        /data:\s*\[DONE\]/.test(buf) ||
        buf.length > 4096
      ) {
        await reader.cancel().catch(() => {});
        return "available";
      }
    }
    return buf.length > 0 ? "available" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Bounded fan-out (OFM uses 2).
 * @template T
 * @param {readonly T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} worker
 */
async function mapPool(items, concurrency, worker) {
  const queue = [...items];
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
      }
    }),
  );
}

/**
 * Probe OpenCode candidates; return only ids that answered `available`.
 * Logs omit reasons so Host boot shows why a row disappeared.
 *
 * @returns {Promise<string[]>}
 */
export async function probeUsableModels(
  handle,
  candidates = FREE_MODELS,
  timeoutMs = 45000,
  concurrency = 2,
) {
  if (!(await healthy(handle))) return [];
  /** @type {string[]} */
  const usable = [];
  await mapPool([...candidates], concurrency, async (model) => {
    const state = await probeOneModel(handle, model, timeoutMs);
    if (state === "available") {
      usable.push(model);
      return;
    }
    const why =
      state === "throttled"
        ? "FreeUsageLimit / quota"
        : state === "unavailable"
          ? "upstream will not route"
          : "no clear verdict";
    console.warn(`[sunflower-free] ${model}: ${why} (omit on this Host)`);
  });
  return usable;
}
