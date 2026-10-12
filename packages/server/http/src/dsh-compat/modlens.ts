/**
 * @liustack/modlens — Host routes matching the DSH browser card + paste-to-path.
 *
 * Client contract (@liustack/modlens ≥3.x):
 *   GET  /modlens/paste?model=… → `{ takeover: boolean }` (404 when paste off)
 *   POST /modlens/paste         → binary body → `{ path }` temp file under ~/.xrk
 *   POST /modlens/paste         → JSON `{ text }` → heuristic preview (bridge)
 *   GET  /modlens/config        → engineSummary (no secrets)
 *   GET  /modlens/config?discover=1 → + `discovery` reuse probes
 *   POST /modlens/config        → applyEngineSettings | `{ open: true }`
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBodyBuffer, rpcOk, sendJson } from "./underlying/http-json.js";
import { dataPath, ensureDir } from "./underlying/json-store.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

export interface ModlensOptions {
  readonly xrkHome?: string;
}

const ENGINES = [
  "antigravity-cli",
  "gemini-api",
  "openai",
  "anthropic",
  "claude-cli",
] as const;

type EngineId = (typeof ENGINES)[number];

const KEYLESS_ENGINES: readonly EngineId[] = ["antigravity-cli", "claude-cli"];

const ENGINE_ALIASES: Record<string, EngineId> = {
  antigravity: "antigravity-cli",
  agy: "antigravity-cli",
  gemini: "gemini-api",
  "openai-compat": "openai",
  claude: "anthropic",
  "claude-code": "claude-cli",
};

const REUSE_HARNESSES = ["claude", "codex", "opencode", "pi", "grok"] as const;

const ENGINE_ENV_BINDINGS: Partial<
  Record<EngineId, { apiKey: string; baseUrl: string }>
> = {
  "gemini-api": { apiKey: "GEMINI_API_KEY", baseUrl: "GEMINI_BASE_URL" },
  openai: { apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
  anthropic: { apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" },
};

interface EngineSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  proxy?: string;
}

interface ModlensFileConfig {
  provider?: string;
  providers?: Record<string, EngineSettings>;
  reuse?: Record<string, boolean>;
  pasteToPath?: boolean;
}

interface EnginePublic {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  proxyMode: "inherit" | "direct" | "custom";
  source: "" | "file" | "env";
}

interface DiscoveryProbe {
  harness: string;
  cliFound: boolean;
  loggedIn: boolean | null;
  cliPath: string;
}

function isEngineId(value: string): value is EngineId {
  return (ENGINES as readonly string[]).includes(value);
}

function canonicalEngine(name: unknown): string {
  if (typeof name !== "string") return "";
  const trimmed = name.trim().toLowerCase();
  if (isEngineId(trimmed)) return trimmed;
  return ENGINE_ALIASES[trimmed] ?? "";
}

function settingsKeysFor(engine: EngineId): string[] {
  const aliases = Object.keys(ENGINE_ALIASES).filter(
    (alias) => ENGINE_ALIASES[alias] === engine,
  );
  return [...aliases, engine];
}

function hasApiKeys(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value
      .split(",")
      .map((key) => key.trim())
      .some((key) => key !== "")
  );
}

function engineEnvSettings(
  engine: EngineId,
  env: NodeJS.ProcessEnv = process.env,
): EngineSettings {
  const settings: EngineSettings = {};
  for (const [field, variable] of Object.entries(
    ENGINE_ENV_BINDINGS[engine] ?? {},
  )) {
    const raw = env[variable];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value !== "" && (field !== "apiKey" || hasApiKeys(value))) {
      (settings as Record<string, string>)[field] = value;
    }
  }
  return settings;
}

function engineConfiguredInFile(
  engine: EngineId,
  config: ModlensFileConfig,
): boolean {
  return settingsKeysFor(engine).some(
    (key) => config.providers?.[key] !== undefined,
  );
}

/** Shared with the modlens CLI when not under a test `xrkHome`. */
function engineConfigPath(options: ModlensOptions): string {
  if (options.xrkHome?.trim()) {
    return path.join(options.xrkHome, "modlens", "engine-config.json");
  }
  return path.join(homedir(), ".modlens", "config.json");
}

function readModlensConfig(options: ModlensOptions): ModlensFileConfig {
  const file = engineConfigPath(options);
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as ModlensFileConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return {};
    throw error;
  }
}

function writeModlensConfig(
  options: ModlensOptions,
  config: ModlensFileConfig,
): void {
  const file = engineConfigPath(options);
  try {
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error(
        `${file} is a symlink; edit the file it points at instead`,
      );
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") throw error;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  // mode is best-effort on Windows (often ignored).
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function pasteToPathEnabled(config: ModlensFileConfig): boolean {
  return config.pasteToPath !== false;
}

function engineSummary(options: ModlensOptions): {
  provider: string;
  engines: Record<string, EnginePublic>;
  keyless: readonly string[];
  reuse: Record<string, boolean>;
  pasteToPath: boolean;
} {
  const config = readModlensConfig(options);
  const engines: Record<string, EnginePublic> = {};
  for (const name of ENGINES) {
    const inFile = engineConfiguredInFile(name, config);
    const settings = inFile
      ? Object.assign(
          {},
          ...settingsKeysFor(name).map((key) => config.providers?.[key] ?? {}),
        )
      : engineEnvSettings(name);
    const proxyField = (settings as EngineSettings).proxy;
    engines[name] = {
      baseUrl:
        typeof settings.baseUrl === "string" ? settings.baseUrl : "",
      model: typeof settings.model === "string" ? settings.model : "",
      hasKey: hasApiKeys(settings.apiKey),
      proxyMode: !Object.prototype.hasOwnProperty.call(settings, "proxy")
        ? "inherit"
        : typeof proxyField === "string" && proxyField.trim() === ""
          ? "direct"
          : "custom",
      source: inFile ? "file" : Object.keys(settings).length > 0 ? "env" : "",
    };
  }
  const reuse: Record<string, boolean> = {};
  for (const harness of REUSE_HARNESSES) {
    const granted = config.reuse?.[harness];
    reuse[harness] = typeof granted === "boolean" ? granted : harness === "claude";
  }
  return {
    provider: canonicalEngine(config.provider),
    engines,
    keyless: KEYLESS_ENGINES,
    reuse,
    pasteToPath: pasteToPathEnabled(config),
  };
}

function which(cmd: string): string | undefined {
  try {
    const exe = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(exe, [cmd], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    return first && existsSync(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

/** Heuristic reuse probes when the modlens CLI doctor is unavailable. */
function discoverReuseHeuristic(): DiscoveryProbe[] {
  return REUSE_HARNESSES.map((harness) => {
    const cliName = harness === "claude" ? "claude" : harness;
    const cliPath = which(cliName) ?? "";
    return {
      harness,
      cliFound: cliPath !== "",
      loggedIn: null,
      cliPath,
    };
  });
}

function applyEngineSettings(
  options: ModlensOptions,
  patch: Record<string, unknown>,
): void {
  const config = readModlensConfig(options);

  if (patch.provider !== undefined) {
    if (patch.provider === "") {
      delete config.provider;
    } else if (typeof patch.provider === "string" && isEngineId(patch.provider)) {
      config.provider = patch.provider;
    } else {
      throw new Error(`unknown engine: ${String(patch.provider)}`);
    }
  }

  const engine = patch.engine;
  if (engine !== undefined) {
    if (typeof engine !== "string" || !isEngineId(engine)) {
      throw new Error(`unknown engine: ${String(engine)}`);
    }
    config.providers = { ...config.providers };
    const holders = settingsKeysFor(engine).filter(
      (key) => config.providers![key] !== undefined,
    );
    const target = holders.length > 0 ? holders[holders.length - 1]! : engine;
    const seed = holders.length > 0 ? {} : engineEnvSettings(engine);
    const settings: EngineSettings = {
      ...seed,
      ...config.providers[target],
    };
    for (const field of ["baseUrl", "model"] as const) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      const value = typeof patch[field] === "string" ? patch[field].trim() : "";
      if (value === "") {
        delete settings[field];
      } else {
        settings[field] = value;
      }
    }
    const apiKey = typeof patch.apiKey === "string" ? patch.apiKey.trim() : "";
    if (apiKey !== "") {
      settings.apiKey = apiKey;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "proxyMode")) {
      if (patch.proxyMode === "inherit") {
        for (const holder of holders) {
          const stored = config.providers[holder];
          if (stored && typeof stored === "object") {
            delete stored.proxy;
          }
        }
        delete settings.proxy;
      } else if (patch.proxyMode === "direct") {
        settings.proxy = "";
      } else if (patch.proxyMode === "custom") {
        const proxy = typeof patch.proxy === "string" ? patch.proxy.trim() : "";
        if (proxy !== "") {
          settings.proxy = proxy;
        } else {
          const storedProxy = Object.assign(
            {},
            ...holders.map((key) => config.providers![key] ?? {}),
          ).proxy;
          if (typeof storedProxy !== "string" || storedProxy.trim() === "") {
            throw new Error("custom proxy mode needs a proxy URL");
          }
        }
      } else {
        throw new Error(`unknown proxy mode: ${String(patch.proxyMode)}`);
      }
    }
    config.providers[target] = settings;
  }

  if (patch.reuse !== null && typeof patch.reuse === "object") {
    config.reuse = { ...config.reuse };
    const reusePatch = patch.reuse as Record<string, unknown>;
    for (const harness of REUSE_HARNESSES) {
      const granted = reusePatch[harness];
      if (typeof granted === "boolean") {
        config.reuse[harness] = granted;
      }
    }
  }

  if (typeof patch.pasteToPath === "boolean") {
    config.pasteToPath = patch.pasteToPath;
  }

  writeModlensConfig(options, config);
}

function openConfigFile(options: ModlensOptions): void {
  const file = engineConfigPath(options);
  try {
    lstatSync(file);
  } catch {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{}\n", { mode: 0o600 });
  }
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

/** Heuristic paste preview — text JSON path (not binary image upload). */
export function parseModlensPastePreview(
  text: string,
): Array<{ kind: string; value: string }> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const items: Array<{ kind: string; value: string }> = [];
  const seen = new Set<string>();

  for (const match of trimmed.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const value = match[0];
    if (seen.has(value)) continue;
    seen.add(value);
    items.push({ kind: "url", value });
  }

  for (const id of REUSE_HARNESSES) {
    if (new RegExp(`\\b${id}\\b`, "i").test(trimmed)) {
      items.push({ kind: "engine", value: id });
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1) {
    items.push({ kind: "lines", value: String(lines.length) });
  }

  const modelLike = trimmed.match(
    /\b(gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|deepseek-[\w.-]+)\b/gi,
  );
  if (modelLike) {
    for (const value of modelLike) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "model", value });
    }
  }

  return items;
}

function extensionFor(contentType: string | undefined, bytes: Buffer): string {
  const ct = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (ct === "image/png" || bytes[0] === 0x89) return "png";
  if (ct === "image/jpeg" || ct === "image/jpg" || bytes[0] === 0xff) return "jpg";
  if (ct === "image/gif" || bytes[0] === 0x47) return "gif";
  if (ct === "image/webp") return "webp";
  if (ct === "image/bmp") return "bmp";
  return "bin";
}

function storePasteBytes(
  options: ModlensOptions,
  bytes: Buffer,
  contentType: string | undefined,
): { path: string } {
  const dir = dataPath(options.xrkHome, "modlens", "pastes");
  ensureDir(dir);
  const name = `${randomUUID()}.${extensionFor(contentType, bytes)}`;
  const filePath = path.join(dir, name);
  writeFileSync(filePath, bytes);
  return { path: filePath };
}

function looksLikeJson(bytes: Buffer): boolean {
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i]!;
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    return c === 0x7b /* { */ || c === 0x5b /* [ */;
  }
  return false;
}

/** Cordis RPC channel `/modlens` (POST `/modlens/config` · `/modlens/paste`). */
export function handleModlensRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  options: ModlensOptions,
): Record<string, unknown> {
  if (
    endpoint === "config" ||
    endpoint === "get" ||
    endpoint === "describe" ||
    endpoint === ""
  ) {
    const summary = engineSummary(options);
    const discover =
      payload.discover === true || payload.discover === 1;
    return {
      ...summary,
      ...(discover ? { discovery: discoverReuseHeuristic() } : {}),
      adapter: DSH_COMPAT_ADAPTER,
    };
  }
  if (endpoint === "set" || endpoint === "apply" || endpoint === "patch") {
    if (payload.open === true) {
      openConfigFile(options);
      return { opened: true, adapter: DSH_COMPAT_ADAPTER };
    }
    applyEngineSettings(options, payload);
    return { ...engineSummary(options), adapter: DSH_COMPAT_ADAPTER };
  }
  if (endpoint === "paste") {
    const text =
      typeof payload.text === "string"
        ? payload.text
        : typeof payload.content === "string"
          ? payload.content
          : typeof payload.paste === "string"
            ? payload.paste
            : "";
    const items = parseModlensPastePreview(text);
    const summary = engineSummary(options);
    return tag(
      {
        ok: true,
        provider: summary.provider,
        engines: summary.engines,
        reuse: summary.reuse,
        items,
        discovery: discoverReuseHeuristic(),
        preview: true,
        adapter: DSH_COMPAT_ADAPTER,
        note: items.length
          ? "Heuristic paste preview via XRK bridge."
          : "Empty paste — no preview items.",
      },
      ["modlens-host"],
    );
  }
  return {
    ...engineSummary(options),
    endpoint,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export async function handleModlensHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ModlensOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/modlens")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const endpoint = pathname.replace(/^\/modlens\/?/, "") || "config";
  const config = readModlensConfig(options);

  // GET /modlens/paste?model=… — takeover verdict (@liustack/modlens client).
  if (method === "GET" && (endpoint === "paste" || endpoint.startsWith("paste"))) {
    if (!pasteToPathEnabled(config)) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "pasteToPath disabled", takeover: false }));
      return true;
    }
    sendJson(res, 200, {
      takeover: true,
      pasteToPath: true,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (
    method === "GET" &&
    (endpoint === "config" || endpoint.startsWith("config"))
  ) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const summary = engineSummary(options);
      if (url.searchParams.has("discover")) {
        (summary as { discovery?: DiscoveryProbe[] }).discovery =
          discoverReuseHeuristic();
      }
      sendJson(res, 200, summary);
    } catch (error) {
      sendJson(res, 409, {
        error: String((error as Error)?.message ?? error),
      });
    }
    return true;
  }

  if (method === "POST" || method === "PUT") {
    const contentType = req.headers["content-type"];
    const raw = await readBodyBuffer(req);

    // Binary image upload → durable path for the composer.
    if (
      (endpoint === "paste" || endpoint.startsWith("paste")) &&
      raw.byteLength > 0 &&
      !looksLikeJson(raw)
    ) {
      if (!pasteToPathEnabled(config)) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "pasteToPath disabled" }));
        return true;
      }
      const stored = storePasteBytes(options, raw, contentType);
      sendJson(res, 200, {
        ok: true,
        path: stored.path,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      body = {};
    }
    if (typeof body.rpcId === "string") {
      const rpcMethod =
        typeof body.method === "string" ? body.method : endpoint;
      const payload =
        body.payload && typeof body.payload === "object"
          ? (body.payload as Record<string, unknown>)
          : {};
      try {
        sendJson(
          res,
          200,
          rpcOk(body.rpcId, handleModlensRpc(rpcMethod, payload, options)),
        );
      } catch (error) {
        sendJson(res, 409, {
          error: String((error as Error)?.message ?? error),
        });
      }
      return true;
    }

    if (endpoint === "config" || endpoint.startsWith("config")) {
      try {
        if (body.open === true) {
          openConfigFile(options);
          sendJson(res, 200, { opened: true });
          return true;
        }
        applyEngineSettings(options, body);
        sendJson(res, 200, engineSummary(options));
      } catch (error) {
        sendJson(res, 409, {
          error: String((error as Error)?.message ?? error),
        });
      }
      return true;
    }

    sendJson(res, 200, handleModlensRpc(endpoint, body, options));
    return true;
  }

  sendJson(res, 200, engineSummary(options));
  return true;
}

export function isModlensPath(pathname: string): boolean {
  return pathname.startsWith("/modlens");
}
