/**
 * 探测结果落盘缓存。
 *
 * 为什么必须缓存：探测一次要发真实 `/chat/completions`，那是**计费**请求。
 * Host 每次重启都探 = 用户重启几次就把当天额度烧完（实测 3/5 → 1/5 → 0/5）。
 *
 * 缓存键按**实际获胜出口**区分（`direct` 或代理 URL）：额度按出口 IP 计，
 * 换出口就是换桶。条目里另存 `egress`，sidecar 可按赢家粘性出口复用。
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** 多久内信任上次结论。额度是日桶，30 分钟足够避免反复烧。 */
export const PROBE_CACHE_TTL_MS = 30 * 60 * 1000;

/** v2: lane 带 egress 赢家；读到 v1 时仍可用（egress 从 key 推断）。 */
const CACHE_VERSION = 2;

function cacheFile() {
  const home = process.env.XRK_HOME?.trim() || path.join(homedir(), ".xrk");
  return path.join(home, "sunflower-free-probe.json");
}

/** 直连 / 各代理各一份；空串统一记作 `direct`。 */
export function probeCacheKey(proxy) {
  if (proxy === false || proxy === null || proxy === undefined) return "direct";
  const value = typeof proxy === "string" ? proxy.trim() : "";
  return value || "direct";
}

/** @returns {"direct"|string} */
export function normalizeEgress(proxy) {
  const key = probeCacheKey(proxy);
  return key === "direct" ? "direct" : key;
}

function readRaw() {
  try {
    return JSON.parse(readFileSync(cacheFile(), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * 读一条结论，**不判过期**——过期也返回，带 `stale` 标记。
 *
 * @returns {{ usable: string[], egress: string, at: number, ttlMs: number, stale: boolean } | undefined}
 */
export function readProbeCacheEntry(proxy, now = Date.now()) {
  const parsed = readRaw();
  if (!parsed || typeof parsed !== "object") return undefined;
  if (parsed.version !== 1 && parsed.version !== CACHE_VERSION) return undefined;
  const key = probeCacheKey(proxy);
  const entry = parsed.lanes?.[key];
  if (!entry || typeof entry !== "object") return undefined;
  if (!Array.isArray(entry.usable) || typeof entry.at !== "number") {
    return undefined;
  }
  const ttlMs =
    typeof entry.ttlMs === "number" ? entry.ttlMs : PROBE_CACHE_TTL_MS;
  const egress =
    typeof entry.egress === "string" && entry.egress.trim()
      ? entry.egress.trim()
      : key === "direct"
        ? "direct"
        : key;
  return {
    usable: entry.usable.filter((id) => typeof id === "string"),
    egress,
    at: entry.at,
    ttlMs,
    stale: now - entry.at > ttlMs,
  };
}

/**
 * 读「最近一次获胜」结论（任意出口）。用于启动：不关心当初是直连还是代理，
 * 先按赢家挂载，再在后台按级联校准。
 *
 * @returns {{ usable: string[], egress: string, at: number, ttlMs: number, stale: boolean, key: string } | undefined}
 */
export function readLatestProbeCacheEntry(now = Date.now()) {
  const parsed = readRaw();
  if (!parsed || typeof parsed !== "object" || !parsed.lanes) return undefined;
  if (parsed.version !== 1 && parsed.version !== CACHE_VERSION) return undefined;
  /** @type {{ usable: string[], egress: string, at: number, ttlMs: number, stale: boolean, key: string } | undefined} */
  let best;
  for (const [key, entry] of Object.entries(parsed.lanes)) {
    if (!entry || typeof entry !== "object") continue;
    if (!Array.isArray(entry.usable) || typeof entry.at !== "number") continue;
    if (entry.usable.length === 0) continue;
    const ttlMs =
      typeof entry.ttlMs === "number" ? entry.ttlMs : PROBE_CACHE_TTL_MS;
    const egress =
      typeof entry.egress === "string" && entry.egress.trim()
        ? entry.egress.trim()
        : key === "direct"
          ? "direct"
          : key;
    const row = {
      usable: entry.usable.filter((id) => typeof id === "string"),
      egress,
      at: entry.at,
      ttlMs,
      stale: now - entry.at > ttlMs,
      key,
    };
    if (!best || row.at > best.at) best = row;
  }
  return best;
}

/** 写回一条结论。空数组也要写：表示「该出口当前不可用」，避免反复探。 */
export function writeProbeCache(proxy, usable, now = Date.now()) {
  const file = cacheFile();
  let parsed = { version: CACHE_VERSION, lanes: {} };
  try {
    const current = JSON.parse(readFileSync(file, "utf8"));
    if (
      (current?.version === 1 || current?.version === CACHE_VERSION) &&
      current.lanes
    ) {
      parsed = { version: CACHE_VERSION, lanes: { ...current.lanes } };
    }
  } catch {
    /* 首次写入或文件损坏：重建 */
  }
  const egress = normalizeEgress(proxy);
  parsed.lanes[probeCacheKey(proxy)] = {
    usable: Array.isArray(usable) ? usable : [],
    egress,
    at: now,
    ttlMs: PROBE_CACHE_TTL_MS,
  };
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    /* 缓存写不了不该让插件启动失败 */
  }
}

/** 删掉整份探测缓存（Settings 改出口后强制级联重探）。 */
export function clearProbeCacheFile() {
  try {
    unlinkSync(cacheFile());
  } catch {
    /* missing */
  }
}
