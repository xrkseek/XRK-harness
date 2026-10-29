/**
 * 向日葵免费 — `kind: "llm"` 入口。
 *
 * 一条 brand：`sunflower-free`。
 *   OpenCode：OFM 形轻量 ping，仅 `available` 进目录（额度用尽本机不显示）；
 *   Kilo：`isFree` listing（不探单模）；
 *   上游恒 `public`，不读用户密钥。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import {
  DEFAULT_FREE_MODEL,
  FREE_MODELS,
  openCodeCatalogEntry,
} from "./free-models.mjs";
import { fetchKiloFreeCatalog, KILO_BASE } from "./kilo.mjs";
import { probeUsableModels } from "./probe.mjs";

export const SUNFLOWER_BRAND_ID = "sunflower-free";
export const SUNFLOWER_DISPLAY_NAME = "向日葵免费";
export const SUNFLOWER_DEFAULT_MODEL = DEFAULT_FREE_MODEL;
export const SUNFLOWER_MODELS = FREE_MODELS;
/** Sidecar ↔ Host 一次性 key（进程内，不落盘）。 */
export const SUNFLOWER_KEY_ENV = "XRK_SUNFLOWER_SIDECAR_KEY";

export { KILO_BASE, fetchKiloFreeCatalog } from "./kilo.mjs";

/** Bun：显式 env → vendor → npm 全局 → PATH 旁路。 */
export function resolveBunBinary(env = process.env, here = import.meta.dirname) {
  const explicit = env.XRK_SUNFLOWER_BUN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : undefined;

  for (const name of ["bun.exe", "bun"]) {
    const vendored = path.join(here, "vendor", name);
    if (existsSync(vendored)) return vendored;
  }

  const appData = env.APPDATA?.trim();
  if (process.platform === "win32" && appData) {
    const npmBin = path.join(
      appData,
      "npm",
      "node_modules",
      "bun",
      "bin",
      "bun.exe",
    );
    if (existsSync(npmBin)) return npmBin;
  }
  const execDir = path.dirname(process.execPath);
  for (const rel of [
    path.join("node_modules", "bun", "bin", "bun.exe"),
    path.join("..", "node_modules", "bun", "bin", "bun.exe"),
    path.join("node_modules", "bun", "bin", "bun"),
  ]) {
    const candidate = path.join(execDir, rel);
    if (existsSync(candidate)) return candidate;
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

/** Loopback health only — no upstream chat. */
export async function sidecarHealthy(handle, timeoutMs = 4000) {
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

function emptyPlugin(why) {
  console.warn(`[sunflower-free] ${why}; 免费车道不进目录`);
  return {
    id: "xrk-sunflower-free",
    kind: "llm",
    llmBrands: [],
    async dispose() {},
  };
}

function pickDefaultModel(openCodeIds, kiloModels, catalogModels) {
  if (openCodeIds.includes(SUNFLOWER_DEFAULT_MODEL)) {
    return SUNFLOWER_DEFAULT_MODEL;
  }
  if (openCodeIds[0]) return openCodeIds[0];
  const kiloPrefer =
    kiloModels.find((m) => m.id === "kilo-auto/free")?.id ?? kiloModels[0]?.id;
  return kiloPrefer ?? catalogModels[0].id;
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

  const wantOpenCode = options.skipOpenCode !== true;
  const wantSidecar = wantOpenCode || kiloModels.length > 0;

  /** @type {Awaited<ReturnType<typeof spawnSidecar>> | undefined} */
  let handle;
  /** @type {string[]} */
  let openCodeIds = [];

  if (wantSidecar) {
    handle = await spawnSidecar({
      ...options.sidecar,
      kiloModelIds: kiloModels.map((m) => m.id),
      kiloBase: KILO_BASE,
    });
  }

  if (wantOpenCode) {
    if (handle && (await sidecarHealthy(handle))) {
      const probe =
        options.probeUsableModels ?? probeUsableModels;
      try {
        openCodeIds = await probe(handle, FREE_MODELS);
      } catch (error) {
        console.warn(
          `[sunflower-free] OpenCode probe failed (${error?.message ?? error}); omit OpenCode rows`,
        );
        openCodeIds = [];
      }
      if (openCodeIds.length === 0) {
        console.warn(
          "[sunflower-free] OpenCode free pool: no usable models on this Host",
        );
      }
    } else if (handle) {
      console.warn("[sunflower-free] OpenCode sidecar unhealthy");
      if (kiloModels.length === 0) {
        await handle.stop().catch(() => {});
        handle = undefined;
      }
    } else {
      console.warn("[sunflower-free] OpenCode sidecar unavailable (no bun?)");
    }
  } else if (handle && !(await sidecarHealthy(handle))) {
    await handle.stop().catch(() => {});
    handle = undefined;
  }

  const catalogModels = [
    ...openCodeIds.map((id) => openCodeCatalogEntry(id)),
    ...kiloModels,
  ];

  if (catalogModels.length === 0) {
    if (handle) await handle.stop().catch(() => {});
    return emptyPlugin("no usable free lanes on this Host");
  }

  const defaultModel = pickDefaultModel(
    openCodeIds,
    kiloModels,
    catalogModels,
  );

  /** @type {object} */
  const brand = handle
    ? {
        id: SUNFLOWER_BRAND_ID,
        displayName: SUNFLOWER_DISPLAY_NAME,
        protocol: "openai-chat",
        baseUrl: handle.url,
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: SUNFLOWER_KEY_ENV,
        defaultModel,
        models: catalogModels,
        autoCatalog: true,
        notes:
          "向日葵免费：OpenCode 本机可用项 + Kilo listing（上游 public）。",
      }
    : {
        id: SUNFLOWER_BRAND_ID,
        displayName: SUNFLOWER_DISPLAY_NAME,
        protocol: "openai-chat",
        baseUrl: KILO_BASE,
        path: "/chat/completions",
        defaultModel,
        models: catalogModels,
        autoCatalog: true,
        notes: "向日葵免费（无 Bun，仅 Kilo 直连）。",
      };

  if (handle) process.env[SUNFLOWER_KEY_ENV] = handle.key;

  console.info(
    `[sunflower-free] catalog opencode=${openCodeIds.length} kilo=${kiloModels.length}`,
  );

  return {
    id: "xrk-sunflower-free",
    kind: "llm",
    llmBrands: [brand],
    defaultSelection: { provider: SUNFLOWER_BRAND_ID, model: defaultModel },
    async dispose() {
      delete process.env[SUNFLOWER_KEY_ENV];
      if (handle) await handle.stop().catch(() => {});
    },
  };
}
