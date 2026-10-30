/**
 * OpenCode 出口级联：先直连，再候选代理。
 *
 * 规则（产品）：
 *   1. 探测不挡 Host 听口（由调用方决定 await / background）。
 *   2. 一律先直连探一轮；有可用模型 → 粘住直连，结束。
 *   3. 直连 0 可用 **且** 存在候选代理 → 切代理再探一轮。
 *   4. Settings `openCodeProxy=off` → 永不试代理。
 *   5. 留空 / `auto` → 直连失败后让 sidecar 探测本机回环常见口。
 *   6. 显式 URL → 直连失败后用该 URL。
 *
 * 探测走 sidecar loopback；出口由 `POST /__sunflower/egress` 粘性切换，
 * 聊天与探针共用同一赢家，避免「探到了代理、聊天还走直连」。
 */
import { FREE_MODELS } from "./free-models.mjs";
import { normalizeEgress, writeProbeCache } from "./probe-cache.mjs";
import { probeUsableModels } from "./probe.mjs";

/**
 * @param {string | undefined} raw settings / env `XRK_SUNFLOWER_PROXY`
 * @returns {"off"|"auto"|"url"|undefined} undefined = 与 auto 相同（有本机代理才试）
 */
export function classifyProxySetting(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "off") return "off";
  if (lower === "auto") return "auto";
  return "url";
}

/**
 * @param {{ url: string; key: string }} handle
 * @param {false | "auto" | string} proxy
 */
export async function setSidecarEgress(handle, proxy, timeoutMs = 4000) {
  const base = String(handle.url).replace(/\/v1\/?$/, "");
  const res = await fetch(`${base}/__sunflower/egress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sunflower-key": handle.key,
    },
    body: JSON.stringify({ proxy }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `sidecar egress ${res.status}: ${body.slice(0, 200) || res.statusText}`,
    );
  }
  const json = await res.json().catch(() => ({}));
  return {
    proxy: json?.proxy === null || json?.proxy === undefined ? false : json.proxy,
  };
}

/**
 * @param {{ url: string; key: string }} handle
 * @returns {Promise<false | string>}
 */
export async function resolveCandidateProxy(handle, env = process.env) {
  const kind = classifyProxySetting(env.XRK_SUNFLOWER_PROXY);
  if (kind === "off") return false;
  if (kind === "url") return String(env.XRK_SUNFLOWER_PROXY).trim();
  // empty / auto → ask sidecar to discover loopback (Clash 7897 等)
  const applied = await setSidecarEgress(handle, "auto");
  return applied.proxy === false ? false : String(applied.proxy);
}

/**
 * @typedef {{ usable: string[]; egress: string }} CascadeResult
 */

/**
 * 直连 →（可选）代理 级联探测。
 *
 * @param {{ url: string; key: string }} handle
 * @param {(handle: any, candidates?: string[]) => Promise<string[]>} [probe]
 * @returns {Promise<CascadeResult>}
 */
export async function probeOpenCodeCascade(
  handle,
  candidates = FREE_MODELS,
  probe = probeUsableModels,
  env = process.env,
) {
  // —— 1) 直连 ——
  await setSidecarEgress(handle, false);
  console.info("[sunflower-free] cascade: probe direct…");
  let usable = await probe(handle, candidates);
  if (usable.length > 0) {
    const egress = "direct";
    writeProbeCache(false, usable);
    console.info(
      `[sunflower-free] cascade: direct ok — ${usable.length}/${candidates.length} usable`,
    );
    return { usable, egress };
  }

  // —— 2) 候选代理 ——
  const kind = classifyProxySetting(env.XRK_SUNFLOWER_PROXY);
  if (kind === "off") {
    writeProbeCache(false, []);
    console.warn(
      "[sunflower-free] cascade: direct empty; openCodeProxy=off — skip proxy",
    );
    return { usable: [], egress: "direct" };
  }

  let candidate;
  try {
    candidate = await resolveCandidateProxy(handle, env);
  } catch (error) {
    writeProbeCache(false, []);
    console.warn(
      `[sunflower-free] cascade: resolve proxy failed (${error?.message ?? error})`,
    );
    return { usable: [], egress: "direct" };
  }

  if (!candidate) {
    writeProbeCache(false, []);
    console.warn(
      "[sunflower-free] cascade: direct empty; no local proxy candidate",
    );
    return { usable: [], egress: "direct" };
  }

  // resolveCandidateProxy(auto) already sticky-set; explicit URL still needs set.
  if (kind === "url") {
    await setSidecarEgress(handle, candidate);
  }

  console.info(`[sunflower-free] cascade: probe via ${candidate}…`);
  usable = await probe(handle, candidates);
  const egress = normalizeEgress(candidate);
  writeProbeCache(candidate, usable);
  console.info(
    `[sunflower-free] cascade: proxy ${usable.length > 0 ? "ok" : "empty"} — ${usable.length}/${candidates.length} usable via ${egress}`,
  );
  return { usable, egress };
}

/**
 * Restore sticky egress on a live sidecar from a cache winner (no chat probe).
 * @param {{ url: string; key: string }} handle
 * @param {string} egress
 */
export async function applyCachedEgress(handle, egress) {
  if (!egress || egress === "direct") {
    await setSidecarEgress(handle, false);
    return;
  }
  await setSidecarEgress(handle, egress);
}
