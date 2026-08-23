/**
 * OpenCode Go subscription quota — ported from MIT `dsh-cost-meter` host logic.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export interface GoQuotaWindow {
  readonly percent: number;
  readonly resetsAt: string;
}

export interface GoQuotaSnapshot {
  readonly status: "ok" | "err" | "off";
  readonly message: string;
  readonly fetchedAt: number;
  readonly rolling: GoQuotaWindow | null;
  readonly weekly: GoQuotaWindow | null;
  readonly monthly: GoQuotaWindow | null;
}

const GO_QUOTA_URL = "https://opencode.ai/zen/go/v1/usage";
const GO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export function emptyGoQuotaSnapshot(
  status: GoQuotaSnapshot["status"] = "off",
  message = "",
): GoQuotaSnapshot {
  return {
    status,
    message,
    fetchedAt: 0,
    rolling: null,
    weekly: null,
    monthly: null,
  };
}

function loadYamlRecord(file: string): Record<string, unknown> {
  try {
    const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* absent */
  }
  return {};
}

function findGoKeyInAuthJson(): string | null {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    home ? path.join(home, ".local", "share", "opencode", "auth.json") : "",
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "opencode", "auth.json")
      : "",
    home ? path.join(home, ".config", "opencode", "auth.json") : "",
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >;
      const bucket = data["opencode-go"];
      if (bucket && typeof bucket === "object" && !Array.isArray(bucket)) {
        const key = (bucket as { key?: unknown }).key;
        if (typeof key === "string" && key.length > 0) return key;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function resolveGoApiKey(
  xrkHome: string,
  explicitApiKey?: string,
): string | null {
  const explicit = String(explicitApiKey ?? "").trim();
  if (explicit) return explicit;

  const credentials = loadYamlRecord(path.join(xrkHome, ".credentials.yaml"));
  for (const name of ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"]) {
    const fromFile = credentials[name];
    if (typeof fromFile === "string" && fromFile.trim()) {
      return fromFile.trim();
    }
    const fromEnv = String(process.env[name] ?? "").trim();
    if (fromEnv) return fromEnv;
  }
  return findGoKeyInAuthJson();
}

function normalizeGoWindow(raw: unknown): GoQuotaWindow | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const percent = Number((raw as { percent?: unknown }).percent);
  if (!Number.isFinite(percent)) return null;
  const resetsAt = (raw as { resetsAt?: unknown }).resetsAt;
  return {
    percent,
    resetsAt: typeof resetsAt === "string" ? resetsAt : "",
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function queryGoQuota(
  xrkHome: string,
  options?: { readonly apiKey?: string },
): Promise<GoQuotaSnapshot> {
  const key = resolveGoApiKey(xrkHome, options?.apiKey);
  if (!key) {
    return emptyGoQuotaSnapshot(
      "err",
      "OpenCode Go API key missing — set OPENCODE_GO_API_KEY in credentials or opencode auth.json",
    );
  }
  try {
    const response = await fetchWithTimeout(
      GO_QUOTA_URL,
      {
        headers: {
          authorization: `Bearer ${key}`,
          "user-agent": GO_UA,
        },
      },
      15_000,
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return emptyGoQuotaSnapshot(
          "err",
          `OpenCode Go subscription unavailable (HTTP ${String(response.status)})`,
        );
      }
      return emptyGoQuotaSnapshot(
        "err",
        `OpenCode Go HTTP ${String(response.status)}`,
      );
    }
    const data = (await response.json()) as { usage?: unknown };
    const usage = data?.usage;
    if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
      return emptyGoQuotaSnapshot("err", "usage missing in OpenCode Go response");
    }
    const row = usage as Record<string, unknown>;
    return {
      status: "ok",
      message: "",
      fetchedAt: Date.now(),
      rolling: normalizeGoWindow(row.rolling),
      weekly: normalizeGoWindow(row.weekly),
      monthly: normalizeGoWindow(row.monthly),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyGoQuotaSnapshot("err", message);
  }
}

/** Read explicit goQuota.apiKey from cost-meter ledger config when present. */
export function goQuotaApiKeyFromLedgerConfig(
  config: Record<string, unknown>,
): string | undefined {
  const goQuota = config.goQuota;
  if (!goQuota || typeof goQuota !== "object" || Array.isArray(goQuota)) {
    return undefined;
  }
  const apiKey = (goQuota as { apiKey?: unknown }).apiKey;
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : undefined;
}
