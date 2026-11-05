/**
 * BrowserSession backed by Vercel Labs `agent-browser` CLI
 * (AX tree refs + click/type/scroll/press; Desktop Host ships the binary).
 *
 * Config (CLI precedence): flags > `AGENT_BROWSER_*` env > `~/.agent-browser/config.json`
 * > `./agent-browser.json`. Harness also accepts `XRK_AGENT_BROWSER` for the binary.
 * First run needs Chrome: `agent-browser install` (or system Chrome / `--executable-path`).
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  BrowserActResult,
  BrowserCookiesRequest,
  BrowserSession,
  BrowserSnapshotResult,
  BrowserTabsRequest,
  BrowserWaitRequest,
} from "./browser-session.js";
import { resolveAgentBrowserBin } from "./resolve-agent-browser.js";
import { WebError } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Which browser binary Settings pick when `executablePath` is empty.
 * - `auto`: system Edge/Chrome first (no download), then `agent-browser install` cache
 * - `edge` / `chrome`: prefer that family, then fall back like `auto`
 * - `bundled`: only `~/.agent-browser/browsers` (needs prior install / proxy)
 */
export type BrowserBinaryPreference = "auto" | "edge" | "chrome" | "bundled";

export interface AgentBrowserSessionOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override binary path (tests / packaged Host). */
  readonly bin?: string;
  /** Stable session key for CLI isolation (default: random). */
  readonly sessionName?: string;
  readonly timeoutMs?: number;
  /** Show the browser window (`AGENT_BROWSER_HEADED=1` also works). */
  readonly headed?: boolean;
  /** Chrome profile name or directory (`--profile`). */
  readonly profile?: string;
  /** HTTP(S) proxy URL (`--proxy`). */
  readonly proxy?: string;
  /** Persist cookies/localStorage (`--restore`). Default true. */
  readonly restore?: boolean;
  /** Attach to a running Chrome (`--auto-connect`). */
  readonly autoConnect?: boolean;
  /** Load auth state JSON (`--state`). */
  readonly statePath?: string;
  /**
   * Extra Chromium launch flags for `--args` / `AGENT_BROWSER_ARGS`
   * (comma or newline separated). Empty → platform default (Windows:
   * `--no-sandbox` so elevated Hosts do not die on DevToolsActivePort).
   */
  readonly chromeArgs?: string;
  /**
   * When no explicit executable path is set: prefer system Edge/Chrome (`auto`)
   * or force a family / install-cache only.
   */
  readonly browserBinary?: BrowserBinaryPreference;
  /** Injected runner for tests (second arg is the resolved child env). */
  readonly run?: (
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ stdout: string; stderr: string }>;
}

/** Drop headed env so CLI headless retries are not overridden. */
function withoutHeadedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.AGENT_BROWSER_HEADED;
  return next;
}

/** Sanitize a Host session id into an agent-browser `--session` / restore key. */
export function sanitizeAgentBrowserSessionName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return cleaned || `xrk-${randomUUID().slice(0, 8)}`;
}

interface AgentBrowserJson {
  readonly success?: boolean;
  readonly ok?: boolean;
  readonly data?: Record<string, unknown> | null;
  readonly error?: string | { readonly message?: string; readonly code?: string };
  readonly message?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorMessage(parsed: AgentBrowserJson, fallback: string): string {
  const err = parsed.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object" && typeof err.message === "string") {
    return err.message;
  }
  if (typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message.trim();
  }
  return fallback;
}

function mapLaunchError(message: string): WebError {
  if (/Chrome not found|Auto-launch failed|executable-path|agent-browser install/i.test(message)) {
    return new WebError(
      "agent-browser needs a Chromium browser. Default is your system Edge/Chrome (no download). " +
        "Or set Settings → Browser binary / executable path, or run `agent-browser install` once. " +
        `Detail: ${message.slice(0, 400)}`,
      "WEB_BROWSER_NO_GRAPHICS",
    );
  }
  if (/DevToolsActivePort|exited early|exited before providing DevTools/i.test(message)) {
    return new WebError(
      `${message.slice(0, 500)} — if this keeps failing under an elevated Host, set Browser → Chrome args to --no-sandbox (Windows default when the field is empty).`,
      "WEB_BROWSER_CDP",
    );
  }
  return new WebError(message.slice(0, 800), "WEB_BROWSER_CDP");
}

/** True when Chromium died before publishing a DevTools endpoint. */
export function isChromeDevtoolsLaunchFailure(message: string): boolean {
  return /DevToolsActivePort|exited early|exited before providing DevTools/i.test(
    message,
  );
}

/**
 * Resolve Chromium `--args` for agent-browser.
 * Precedence: explicit option → `AGENT_BROWSER_ARGS` → Windows `--no-sandbox`.
 */
export function resolveAgentBrowserChromeArgs(
  options: {
    readonly chromeArgs?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
  } = {},
): string {
  const fromOption = options.chromeArgs?.trim() ?? "";
  if (fromOption) return fromOption;
  const env = options.env ?? process.env;
  const fromEnv = String(env.AGENT_BROWSER_ARGS ?? "").trim();
  if (fromEnv) return fromEnv;
  const platform = options.platform ?? process.platform;
  // Elevated Windows Hosts (Admin Cursor / service accounts) often see Chrome
  // exit 0 without DevToolsActivePort unless the sandbox is relaxed.
  if (platform === "win32") return "--no-sandbox";
  return "";
}

function chromeArgsIncludeNoSandbox(args: string): boolean {
  return /(?:^|[\s,])--no-sandbox(?:$|[\s,])/i.test(args);
}

function firstExisting(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.F_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Known install locations for everyday Chromium browsers (no download). */
export function systemBrowserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  prefer: "edge" | "chrome" | "any" = "any",
): string[] {
  const localApp = env.LOCALAPPDATA?.trim() || "";
  const programFiles = env.ProgramFiles?.trim() || "C:\\Program Files";
  const programFilesX86 =
    env["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();

  const edgeWin = [
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  const chromeWin = [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localApp
      ? path.join(localApp, "Google", "Chrome", "Application", "chrome.exe")
      : "",
  ].filter(Boolean);
  const edgeMac = [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  const chromeMac = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const chromeLinux = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    path.join(home, ".local", "bin", "chrome"),
  ];
  const edgeLinux = [
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ];

  if (platform === "win32") {
    if (prefer === "edge") return edgeWin;
    if (prefer === "chrome") return chromeWin;
    // Windows: Edge is preinstalled for most users; Chrome often needs a proxy.
    return [...edgeWin, ...chromeWin];
  }
  if (platform === "darwin") {
    if (prefer === "edge") return edgeMac;
    if (prefer === "chrome") return chromeMac;
    return [...chromeMac, ...edgeMac];
  }
  if (prefer === "edge") return edgeLinux;
  if (prefer === "chrome") return chromeLinux;
  return [...chromeLinux, ...edgeLinux];
}

/** First existing system Edge/Chrome/Chromium binary, if any. */
export function resolveSystemBrowserExecutable(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly prefer?: "edge" | "chrome" | "any";
  } = {},
): string | undefined {
  return firstExisting(
    systemBrowserCandidates(
      options.platform ?? process.platform,
      options.env ?? process.env,
      options.prefer ?? "any",
    ),
  );
}

/** Chromium from `agent-browser install` only (may require network/proxy once). */
export function resolveBundledChromeCache(
  _env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const root = path.join(homedir(), ".agent-browser", "browsers");
  try {
    accessSync(root, fsConstants.F_OK);
  } catch {
    return undefined;
  }
  try {
    const dirs = readdirSync(root)
      .filter((name) => name.startsWith("chrome-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidates =
        platform === "win32"
          ? [
              path.join(root, dir, "chrome-win64", "chrome.exe"),
              path.join(root, dir, "chrome.exe"),
            ]
          : platform === "darwin"
            ? [
                path.join(
                  root,
                  dir,
                  "chrome-mac-x64",
                  "Google Chrome for Testing.app",
                  "Contents",
                  "MacOS",
                  "Google Chrome for Testing",
                ),
                path.join(
                  root,
                  dir,
                  "chrome-mac-arm64",
                  "Google Chrome for Testing.app",
                  "Contents",
                  "MacOS",
                  "Google Chrome for Testing",
                ),
              ]
            : [
                path.join(root, dir, "chrome-linux64", "chrome"),
                path.join(root, dir, "chrome"),
              ];
      const hit = firstExisting(candidates);
      if (hit) return hit;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Resolve the browser binary for agent-browser.
 * Precedence: Settings/env path → preference → system browsers → install cache.
 */
export function resolveAgentBrowserExecutable(
  env: NodeJS.ProcessEnv = process.env,
  preference: BrowserBinaryPreference = "auto",
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const override =
    String(env.AGENT_BROWSER_EXECUTABLE_PATH ?? env.XRK_BROWSER_EXECUTABLE ?? "").trim();
  if (override) return override;

  const bundled = () => resolveBundledChromeCache(env, platform);
  const system = (prefer: "edge" | "chrome" | "any") =>
    resolveSystemBrowserExecutable({ platform, env, prefer });

  if (preference === "bundled") return bundled();
  if (preference === "edge") return system("edge") ?? bundled() ?? system("chrome");
  if (preference === "chrome") {
    return system("chrome") ?? bundled() ?? system("edge");
  }
  // auto: prefer browsers that agent-browser can CDP-drive reliably.
  // System Chrome → product Chromium cache (no download if already installed) →
  // Edge last (Windows preinstall; agent-browser often exits before DevToolsActivePort).
  return system("chrome") ?? bundled() ?? system("edge");
}

/**
 * @deprecated Prefer {@link resolveAgentBrowserExecutable}. Kept for callers that
 * only want env override + install cache (now also falls back to system browsers).
 */
export function resolveBundledChromeExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAgentBrowserExecutable(env, "auto");
}

async function runAgentBrowser(
  args: readonly string[],
  options: AgentBrowserSessionOptions,
  preferJson: boolean,
): Promise<AgentBrowserJson> {
  const baseEnv = options.env ?? process.env;
  const preference = options.browserBinary ?? "auto";
  const chrome = resolveAgentBrowserExecutable(baseEnv, preference);
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...(chrome && !baseEnv.AGENT_BROWSER_EXECUTABLE_PATH
      ? { AGENT_BROWSER_EXECUTABLE_PATH: chrome }
      : {}),
  };
  // Face/Settings may set AGENT_BROWSER_HEADED=1 while a DevTools self-heal
  // flips `options.headed` to false — clear the env or the CLI stays headed.
  if (options.headed === false) {
    delete env.AGENT_BROWSER_HEADED;
  } else if (options.headed === true) {
    env.AGENT_BROWSER_HEADED = "1";
  }
  const bin = options.bin ?? resolveAgentBrowserBin(env);
  const timeout = options.timeoutMs ?? 120_000;
  let stdout: string;
  let stderr: string;
  try {
    const result = options.run
      ? await options.run(args, env)
      : await execFileAsync(bin, [...args], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          timeout,
          env,
          windowsHide: true,
        });
    stdout = result.stdout;
    stderr = result.stderr ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|不是内部或外部命令/i.test(message)) {
      throw new WebError(
        "agent-browser CLI not found. Install it (npm i -g agent-browser) " +
          "or set XRK_AGENT_BROWSER to the binary. Desktop builds ship it under Host node_modules.",
        "WEB_BROWSER_NO_GRAPHICS",
      );
    }
    const failed = err as { stdout?: string; stderr?: string };
    const body = String(failed.stdout ?? failed.stderr ?? message);
    try {
      const parsed = JSON.parse(body) as AgentBrowserJson;
      if (parsed.success === false || parsed.ok === false) {
        throw mapLaunchError(errorMessage(parsed, body));
      }
    } catch (inner) {
      if (inner instanceof WebError) throw inner;
    }
    throw mapLaunchError(body);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    if (stderr.trim() && /Chrome not found|Auto-launch failed/i.test(stderr)) {
      throw mapLaunchError(stderr.trim());
    }
    return { success: true, data: {} };
  }
  if (preferJson) {
    try {
      const parsed = JSON.parse(trimmed) as AgentBrowserJson;
      if (parsed.success === false || parsed.ok === false) {
        throw mapLaunchError(errorMessage(parsed, trimmed));
      }
      return parsed;
    } catch (err) {
      if (err instanceof WebError) throw err;
      // fall through to text wrap
    }
  }
  return { success: true, data: { text: trimmed } };
}

function stringField(
  data: Record<string, unknown> | undefined,
  keys: readonly string[],
): string {
  if (!data) return "";
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Create a BrowserSession that shells out to `agent-browser`.
 */
export function createAgentBrowserSession(
  options: AgentBrowserSessionOptions = {},
): BrowserSession {
  let sessionName = sanitizeAgentBrowserSessionName(
    options.sessionName ?? `xrk-${randomUUID().slice(0, 8)}`,
  );
  let url = "";
  let title = "";
  let opened = false;
  // May switch to product Chromium after a DevToolsActivePort self-heal.
  let launchOpts: AgentBrowserSessionOptions = options;

  let env = launchOpts.env ?? process.env;
  // Prefer headed when Settings ask for it; may flip to headless after a
  // DevToolsActivePort self-heal (common under elevated Windows Hosts).
  let headed =
    options.headed === true ||
    String(env.AGENT_BROWSER_HEADED ?? "").trim() === "1";
  const profile =
    options.profile?.trim() ||
    String(env.AGENT_BROWSER_PROFILE ?? "").trim() ||
    "";
  const proxy =
    options.proxy?.trim() ||
    String(env.AGENT_BROWSER_PROXY ?? "").trim() ||
    "";
  const statePath =
    options.statePath?.trim() ||
    String(env.AGENT_BROWSER_STATE ?? "").trim() ||
    "";
  const restore =
    options.restore !== false &&
    String(env.AGENT_BROWSER_RESTORE ?? "1").trim() !== "0";
  const autoConnect =
    options.autoConnect === true ||
    String(env.AGENT_BROWSER_AUTO_CONNECT ?? "").trim() === "1";
  let chromeArgs = resolveAgentBrowserChromeArgs({
    ...(options.chromeArgs !== undefined
      ? { chromeArgs: options.chromeArgs }
      : {}),
    env,
  });

  const globalFlags = (json: boolean): string[] => {
    const flags = ["--session", sessionName];
    if (json) flags.push("--json");
    if (headed) flags.push("--headed");
    if (profile) flags.push("--profile", profile);
    if (proxy) flags.push("--proxy", proxy);
    if (statePath) flags.push("--state", statePath);
    if (restore) flags.push("--restore");
    if (autoConnect) flags.push("--auto-connect");
    if (chromeArgs) flags.push("--args", chromeArgs);
    return flags;
  };

  const requireOpen = (): void => {
    if (!opened) {
      throw new WebError(
        "no open page — call browser_open first",
        "WEB_BROWSER_NO_PAGE",
      );
    }
  };

  const afterNav = async (
    note: string,
  ): Promise<BrowserActResult> => {
    const snap = await takeSnapshot(false);
    return { ...snap, note };
  };

  const normalizeRef = (refRaw: string): string => {
    const trimmed = refRaw.trim();
    if (!trimmed) return "";
    const m = /@?(e\d+)/i.exec(trimmed);
    if (m) return `@${m[1]!.toLowerCase()}`;
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  };

  const refreshMeta = async (): Promise<void> => {
    try {
      const urlJson = await runAgentBrowser(
        [...globalFlags(true), "get", "url"],
        launchOpts,
        true,
      );
      const nextUrl = stringField(asRecord(urlJson.data), ["url", "href"]);
      if (nextUrl) url = nextUrl;
    } catch {
      // keep last url
    }
    try {
      const titleJson = await runAgentBrowser(
        [...globalFlags(true), "get", "title"],
        launchOpts,
        true,
      );
      const nextTitle = stringField(asRecord(titleJson.data), ["title"]);
      if (nextTitle) title = nextTitle;
    } catch {
      // keep last title
    }
  };

  const takeSnapshot = async (
    full?: boolean,
  ): Promise<BrowserSnapshotResult> => {
    if (!opened) {
      throw new WebError(
        "no open page — call browser_open first",
        "WEB_BROWSER_NO_PAGE",
      );
    }
    // Plain text snapshot is the agent-friendly format (`[ref=eN]`).
    const args = full
      ? [...globalFlags(false), "snapshot", "-u"]
      : [...globalFlags(false), "snapshot", "-i", "-u"];
    const parsed = await runAgentBrowser(args, launchOpts, false);
    await refreshMeta();
    const text =
      typeof asRecord(parsed.data)?.text === "string"
        ? String(asRecord(parsed.data)!.text).trim()
        : "";
    return { url, title, text };
  };

  return {
    async open(nextUrl, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      const openOnce = async (): Promise<AgentBrowserJson> =>
        runAgentBrowser(
          [...globalFlags(true), "open", nextUrl],
          launchOpts,
          true,
        );
      const preference = launchOpts.browserBinary ?? "auto";
      let parsed: AgentBrowserJson | undefined;
      let lastError: unknown;
      /** Failed headed/CDP launches leave a broken agent-browser session lock. */
      const rotateSession = async (suffix: string): Promise<void> => {
        try {
          await runAgentBrowser(
            [...globalFlags(true), "close"],
            launchOpts,
            true,
          );
        } catch {
          // ignore — process may already be dead
        }
        sessionName = sanitizeAgentBrowserSessionName(
          `${sessionName}-${suffix}-${randomUUID().slice(0, 4)}`,
        );
      };
      const retryOnDevtools = async (
        label: string,
        run: () => Promise<AgentBrowserJson>,
      ): Promise<boolean> => {
        try {
          parsed = await run();
          return true;
        } catch (again) {
          lastError = again;
          const againMsg =
            again instanceof Error ? again.message : String(again);
          if (!isChromeDevtoolsLaunchFailure(againMsg)) throw again;
          void label;
          return false;
        }
      };

      try {
        parsed = await openOnce();
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!isChromeDevtoolsLaunchFailure(message)) throw err;

        // Self-heal 1: elevated Windows Hosts often need --no-sandbox.
        if (!chromeArgsIncludeNoSandbox(chromeArgs)) {
          chromeArgs = chromeArgs
            ? `${chromeArgs},--no-sandbox`
            : "--no-sandbox";
          await rotateSession("ns");
          await retryOnDevtools("no-sandbox", openOnce);
        }

        // Self-heal 2: headed Chromium often exits before DevToolsActivePort
        // under Agent / service accounts — drop to headless for this session.
        // Must also clear AGENT_BROWSER_HEADED (Face sets it when headed=true).
        if (parsed === undefined && headed) {
          headed = false;
          launchOpts = {
            ...launchOpts,
            headed: false,
            env: withoutHeadedEnv(launchOpts.env ?? env),
          };
          env = launchOpts.env ?? process.env;
          await rotateSession("hl");
          await retryOnDevtools("headless", openOnce);
        }
      }

      // Self-heal 3 (auto only): Edge frequently fails CDP with agent-browser;
      // fall back to product Chromium cache / CLI default launcher.
      if (parsed === undefined && preference === "auto") {
        const fallbackEnv = withoutHeadedEnv({ ...env });
        delete fallbackEnv.AGENT_BROWSER_EXECUTABLE_PATH;
        delete fallbackEnv.XRK_BROWSER_EXECUTABLE;
        const bundledPath = resolveBundledChromeCache(fallbackEnv);
        launchOpts = {
          ...launchOpts,
          browserBinary: "bundled",
          headed: false,
          env: bundledPath
            ? {
                ...fallbackEnv,
                AGENT_BROWSER_EXECUTABLE_PATH: bundledPath,
              }
            : fallbackEnv,
        };
        env = launchOpts.env ?? process.env;
        headed = false;
        await rotateSession("bd");
        await retryOnDevtools("bundled", openOnce);
      }
      if (parsed === undefined) {
        throw lastError instanceof Error
          ? lastError
          : new Error(String(lastError ?? "browser_open failed"));
      }
      opened = true;
      url = nextUrl;
      const data = asRecord(parsed.data);
      const reported = stringField(data, ["url", "href"]);
      if (reported) url = reported;
      const reportedTitle = stringField(data, ["title"]);
      if (reportedTitle) title = reportedTitle;
      try {
        await runAgentBrowser(
          [...globalFlags(true), "wait", "--load", "domcontentloaded"],
          launchOpts,
          true,
        );
      } catch {
        // page may already be ready
      }
      await refreshMeta();
      return takeSnapshot(false);
    },
    async snapshot(opts) {
      return takeSnapshot(opts?.full === true);
    },
    async captureScreenshot() {
      if (!opened) {
        throw new WebError(
          "no open page — call browser_open first",
          "WEB_BROWSER_NO_PAGE",
        );
      }
      const dir = await mkdtemp(path.join(tmpdir(), "xrk-agent-browser-"));
      const file = path.join(dir, "shot.png");
      try {
        const parsed = await runAgentBrowser(
          [...globalFlags(true), "screenshot", file],
          launchOpts,
          true,
        );
        const reportedPath = stringField(asRecord(parsed.data), ["path"]);
        const target = reportedPath || file;
        return await readFile(target);
      } catch (err) {
        if (err instanceof WebError) throw err;
        throw new WebError(
          `agent-browser screenshot failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          "WEB_BROWSER_NO_GRAPHICS",
        );
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async act(request, signal): Promise<BrowserActResult> {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      const normalizedRef = normalizeRef(request.ref ?? "");

      // Every branch below assigns before the single `afterNav(note)` read, so
      // an initializer here would only be dead state (no-useless-assignment).
      let note: string;
      if (request.action === "back") {
        await runAgentBrowser([...globalFlags(true), "back"], launchOpts, true);
        note = "navigated back";
      } else if (request.action === "scroll") {
        const dir = request.direction === "up" ? "up" : "down";
        await runAgentBrowser(
          [...globalFlags(true), "scroll", dir],
          launchOpts,
          true,
        );
        note = `scrolled ${dir}`;
      } else if (request.action === "press") {
        const key = (request.key ?? request.text ?? "Enter").trim() || "Enter";
        await runAgentBrowser(
          [...globalFlags(true), "press", key],
          launchOpts,
          true,
        );
        note = `pressed ${key}`;
      } else if (request.action === "type") {
        if (!normalizedRef) {
          throw new WebError("type requires ref", "WEB_BROWSER_BAD_REF");
        }
        const text = request.text ?? "";
        await runAgentBrowser(
          [...globalFlags(true), "fill", normalizedRef, "--", text],
          launchOpts,
          true,
        );
        note = `typed into ${normalizedRef}`;
      } else {
        if (!normalizedRef) {
          throw new WebError("click requires ref", "WEB_BROWSER_BAD_REF");
        }
        await runAgentBrowser(
          [...globalFlags(true), "click", normalizedRef],
          launchOpts,
          true,
        );
        note = `clicked ${normalizedRef}`;
      }

      return afterNav(note);
    },
    async eval(expression, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      const js = expression.trim();
      if (!js) {
        throw new WebError("eval expression is empty", "WEB_BROWSER_CDP");
      }
      const parsed = await runAgentBrowser(
        [...globalFlags(true), "eval", js],
        launchOpts,
        true,
      );
      const data = asRecord(parsed.data);
      if (data === undefined) return "";
      if (typeof data.result === "string") return data.result;
      if (typeof data.text === "string") return data.text;
      if (typeof data.value === "string") return data.value;
      try {
        return JSON.stringify(data);
      } catch {
        return String(data);
      }
    },
    async waitFor(request: BrowserWaitRequest, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      const args = [...globalFlags(true), "wait"];
      if (request.load?.trim()) {
        args.push("--load", request.load.trim());
      } else if (request.selector?.trim()) {
        args.push(request.selector.trim());
      } else if (typeof request.ms === "number" && Number.isFinite(request.ms)) {
        args.push(String(Math.max(0, Math.floor(request.ms))));
      } else {
        throw new WebError(
          "wait needs selector, ms, or load",
          "WEB_BROWSER_CDP",
        );
      }
      await runAgentBrowser(args, launchOpts, true);
    },
    async cookies(request: BrowserCookiesRequest, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      if (request.action === "clear") {
        await runAgentBrowser(
          [...globalFlags(true), "cookies", "clear"],
          launchOpts,
          true,
        );
        return "cookies cleared";
      }
      if (request.action === "set") {
        const name = (request.name ?? "").trim();
        const value = request.value ?? "";
        if (!name) {
          throw new WebError("cookies set needs name", "WEB_BROWSER_CDP");
        }
        const args = [
          ...globalFlags(true),
          "cookies",
          "set",
          name,
          value,
        ];
        if (request.url?.trim()) args.push("--url", request.url.trim());
        if (request.domain?.trim()) args.push("--domain", request.domain.trim());
        if (request.path?.trim()) args.push("--path", request.path.trim());
        await runAgentBrowser(args, launchOpts, true);
        return `cookie set ${name}`;
      }
      const parsed = await runAgentBrowser(
        [...globalFlags(true), "cookies"],
        launchOpts,
        true,
      );
      const data = asRecord(parsed.data);
      try {
        return JSON.stringify(data ?? parsed, null, 2);
      } catch {
        return String(data ?? "");
      }
    },
    async tabs(request: BrowserTabsRequest, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      if (request.action === "list") {
        const parsed = await runAgentBrowser(
          [...globalFlags(true), "tab"],
          launchOpts,
          true,
        );
        try {
          return JSON.stringify(parsed.data ?? parsed, null, 2);
        } catch {
          return String(parsed.data ?? "");
        }
      }
      if (request.action === "new") {
        const args = [...globalFlags(true), "tab", "new"];
        if (request.label?.trim()) {
          args.push("--label", request.label.trim());
        }
        if (request.url?.trim()) args.push(request.url.trim());
        await runAgentBrowser(args, launchOpts, true);
        await refreshMeta();
        return `opened tab${request.url?.trim() ? ` ${request.url.trim()}` : ""}`;
      }
      if (request.action === "switch") {
        const target = (request.target ?? "").trim();
        if (!target) {
          throw new WebError("tabs switch needs target", "WEB_BROWSER_CDP");
        }
        await runAgentBrowser(
          [...globalFlags(true), "tab", target],
          launchOpts,
          true,
        );
        await refreshMeta();
        return `switched to ${target}`;
      }
      const target = (request.target ?? "").trim();
      const args = [...globalFlags(true), "tab", "close"];
      if (target) args.push(target);
      await runAgentBrowser(args, launchOpts, true);
      await refreshMeta();
      return target ? `closed ${target}` : "closed current tab";
    },
    async getInfo(what, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      const key = what === "text" || what === "html" || what === "url" || what === "title"
        ? what
        : "text";
      const parsed = await runAgentBrowser(
        [...globalFlags(true), "get", key],
        launchOpts,
        true,
      );
      const data = asRecord(parsed.data);
      const direct = stringField(data, [key, "value", "text", "html", "url", "title", "href"]);
      if (direct) return direct;
      try {
        return JSON.stringify(data ?? parsed);
      } catch {
        return "";
      }
    },
    async hover(ref, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      const normalizedRef = normalizeRef(ref);
      if (!normalizedRef) {
        throw new WebError("hover requires ref", "WEB_BROWSER_BAD_REF");
      }
      await runAgentBrowser(
        [...globalFlags(true), "hover", normalizedRef],
        launchOpts,
        true,
      );
      return afterNav(`hovered ${normalizedRef}`);
    },
    async selectOption(ref, values, signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      const normalizedRef = normalizeRef(ref);
      if (!normalizedRef) {
        throw new WebError("select requires ref", "WEB_BROWSER_BAD_REF");
      }
      if (values.length === 0) {
        throw new WebError("select needs at least one value", "WEB_BROWSER_CDP");
      }
      await runAgentBrowser(
        [...globalFlags(true), "select", normalizedRef, ...values],
        launchOpts,
        true,
      );
      return afterNav(`selected on ${normalizedRef}: ${values.join(", ")}`);
    },
    async forward(signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      await runAgentBrowser([...globalFlags(true), "forward"], launchOpts, true);
      return afterNav("navigated forward");
    },
    async reload(signal) {
      if (signal?.aborted) {
        throw new WebError("aborted", "WEB_BROWSER_CDP");
      }
      requireOpen();
      await runAgentBrowser([...globalFlags(true), "reload"], launchOpts, true);
      return afterNav("reloaded");
    },
    dispose() {
      void runAgentBrowser(
        [...globalFlags(true), "close"],
        launchOpts,
        true,
      ).catch(() => undefined);
      opened = false;
      url = "";
      title = "";
    },
  };
}
