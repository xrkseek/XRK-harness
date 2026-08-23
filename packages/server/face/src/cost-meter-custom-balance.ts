/**
 * Custom provider balance query — ported from MIT `dsh-cost-meter/lib/custom-balance.js`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export interface CustomBalanceSnapshot {
  readonly status: "ok" | "err" | "off";
  readonly message: string;
  readonly fetchedAt: number;
  readonly label: string;
  readonly unit: string;
  readonly remaining: number;
  readonly maxBudget: number | null;
  readonly spend: number | null;
}

export function emptyCustomBalanceSnapshot(
  status: CustomBalanceSnapshot["status"] = "off",
  message = "",
): CustomBalanceSnapshot {
  return {
    status,
    message,
    fetchedAt: 0,
    label: "",
    unit: "USD",
    remaining: 0,
    maxBudget: null,
    spend: null,
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

function getPath(root: unknown, dotPath: string): unknown {
  if (!dotPath) return undefined;
  let current: unknown = root;
  for (const segment of dotPath.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Declarative extract rules (dot path, add/subtract/divide). */
export function extractByRule(data: unknown, rule: unknown): unknown {
  if (rule === null || rule === undefined) return null;
  if (typeof rule === "number" && Number.isFinite(rule)) return rule;
  if (typeof rule === "string") {
    const value = getPath(data, rule);
    const num = Number(value);
    if (Number.isFinite(num)) return num;
    return typeof value === "string" ? value : null;
  }
  if (typeof rule === "object" && !Array.isArray(rule)) {
    const row = rule as Record<string, unknown>;
    const op = row.op;
    if (op === "subtract" && Array.isArray(row.paths)) {
      if (row.paths.length === 0) return null;
      const values = row.paths.map((p) => Number(getPath(data, String(p))));
      if (!values.every(Number.isFinite)) return null;
      return values.reduce((acc, value) => acc - value);
    }
    if (op === "add" && Array.isArray(row.paths)) {
      const values = row.paths.map((p) => Number(getPath(data, String(p))));
      if (!values.every(Number.isFinite)) return null;
      return values.reduce((acc, value) => acc + value, 0);
    }
    if (op === "divide" && typeof row.path === "string") {
      const value = Number(getPath(data, row.path));
      const by = Number(row.by);
      if (!Number.isFinite(value) || !Number.isFinite(by) || by === 0) {
        return null;
      }
      return value / by;
    }
    if (typeof row.path === "string") return extractByRule(data, row.path);
  }
  return null;
}

function resolveCredentialRef(xrkHome: string, name: string): string {
  const credentials = loadYamlRecord(path.join(xrkHome, ".credentials.yaml"));
  const fromFile = credentials[name];
  if (typeof fromFile === "string" && fromFile.trim()) return fromFile.trim();
  return String(process.env[name] ?? "").trim();
}

function resolveTemplateString(xrkHome: string, value: string): string {
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  let out = value;
  for (const match of value.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    const resolved = resolveCredentialRef(xrkHome, name);
    out = out.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "g"), resolved);
  }
  return out;
}

function resolveHeaders(
  xrkHome: string,
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== "string") continue;
    out[key] = resolveTemplateString(xrkHome, value);
  }
  return out;
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

export async function queryCustomBalance(
  xrkHome: string,
  config: Record<string, unknown>,
): Promise<CustomBalanceSnapshot> {
  const custom = config.customBalance;
  if (
    !custom ||
    typeof custom !== "object" ||
    Array.isArray(custom) ||
    (custom as { enabled?: unknown }).enabled !== true
  ) {
    return emptyCustomBalanceSnapshot("off", "custom balance disabled");
  }
  const customRow = custom as Record<string, unknown>;
  const request = customRow.request;
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    typeof (request as { url?: unknown }).url !== "string" ||
    !(request as { url: string }).url.trim()
  ) {
    return emptyCustomBalanceSnapshot(
      "err",
      "customBalance.request.url is required",
    );
  }
  const req = request as Record<string, unknown>;
  const url = resolveTemplateString(xrkHome, String(req.url));
  const method =
    typeof req.method === "string" ? req.method.toUpperCase() : "GET";
  const headers = resolveHeaders(
    xrkHome,
    (req.headers as Record<string, unknown> | undefined) ?? {},
  );
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && req.body !== undefined) {
    init.body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!headers["content-type"] && !headers["Content-Type"]) {
      init.headers = { ...headers, "content-type": "application/json" };
    }
  }
  try {
    const response = await fetchWithTimeout(url, init, 15_000);
    if (!response.ok) {
      return emptyCustomBalanceSnapshot(
        "err",
        `custom balance HTTP ${String(response.status)}`,
      );
    }
    const data = await response.json();
    const extract =
      customRow.extract &&
      typeof customRow.extract === "object" &&
      !Array.isArray(customRow.extract)
        ? (customRow.extract as Record<string, unknown>)
        : {};
    const remaining = extractByRule(data, extract.remaining);
    if (!Number.isFinite(Number(remaining))) {
      return emptyCustomBalanceSnapshot(
        "err",
        "custom balance extract.remaining is missing or not numeric",
      );
    }
    const maxBudget =
      extract.maxBudget !== undefined
        ? extractByRule(data, extract.maxBudget)
        : null;
    const spend =
      extract.spend !== undefined ? extractByRule(data, extract.spend) : null;
    const unit =
      typeof customRow.unit === "string" && customRow.unit.length > 0
        ? customRow.unit
        : typeof extract.unit === "string" && extract.unit.length > 0
          ? extract.unit
          : "USD";
    return {
      status: "ok",
      message: "",
      fetchedAt: Date.now(),
      label:
        typeof customRow.label === "string" && customRow.label.length > 0
          ? customRow.label
          : "Custom",
      unit,
      remaining: Number(remaining),
      maxBudget: Number.isFinite(Number(maxBudget)) ? Number(maxBudget) : null,
      spend: Number.isFinite(Number(spend)) ? Number(spend) : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyCustomBalanceSnapshot("err", message);
  }
}
