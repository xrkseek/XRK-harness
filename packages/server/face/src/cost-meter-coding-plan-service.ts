/**
 * Coding plan refresh orchestration for Face cost-meter (keys + SCNet local estimate).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  CODING_PLAN_PROVIDER_IDS,
  CODING_PLAN_PROVIDERS,
  queryCodingPlan,
  scnetTokenPlanWindows,
} from "./cost-meter-coding-plans.js";
import type { CostMeterDay } from "./cost-meter-store.js";

export interface CodingPlanSnapshot {
  readonly status: "ok" | "err" | "off" | "error";
  readonly message: string;
  readonly fetchedAt: number;
  readonly windows: Record<string, unknown>;
}

export function emptyCodingPlanSnapshot(
  status: CodingPlanSnapshot["status"] = "off",
  message = "",
): CodingPlanSnapshot {
  return { status, message, fetchedAt: 0, windows: {} };
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

function findAnthropicOAuthToken(): string | null {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return null;
  try {
    const data = JSON.parse(
      readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8"),
    ) as { claudeAiOauth?: { accessToken?: string } };
    const token = data?.claudeAiOauth?.accessToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function codingPlansRecord(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const plans = config.codingPlans;
  if (!plans || typeof plans !== "object" || Array.isArray(plans)) return {};
  return plans as Record<string, unknown>;
}

export function resolveCodingPlanKey(
  xrkHome: string,
  provider: string,
  config: Record<string, unknown>,
): string | null {
  const plans = codingPlansRecord(config);
  const row = plans[provider];
  const section =
    row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};
  const explicit = String(section.apiKey ?? "").trim();
  if (explicit) return explicit;

  const meta = CODING_PLAN_PROVIDERS[
    provider as keyof typeof CODING_PLAN_PROVIDERS
  ];
  const credentials = loadYamlRecord(path.join(xrkHome, ".credentials.yaml"));
  for (const name of meta?.credentialEnvs ?? []) {
    const fromFile = credentials[name];
    if (typeof fromFile === "string" && fromFile.trim()) return fromFile.trim();
    const fromEnv = String(process.env[name] ?? "").trim();
    if (fromEnv) return fromEnv;
  }
  if (provider === "anthropic") return findAnthropicOAuthToken();
  return null;
}

export function codingPlanConfigOf(
  config: Record<string, unknown>,
  provider: string,
): Record<string, unknown> {
  const base = {
    enabled: false,
    display: "settings",
    refreshMinutes: 15,
    apiKey: "",
  };
  const plans = codingPlansRecord(config);
  const row = plans[provider];
  if (!row || typeof row !== "object" || Array.isArray(row)) return base;
  return { ...base, ...(row as Record<string, unknown>) };
}

function ledgerDaysMap(history: readonly CostMeterDay[]): Record<string, CostMeterDay> {
  const out: Record<string, CostMeterDay> = {};
  for (const day of history) out[day.date] = day;
  return out;
}

function tmsg(
  _locale: string,
  code: string,
  vars: Record<string, string> = {},
): string {
  const table: Record<string, string> = {
    codingPlanUnknown: `unknown coding plan provider: ${vars.provider ?? ""}`,
    codingPlanKeyMissing: `${vars.provider ?? "provider"} API key missing`,
    codingPlanUnauthorized: `${vars.provider ?? "provider"} unauthorized (${vars.code ?? ""})`,
    codingPlanHttp: `${vars.provider ?? "provider"} HTTP ${vars.code ?? ""} (${vars.url ?? ""})`,
    codingPlanNoUsage: `${vars.provider ?? "provider"} usage unavailable`,
    scnetPlanCreditsInvalid: "SCNet planCredits invalid",
  };
  return table[code] ?? code;
}

export async function refreshCodingPlanProvider(
  xrkHome: string,
  config: Record<string, unknown>,
  history: readonly CostMeterDay[],
  provider: string,
): Promise<CodingPlanSnapshot> {
  if (!CODING_PLAN_PROVIDER_IDS.includes(provider)) {
    return emptyCodingPlanSnapshot("err", `unknown provider: ${provider}`);
  }
  const planCfg = codingPlanConfigOf(config, provider);
  if (planCfg.enabled !== true) {
    return emptyCodingPlanSnapshot("off", "coding plan disabled");
  }
  if (planCfg.display === "off") {
    return emptyCodingPlanSnapshot("off", "coding plan display is off");
  }

  if (provider === "scnet") {
    const result = scnetTokenPlanWindows(
      ledgerDaysMap(history),
      planCfg,
      Date.now(),
    );
    if (!result) {
      return emptyCodingPlanSnapshot(
        "off",
        tmsg("zh", "scnetPlanCreditsInvalid"),
      );
    }
    return {
      status: "ok",
      message: "",
      fetchedAt: Date.now(),
      windows: result.windows,
    };
  }

  const locale =
    typeof config.locale === "string" && config.locale.startsWith("en")
      ? "en"
      : "zh";
  const key = resolveCodingPlanKey(xrkHome, provider, config);
  try {
    const result = await queryCodingPlan(provider, key, locale, tmsg);
    return {
      status: "ok",
      message: "",
      fetchedAt: Date.now(),
      windows: (result.windows ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const soft = Boolean(
      err && typeof err === "object" && (err as { soft?: boolean }).soft,
    );
    return emptyCodingPlanSnapshot(soft ? "off" : "error", message);
  }
}

export function mergedCodingPlansState(
  config: Record<string, unknown>,
  cache: Record<string, CodingPlanSnapshot> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of CODING_PLAN_PROVIDER_IDS) {
    const cfg = codingPlanConfigOf(config, id);
    const cached = cache?.[id] ?? emptyCodingPlanSnapshot();
    out[id] = {
      enabled: cfg.enabled === true,
      display: typeof cfg.display === "string" ? cfg.display : "settings",
      refreshMinutes:
        typeof cfg.refreshMinutes === "number" && cfg.refreshMinutes > 0
          ? cfg.refreshMinutes
          : 15,
      apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
      status: cached.status,
      message: cached.message,
      fetchedAt: cached.fetchedAt,
      windows: cached.windows,
    };
  }
  return out;
}
