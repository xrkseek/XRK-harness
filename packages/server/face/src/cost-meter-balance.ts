/**
 * DeepSeek official balance query — ported from MIT `dsh-cost-meter` host logic.
 * Uses the same credential path as `llm-deepseek` (settings + `.credentials.yaml`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export interface DeepSeekBalanceSnapshot {
  readonly status: "ok" | "err" | "off";
  readonly message: string;
  readonly fetchedAt: number;
  readonly currency: string;
  readonly totalBalance: number;
  readonly grantedBalance: number;
  readonly toppedUpBalance: number;
}

export function emptyDeepSeekBalance(
  status: DeepSeekBalanceSnapshot["status"] = "off",
  message = "",
): DeepSeekBalanceSnapshot {
  return {
    status,
    message,
    fetchedAt: 0,
    currency: "",
    totalBalance: 0,
    grantedBalance: 0,
    toppedUpBalance: 0,
  };
}

/** Pick balance_infos entry (dsh-cost-meter #24/#25 — CNY-first when multiple currencies). */
export function pickBalanceInfo(
  infos: unknown,
): Record<string, unknown> | undefined {
  const list = Array.isArray(infos)
    ? infos.filter(
        (entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === "object",
      )
    : [];
  const positive = list.filter((entry) => Number(entry.total_balance) > 0);
  const cnyFirst = (entries: typeof list) =>
    entries.find(
      (entry) => String(entry.currency).toUpperCase() === "CNY",
    );
  return cnyFirst(positive) ?? positive[0] ?? cnyFirst(list) ?? list[0];
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

function resolveDeepSeekApiKey(xrkHome: string): {
  readonly apiKey: string | null;
  readonly apiKeyEnv: string;
} {
  const settings = loadYamlRecord(path.join(xrkHome, "settings.yaml"));
  const section =
    settings["llm-deepseek"] &&
    typeof settings["llm-deepseek"] === "object" &&
    !Array.isArray(settings["llm-deepseek"])
      ? (settings["llm-deepseek"] as Record<string, unknown>)
      : {};
  const apiKeyEnv =
    typeof section.apiKeyEnv === "string" && section.apiKeyEnv.length > 0
      ? section.apiKeyEnv
      : "DEEPSEEK_API_KEY";

  const credentials = loadYamlRecord(path.join(xrkHome, ".credentials.yaml"));
  const fromFile = credentials[apiKeyEnv];
  if (typeof fromFile === "string" && fromFile.trim()) {
    return { apiKey: fromFile.trim(), apiKeyEnv };
  }
  const fromEnv = String(process.env[apiKeyEnv] ?? "").trim();
  if (fromEnv) return { apiKey: fromEnv, apiKeyEnv };
  return { apiKey: null, apiKeyEnv };
}

function resolveDeepSeekBaseUrl(xrkHome: string): string {
  const settings = loadYamlRecord(path.join(xrkHome, "settings.yaml"));
  const section =
    settings["llm-deepseek"] &&
    typeof settings["llm-deepseek"] === "object" &&
    !Array.isArray(settings["llm-deepseek"])
      ? (settings["llm-deepseek"] as Record<string, unknown>)
      : {};
  const fromSettings =
    typeof section.baseURL === "string" ? section.baseURL.trim() : "";
  if (fromSettings) return fromSettings;
  return String(process.env.DEEPSEEK_BASE_URL ?? "").trim() || "https://api.deepseek.com";
}

/** Official balance endpoint — only `api.deepseek.com` (same guard as dsh-cost-meter). */
export function deepSeekBalanceEndpoint(baseURL: string): string | null {
  let base = String(baseURL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (base.length === 0) base = "https://api.deepseek.com";
  if (/\/v\d+$/i.test(base)) base = base.replace(/\/v\d+$/i, "");
  let host: string;
  try {
    host = new URL(base).host.toLowerCase();
  } catch {
    return null;
  }
  if (host !== "api.deepseek.com") return null;
  return `${base}/user/balance`;
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

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function queryDeepSeekBalance(xrkHome: string): Promise<DeepSeekBalanceSnapshot> {
  const { apiKey, apiKeyEnv } = resolveDeepSeekApiKey(xrkHome);
  if (!apiKey) {
    return emptyDeepSeekBalance(
      "err",
      `API Key missing — configure ${apiKeyEnv} in Settings → Models or .credentials.yaml`,
    );
  }
  const endpoint = deepSeekBalanceEndpoint(resolveDeepSeekBaseUrl(xrkHome));
  if (!endpoint) {
    return emptyDeepSeekBalance(
      "err",
      "Balance endpoint must be api.deepseek.com (non-official baseURL rejected)",
    );
  }
  try {
    const response = await fetchWithTimeout(
      endpoint,
      { headers: { authorization: `Bearer ${apiKey}` } },
      15_000,
    );
    if (!response.ok) {
      return emptyDeepSeekBalance(
        "err",
        `Balance HTTP ${String(response.status)}`,
      );
    }
    const data = (await response.json()) as { balance_infos?: unknown };
    const info = pickBalanceInfo(data?.balance_infos);
    if (!info) {
      return emptyDeepSeekBalance("err", "balance_infos missing in response");
    }
    return {
      status: "ok",
      message: "",
      fetchedAt: Date.now(),
      currency: typeof info.currency === "string" ? info.currency : "",
      totalBalance: num(info.total_balance),
      grantedBalance: num(info.granted_balance),
      toppedUpBalance: num(info.topped_up_balance),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyDeepSeekBalance("err", message);
  }
}
