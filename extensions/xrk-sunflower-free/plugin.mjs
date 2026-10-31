/**
 * 向日葵免费 — `kind: "llm"` 入口（对齐 OFM 双车道）。
 *
 *   OpenCode（`sunflower-free`）：仅 Bun sidecar + 探针 `available`；无 Bun 静默省略。
 *   Kilo（`sunflower-kilo`）：listing `isFree`，Host→api.kilo.ai 直连，**不绑 Bun**。
 *   OpenCode 上游恒 `Bearer public`；Kilo 无密钥。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_FREE_MODEL,
  FREE_MODELS,
  openCodeCatalogEntry,
} from "./free-models.mjs";
import { fetchKiloFreeCatalog, KILO_BASE } from "./kilo.mjs";
import { readLatestProbeCacheEntry } from "./probe-cache.mjs";
import {
  applyCachedEgress,
  probeOpenCodeCascade,
} from "./probe-cascade.mjs";
import { probeUsableModels, sidecarHealthy } from "./probe.mjs";

export const SUNFLOWER_BRAND_ID = "sunflower-free";
/** Kilo keyless pool — OFM: Node fetch only, never requires Bun. */
export const SUNFLOWER_KILO_BRAND_ID = "sunflower-kilo";
export const SUNFLOWER_DISPLAY_NAME = "向日葵免费";
export const SUNFLOWER_KILO_DISPLAY_NAME = "向日葵免费 · Kilo";
export const SUNFLOWER_DEFAULT_MODEL = DEFAULT_FREE_MODEL;
export const SUNFLOWER_MODELS = FREE_MODELS;
/** Sidecar ↔ Host 一次性 key（进程内，不落盘）。 */
export const SUNFLOWER_KEY_ENV = "XRK_SUNFLOWER_SIDECAR_KEY";

export { KILO_BASE, fetchKiloFreeCatalog } from "./kilo.mjs";
export { sidecarHealthy };

/**
 * Locate Bun for the OpenCode sidecar.
 * Order: `XRK_SUNFLOWER_BUN` → optional plugin `vendor/` → `~/.bun/bin` → PATH.
 * Product installs never ship Bun; missing → omit OpenCode (no warn).
 */
export function resolveBunBinary(env = process.env, here = import.meta.dirname) {
  const explicit = env.XRK_SUNFLOWER_BUN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : undefined;

  const bunName = process.platform === "win32" ? "bun.exe" : "bun";
  const vendored = path.join(here, "vendor", bunName);
  if (existsSync(vendored)) return vendored;

  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  if (home) {
    const bunHome = path.join(home, ".bun", "bin", bunName);
    if (existsSync(bunHome)) return bunHome;
  }

  const probe = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["bun"],
    { encoding: "utf8", windowsHide: true },
  );
  if (probe.status === 0) {
    for (const line of String(probe.stdout ?? "").split(/\r?\n/u)) {
      const hit = line.trim();
      if (hit && existsSync(hit)) return hit;
    }
  }
  return undefined;
}

/**
 * Spawn Bun sidecar; resolve `{ url, port, key }` from first stdout JSON line.
 * @returns {Promise<{ url: string; key: string; port: number; stop(): Promise<void> } | undefined>}
 */
export async function spawnSidecar(options = {}) {
  const bun = options.bunBinary ?? resolveBunBinary();
  if (!bun) return undefined;
  const entry = options.entry ?? path.join(import.meta.dirname, "sidecar.ts");
  if (!existsSync(entry)) return undefined;

  const kiloIds = Array.isArray(options.kiloModelIds)
    ? options.kiloModelIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  const child = spawn(bun, ["run", entry], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      XRK_SUNFLOWER_PORT: "0",
      // Defense: free lane must never see a user Go / Zen key even if set in Host.
      XRK_SUNFLOWER_OPENCODE_KEY: "",
      OPENCODE_API_KEY: "",
      OPENCODE_KEY: "",
      OPENCODE_GO_API_KEY: "",
      ...(kiloIds.length > 0
        ? { XRK_SUNFLOWER_KILO_IDS: kiloIds.join(",") }
        : {}),
      ...(options.kiloBase
        ? { XRK_SUNFLOWER_KILO_BASE: String(options.kiloBase) }
        : {}),
    },
  });

  const info = await new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(undefined),
      options.timeoutMs ?? 20000,
    );
    const fail = () => {
      clearTimeout(timer);
      resolve(undefined);
    };
    child.on("error", fail);
    child.stderr?.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) console.warn("[sunflower-free:sidecar]", line.slice(0, 400));
    });
    if (!child.stdout) {
      fail();
      return;
    }
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          typeof parsed.url === "string" &&
          typeof parsed.port === "number" &&
          typeof parsed.key === "string"
        ) {
          clearTimeout(timer);
          resolve(parsed);
        }
      } catch {
        /* keep reading */
      }
    });
  });

  if (!info) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return undefined;
  }

  return {
    url: info.url,
    key: info.key,
    port: info.port,
    async stop() {
      child.kill();
    },
  };
}

function emptyPlugin(why) {
  console.warn(`[sunflower-free] ${why}; 免费车道不进目录`);
  return {
    id: "xrk-sunflower-free",
    kind: "llm",
    llmBrands: [],
    async dispose() {},
  };
}

function pickDefaultSelection(openCodeIds, kiloModels, kiloBrandId) {
  if (openCodeIds.includes(SUNFLOWER_DEFAULT_MODEL)) {
    return { provider: SUNFLOWER_BRAND_ID, model: SUNFLOWER_DEFAULT_MODEL };
  }
  if (openCodeIds[0]) {
    return { provider: SUNFLOWER_BRAND_ID, model: openCodeIds[0] };
  }
  const kiloId =
    kiloModels.find((m) => m.id === "kilo-auto/free")?.id ?? kiloModels[0]?.id;
  if (kiloId) {
    return { provider: kiloBrandId, model: kiloId };
  }
  return undefined;
}

/**
 * @returns {Promise<{
 *   id: string;
 *   kind: "llm";
 *   llmBrands: object[];
 *   defaultSelection?: { provider: string; model: string };
 *   dispose(): Promise<void>;
 * }>}
 */
export async function createPlugin(options = {}) {
  if (options.disabled) return emptyPlugin("disabled by option");

  const kiloFetch = options.fetchKiloFreeCatalog ?? fetchKiloFreeCatalog;
  const kiloModels =
    options.skipKilo === true
      ? []
      : await kiloFetch(options.kilo ?? {}).catch(() => []);

  // OFM: Bun only for OpenCode inference. Kilo never spawns / needs Bun.
  const override = options.sidecar?.bunBinary;
  const bunBinary =
    typeof override === "string" && override.trim()
      ? existsSync(override.trim())
        ? override.trim()
        : undefined
      : resolveBunBinary(process.env);
  const wantOpenCode = options.skipOpenCode !== true;

  /** @type {Awaited<ReturnType<typeof spawnSidecar>> | undefined} */
  let handle;
  /** @type {string[]} */
  let openCodeIds = [];

  if (bunBinary && wantOpenCode) {
    handle = await spawnSidecar({
      ...options.sidecar,
      bunBinary,
      // OpenCode-only sidecar — Kilo stays Host → api.kilo.ai (OFM egress.js).
      kiloModelIds: [],
    });
    if (handle && !(await sidecarHealthy(handle))) {
      console.warn("[sunflower-free] OpenCode sidecar unhealthy — omit OpenCode");
      await handle.stop().catch(() => {});
      handle = undefined;
    }
  }

  /**
   * OpenCode 探测级联（先直连，失败再用候选代理）。
   * Host 听口优先：默认不在 createPlugin 里 await；听口后的 warmup /
   * Settings 重挂可设 `awaitProbe` / `XRK_SUNFLOWER_AWAIT_PROBE=1`。
   */
  /** @type {Promise<void> | undefined} */
  let backgroundProbe;

  if (wantOpenCode && handle) {
    const probe = options.probeUsableModels ?? probeUsableModels;
    const useCache =
      probe === probeUsableModels && options.skipProbeCache !== true;
    const awaitProbe =
      options.awaitProbe === true ||
      process.env.XRK_SUNFLOWER_AWAIT_PROBE === "1";

    const runCascade = () =>
      probeOpenCodeCascade(handle, FREE_MODELS, probe);

    const latest = useCache ? readLatestProbeCacheEntry() : undefined;

    if (awaitProbe) {
      // Settings remount clears cache first → cold cascade here.
      // Listen-after warmup: reuse fresh cache so restart does not burn quota.
      if (latest && !latest.stale) {
        openCodeIds = latest.usable;
        await applyCachedEgress(handle, latest.egress).catch(() => {});
        console.info(
          `[sunflower-free] OpenCode verdict from cache (${Math.round((Date.now() - latest.at) / 1000)}s old, egress=${latest.egress}) — ${openCodeIds.length}/${FREE_MODELS.length} usable, awaitProbe skipped cascade`,
        );
      } else {
        try {
          const result = await runCascade();
          openCodeIds = result.usable;
        } catch (error) {
          console.warn(
            `[sunflower-free] OpenCode cascade failed (${error?.message ?? error}); omit OpenCode rows`,
          );
          openCodeIds = [];
        }
      }
    } else if (latest && !latest.stale) {
      openCodeIds = latest.usable;
      await applyCachedEgress(handle, latest.egress).catch(() => {});
      console.info(
        `[sunflower-free] OpenCode verdict from cache (${Math.round((Date.now() - latest.at) / 1000)}s old, egress=${latest.egress}) — ${openCodeIds.length}/${FREE_MODELS.length} usable, 0 request`,
      );
    } else if (latest) {
      openCodeIds = latest.usable;
      await applyCachedEgress(handle, latest.egress).catch(() => {});
      console.info(
        `[sunflower-free] OpenCode verdict is stale (${Math.round((Date.now() - latest.at) / 60_000)}min old, egress=${latest.egress}) — mounted ${openCodeIds.length} model(s) now, cascade in background`,
      );
      backgroundProbe = (async () => {
        try {
          const next = await runCascade();
          if (next.usable.length !== latest.usable.length) {
            console.info(
              `[sunflower-free] background cascade ${latest.usable.length} → ${next.usable.length} usable (egress=${next.egress}) — save Settings or remount to refresh catalog`,
            );
          }
        } catch {
          /* 留旧结论 */
        }
      })();
    } else {
      // 冷启动：不挡听口；听口后的 warmup 应带 awaitProbe。此处 background，
      // 目录先只有 Kilo（若有），级联结束后下次启动 / remount 进 OpenCode。
      console.info(
        "[sunflower-free] OpenCode cold start — cascade in background (direct then proxy)",
      );
      backgroundProbe = (async () => {
        try {
          const next = await runCascade();
          if (next.usable.length > 0) {
            console.info(
              `[sunflower-free] background cascade ready — ${next.usable.length} usable via ${next.egress}; remount / next boot applies catalog`,
            );
          }
        } catch (error) {
          console.warn(
            `[sunflower-free] background cascade failed (${error?.message ?? error})`,
          );
        }
      })();
      openCodeIds = [];
    }
  }

  // 后台还在校准时不能停 sidecar：探测还要用它。
  if (handle && openCodeIds.length === 0 && !backgroundProbe) {
    await handle.stop().catch(() => {});
    handle = undefined;
  }

  /** @type {object[]} */
  const llmBrands = [];

  if (handle && openCodeIds.length > 0) {
    const openCodeModels = openCodeIds.map((id) => openCodeCatalogEntry(id));
    llmBrands.push({
      id: SUNFLOWER_BRAND_ID,
      displayName: SUNFLOWER_DISPLAY_NAME,
      protocol: "openai-chat",
      baseUrl: handle.url,
      path: "/chat/completions",
      authMode: "bearer",
      apiKeyEnv: SUNFLOWER_KEY_ENV,
      defaultModel: openCodeModels[0].id,
      models: openCodeModels,
      autoCatalog: true,
      notes: "向日葵免费 · OpenCode（Bun sidecar，对齐 OFM）。",
    });
  }

  const kiloBrandId =
    llmBrands.length === 0 ? SUNFLOWER_BRAND_ID : SUNFLOWER_KILO_BRAND_ID;
  if (kiloModels.length > 0) {
    // Kilo-only: keep brand id `sunflower-free` so saved Settings still resolve.
    // Both lanes: second brand `sunflower-kilo` (OFM: no Bun).
    const kiloOnly = kiloBrandId === SUNFLOWER_BRAND_ID;
    llmBrands.push({
      id: kiloBrandId,
      displayName: kiloOnly
        ? SUNFLOWER_DISPLAY_NAME
        : SUNFLOWER_KILO_DISPLAY_NAME,
      protocol: "openai-chat",
      baseUrl: KILO_BASE,
      path: "/chat/completions",
      defaultModel: kiloModels[0].id,
      models: kiloModels,
      autoCatalog: true,
      notes: "向日葵免费 · Kilo（Host 直连，不绑 Bun）。",
    });
  }

  if (llmBrands.length === 0) {
    if (handle) await handle.stop().catch(() => {});
    return emptyPlugin("no usable free lanes on this Host");
  }

  const defaultSelection = pickDefaultSelection(
    openCodeIds,
    kiloModels,
    kiloBrandId,
  );

  if (handle) process.env[SUNFLOWER_KEY_ENV] = handle.key;
  else delete process.env[SUNFLOWER_KEY_ENV];

  console.info(
    `[sunflower-free] catalog opencode=${openCodeIds.length} kilo=${kiloModels.length}` +
      (handle ? " oc=sidecar" : " oc=off") +
      (kiloModels.length > 0 ? " kilo=direct" : ""),
  );

  return {
    id: "xrk-sunflower-free",
    kind: "llm",
    llmBrands,
    ...(defaultSelection ? { defaultSelection } : {}),
    async dispose() {
      delete process.env[SUNFLOWER_KEY_ENV];
      if (handle) await handle.stop().catch(() => {});
    },
  };
}
