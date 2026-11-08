/**
 * ComputerUseService backed by Vercel Labs `agent-desktop` CLI v1.x
 * (AX tree with snapshot-qualified refs `@<snapshot_id>:eN`; JSON envelopes).
 *
 * Full CLI surface (session + cursor-overlay + observe/act/windows/wait).
 *
 * Contract notes (1.2.x):
 * - stdout is always JSON (`ok` / `data` / `error`); do **not** pass `--json`
 * - click/type/scroll refs must be qualified (`@s…:eN`), never bare `@eN`
 * - `list-windows` returns `data` as an array
 * - `screenshot` without a path returns `{ data: { data: <base64>, format, … } }`
 * - Actions are **headless by default** (no pointer move, no focus steal).
 * - coordinate / mouse-click require `--headed` and explicit `headed=true` from the tool.
 * - `session start --cursor` + `--session` on every call enables the presentation overlay.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAgentDesktopWaitEvent } from "./actions.js";
import { buildCaptureResult } from "./format.js";
import { resolveAgentDesktopBin } from "./resolve-cli.js";
import {
  buildOverlayDisableArgs,
  buildOverlayEnableArgs,
  buildSessionEndArgs,
  buildSessionStartArgs,
  parseSessionId,
  withSessionFlags,
  type SessionScopeOptions,
  type SessionScopeState,
} from "./session-scope.js";
import {
  ComputerUseError,
  type ComputerUseActResult,
  type ComputerUseElement,
  type ComputerUseFrame,
  type ComputerUseScreenshotGeometry,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface AgentDesktopProviderOptions extends SessionScopeOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override binary path (tests / packaged Host). */
  readonly bin?: string;
  readonly timeoutMs?: number;
  /** Injected runner for tests. */
  readonly run?: (
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

export interface AgentDesktopEnvelope {
  readonly ok?: boolean;
  readonly command?: string;
  readonly data?: unknown;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly disposition?: { readonly retry?: string } | string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function flattenTree(
  node: unknown,
  elements: ComputerUseElement[],
  max: number,
): void {
  if (elements.length >= max) return;
  const row = asRecord(node);
  if (!row) return;
  const ref =
    typeof row.ref_id === "string"
      ? row.ref_id
      : typeof row.ref === "string"
        ? row.ref
        : undefined;
  const role = typeof row.role === "string" ? row.role : "unknown";
  const name = typeof row.name === "string" ? row.name : "";
  if (ref) {
    const rawBounds = asRecord(row.bounds);
    const bounds =
      rawBounds !== undefined &&
      typeof rawBounds.x === "number" &&
      typeof rawBounds.y === "number" &&
      typeof rawBounds.width === "number" &&
      typeof rawBounds.height === "number"
        ? {
            x: rawBounds.x,
            y: rawBounds.y,
            width: rawBounds.width,
            height: rawBounds.height,
          }
        : undefined;
    elements.push({
      index: elements.length + 1,
      role,
      name,
      elementToken: ref,
      ...(bounds ? { bounds } : {}),
    });
  }
  const children = row.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      flattenTree(child, elements, max);
      if (elements.length >= max) return;
    }
  }
}

/** Map common key names to agent-desktop press combos. */
function mapPressCombo(raw: string): string {
  const key = raw.trim();
  const lower = key.toLowerCase();
  if (lower === "enter" || lower === "return") return "return";
  if (lower === "esc" || lower === "escape") return "escape";
  if (lower === "tab") return "tab";
  if (lower === "backspace") return "backspace";
  if (lower === "delete" || lower === "del") return "delete";
  return key
    .replace(/\bControl\b/gi, "ctrl")
    .replace(/\bCtrl\b/gi, "ctrl")
    .replace(/\bCmd\b/gi, "cmd")
    .replace(/\bMeta\b/gi, "cmd")
    .replace(/\bAlt\b/gi, "alt")
    .replace(/\bShift\b/gi, "shift")
    .replace(/\s*\+\s*/g, "+")
    .toLowerCase();
}

function needsClipboardType(text: string): boolean {
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0x7f) return true;
  }
  return false;
}

function headedDeniedMessage(): string {
  return (
    "coordinate / physical mouse-click moves the real cursor (--headed). " +
    "Pass headed=true only when the user accepts that. Prefer click by AX element index " +
    "(headless: no pointer move, no focus steal)."
  );
}

function formatCliError(envelope: AgentDesktopEnvelope): {
  message: string;
  code: "COMPUTER_USE_STALE_ELEMENT" | "COMPUTER_USE_BACKEND";
} {
  const err = envelope.error;
  const code = String(err?.code ?? "");
  const base = err?.message ?? "agent-desktop reported ok=false";
  const disposition =
    typeof err?.disposition === "string"
      ? err.disposition
      : err?.disposition && typeof err.disposition === "object"
        ? String(err.disposition.retry ?? "")
        : "";
  const ownership =
    /foreign principal|lock directory owner|token owner|token user/i.test(
      base,
    );
  const hint = ownership
    ? " State root / interaction lease must be owned by this user — Host pins AGENT_DESKTOP_HOME under %LOCALAPPDATA%/xrk-harness-agent-desktop. Do not run Cursor or Harness elevated; if still failing, delete C:\\ProgramData\\agent-desktop then retry."
    : /STALE_REF|AMBIGUOUS_TARGET/i.test(code)
      ? " Capture again and use a fresh element index."
      : disposition
        ? ` disposition.retry=${disposition}.`
        : "";
  return {
    message: `${base}${hint}`,
    code: /STALE_REF/i.test(code)
      ? "COMPUTER_USE_STALE_ELEMENT"
      : "COMPUTER_USE_BACKEND",
  };
}

function parseEnvelope(stdout: string): AgentDesktopEnvelope {
  let envelope: AgentDesktopEnvelope;
  try {
    envelope = JSON.parse(stdout) as AgentDesktopEnvelope;
  } catch {
    throw new ComputerUseError(
      `agent-desktop returned non-JSON: ${stdout.slice(0, 200)}`,
      "COMPUTER_USE_BACKEND",
    );
  }
  if (envelope.ok === false) {
    const formatted = formatCliError(envelope);
    throw new ComputerUseError(formatted.message, formatted.code);
  }
  return envelope;
}

/**
 * Spawn agent-desktop and parse its JSON envelope (no session scoping).
 */
export async function runAgentDesktop(
  args: readonly string[],
  options: AgentDesktopProviderOptions = {},
): Promise<AgentDesktopEnvelope> {
  const env = options.env ?? process.env;
  const bin = options.bin ?? resolveAgentDesktopBin(env);
  const timeout = options.timeoutMs ?? 60_000;
  let stdout: string;
  try {
    const result = options.run
      ? await options.run(args)
      : await execFileAsync(bin, [...args], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          timeout,
          env: { ...env },
          windowsHide: true,
        });
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|不是内部或外部命令/i.test(message)) {
      throw new ComputerUseError(
        "agent-desktop CLI not found. Install it (npm i -g agent-desktop) " +
          "or set XRK_AGENT_DESKTOP to the binary. Desktop builds ship it under Host node_modules.",
        "COMPUTER_USE_UNAVAILABLE",
      );
    }
    const failed = err as { stdout?: string; stderr?: string };
    const body = String(failed.stdout ?? failed.stderr ?? message);
    try {
      const parsed = JSON.parse(body) as AgentDesktopEnvelope;
      if (parsed.ok === false) {
        const formatted = formatCliError(parsed);
        throw new ComputerUseError(formatted.message, formatted.code);
      }
    } catch (inner) {
      if (inner instanceof ComputerUseError) throw inner;
    }
    throw new ComputerUseError(
      `agent-desktop failed: ${body.slice(0, 500)}`,
      "COMPUTER_USE_BACKEND",
    );
  }
  return parseEnvelope(stdout);
}

interface DecodedScreenshot {
  readonly png: Uint8Array;
  readonly width?: number;
  readonly height?: number;
  readonly scaleFactor?: number;
}

function decodeScreenshot(envelope: AgentDesktopEnvelope): DecodedScreenshot | undefined {
  const data = asRecord(envelope.data);
  if (!data) return undefined;
  const b64 =
    typeof data.data === "string"
      ? data.data
      : typeof data.png_base64 === "string"
        ? data.png_base64
        : typeof data.base64 === "string"
          ? data.base64
          : undefined;
  if (!b64) return undefined;
  const width = typeof data.width === "number" ? data.width : undefined;
  const height = typeof data.height === "number" ? data.height : undefined;
  const scaleFactor =
    typeof data.scale_factor === "number"
      ? data.scale_factor
      : typeof data.scaleFactor === "number"
        ? data.scaleFactor
        : undefined;
  return {
    png: Uint8Array.from(Buffer.from(b64, "base64")),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(scaleFactor !== undefined ? { scaleFactor } : {}),
  };
}

/** Read a `{x,y,width,height}` group, or undefined when any field is missing. */
function readFrame(value: unknown): ComputerUseFrame | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  if (
    typeof raw.x !== "number" ||
    typeof raw.y !== "number" ||
    typeof raw.width !== "number" ||
    typeof raw.height !== "number"
  ) {
    return undefined;
  }
  return {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
  };
}

function xyPair(pair: readonly [number, number]): string {
  return `${Math.round(pair[0])},${Math.round(pair[1])}`;
}

function requireRef(
  ref: string | undefined,
  action: string,
): asserts ref is string {
  if (!ref) {
    throw new ComputerUseError(
      `${action} needs element index from last capture/find`,
      "COMPUTER_USE_BAD_ARGS",
    );
  }
}

function headedArgs(headed: boolean, args: string[]): string[] {
  return headed ? ["--headed", ...args] : args;
}

/**
 * Create a ComputerUseService that shells out to `agent-desktop`.
 * Defaults: durable CLI session + presentation cursor overlay.
 */
export function createAgentDesktopProvider(
  options: AgentDesktopProviderOptions = {},
): ComputerUseService {
  let lastElements: ComputerUseElement[] = [];
  let lastApp = "";
  let lastSnapshotId = "";
  let lastScrollRef = "";
  /** Window frame from the last capture (logical screen px, agent-desktop DIP). */
  let lastFrame: ComputerUseFrame | undefined;
  /** Screenshot geometry + client inset from the last mode=vision|som capture. */
  let lastScreenshot: ComputerUseScreenshotGeometry | undefined;
  const scope: SessionScopeState = {
    sessionId: undefined,
    overlayEnabled: false,
  };
  const enableSession = options.enableSession !== false;
  let sessionPromise: Promise<void> | undefined;

  const runScoped = async (
    args: readonly string[],
    flags?: { readonly skipSession?: boolean },
  ): Promise<AgentDesktopEnvelope> => {
    if (enableSession && !flags?.skipSession) {
      await ensureSession();
    }
    const finalArgs = flags?.skipSession
      ? [...args]
      : withSessionFlags(args, scope, options);
    return runAgentDesktop(finalArgs, options);
  };

  async function ensureSession(): Promise<void> {
    if (!enableSession) return;
    if (scope.sessionId) return;
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const started = await runAgentDesktop(
          buildSessionStartArgs(options),
          options,
        );
        const id = parseSessionId(started);
        if (!id) {
          throw new ComputerUseError(
            "agent-desktop session start returned no session_id",
            "COMPUTER_USE_BACKEND",
          );
        }
        scope.sessionId = id;
        scope.overlayEnabled = options.cursorOverlay !== false;
        const label = options.overlayLabel?.trim();
        if (scope.overlayEnabled && label) {
          await runAgentDesktop(
            withSessionFlags(buildOverlayEnableArgs(label), scope, options),
            options,
          );
        }
      })().catch((err) => {
        sessionPromise = undefined;
        throw err;
      });
    }
    await sessionPromise;
  }

  async function clipboardSet(text: string): Promise<void> {
    await runScoped(["clipboard-set", text]);
  }

  async function typeViaClipboard(
    ref: string,
    text: string,
  ): Promise<string> {
    await clipboardSet(text);
    try {
      await runScoped(["focus", ref]);
    } catch {
      // focus may be unavailable on some roles; paste still targets last focused.
    }
    const pasteArgs = ["press", "ctrl+v"];
    if (lastApp) pasteArgs.push("--app", lastApp);
    await runScoped(pasteArgs);
    return "typed-clipboard-paste";
  }

  /**
   * Make sure a window frame is cached for coordinate conversion. A cold
   * provider (no capture yet) or a moved window would otherwise make every
   * coordinate click fail, so fetch the frame once and remember it.
   */
  async function ensureFrame(app?: string): Promise<ComputerUseFrame | undefined> {
    if (lastFrame) return lastFrame;
    const snapshotArgs = [
      "snapshot",
      "-i",
      "--compact",
      "--include-bounds",
      "--timeout-ms",
      "8000",
    ];
    const target = app?.trim();
    if (target) snapshotArgs.push("--app", target);
    try {
      const envelope = await runScoped(snapshotArgs);
      const data = asRecord(envelope.data) ?? {};
      const root = asRecord(data.tree) ?? data;
      const frame = readFrame(root.bounds);
      if (frame) lastFrame = frame;
      if (target) lastApp = target;
    } catch {
      /* resolveCoordinate reports the missing frame */
    }
    return lastFrame;
  }

  /**
   * Resolve a model-supplied coordinate into agent-desktop's logical screen
   * space (DIP). `window` means "pixels measured on the last capture
   * screenshot"; the provider adds the frame origin and the client inset so the
   * model never does DPI arithmetic.
   */
  async function resolveCoordinate(
    coordinate: readonly [number, number],
    space: "window" | "screen" | undefined,
    app?: string,
  ): Promise<readonly [number, number]> {
    if (space === "screen") {
      return [Math.round(coordinate[0]), Math.round(coordinate[1])];
    }
    const frame = await ensureFrame(app);
    if (!frame) {
      throw new ComputerUseError(
        "coordinateSpace=window could not resolve a window frame (no capture, " +
          "and the app did not answer a snapshot). Pass app=…, capture first, " +
          "or use coordinateSpace=screen with absolute desktop pixels.",
        "COMPUTER_USE_BAD_ARGS",
      );
    }
    const offsetX = lastScreenshot?.offsetX ?? 0;
    const offsetY = lastScreenshot?.offsetY ?? 0;
    return [
      Math.round(frame.x + offsetX + coordinate[0]),
      Math.round(frame.y + offsetY + coordinate[1]),
    ];
  }

  /**
   * Read the user's pointer so a headed coordinate click can hand it back.
   * PowerShell reads and writes the same DPI-virtualized space, so a
   * save/restore round-trip lands the pointer exactly where it started.
   */
  async function readCursorPosition(): Promise<
    readonly [number, number] | undefined
  > {
    if (process.platform !== "win32") return undefined;
    // Injected runners are tests/fixtures — never touch the real desktop.
    if (options.run) return undefined;
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; " +
            "$p=[System.Windows.Forms.Cursor]::Position; \"$($p.X),$($p.Y)\"",
        ],
        { timeout: 5000, windowsHide: true },
      );
      const match = /(-?\d+)\s*,\s*(-?\d+)/.exec(String(stdout));
      if (!match) return undefined;
      return [Number(match[1]), Number(match[2])];
    } catch {
      return undefined;
    }
  }

  async function restoreCursorPosition(
    position: readonly [number, number],
  ): Promise<boolean> {
    if (process.platform !== "win32") return false;
    if (options.run) return false;
    try {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; " +
            "Add-Type -AssemblyName System.Drawing; " +
            `[System.Windows.Forms.Cursor]::Position = ` +
            `New-Object System.Drawing.Point(${Math.round(position[0])},${Math.round(position[1])})`,
        ],
        { timeout: 5000, windowsHide: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  function pickElement(index?: number): ComputerUseElement | undefined {
    if (index === undefined) return undefined;
    return lastElements.find((el) => el.index === index);
  }

  async function okAct(
    action: string,
    message: string,
  ): Promise<ComputerUseActResult> {
    return {
      ok: true,
      action,
      message,
      delivery: "agent-desktop",
    };
  }

  return {
    providerId: "agent-desktop",
    delivery: "agent-desktop",
    async close() {
      if (!scope.sessionId) return;
      try {
        if (scope.overlayEnabled) {
          await runScoped(buildOverlayDisableArgs());
        }
      } catch {
        /* best-effort */
      }
      try {
        await runScoped(buildSessionEndArgs());
      } catch {
        /* best-effort */
      }
      scope.sessionId = undefined;
      scope.overlayEnabled = false;
      sessionPromise = undefined;
    },
    async capture(request = {}, signal) {
      if (signal?.aborted) {
        throw new ComputerUseError("aborted", "COMPUTER_USE_BACKEND");
      }
      const max = request.maxElements ?? 200;
      const args = [
        "snapshot",
        "-i",
        "--compact",
        "--include-bounds",
        "--timeout-ms",
        "8000",
      ];
      const app = request.app?.trim();
      if (app) args.push("--app", app);
      const envelope = await runScoped(args);
      const data = asRecord(envelope.data) ?? {};
      const elements: ComputerUseElement[] = [];
      flattenTree(data.tree ?? data, elements, max);
      lastElements = elements;
      lastSnapshotId =
        typeof data.snapshot_id === "string" ? data.snapshot_id : lastSnapshotId;
      if (elements[0]?.elementToken) lastScrollRef = elements[0].elementToken;
      if (app) lastApp = app;
      else if (typeof data.app === "string") lastApp = data.app;

      // Window frame (logical screen px) — the snapshot root node carries it.
      const treeRoot = asRecord(data.tree) ?? data;
      const frame = readFrame(treeRoot.bounds) ?? readFrame(data.bounds);
      if (frame) lastFrame = frame;

      let screenshotPng: Uint8Array | undefined;
      let shotGeometry: ComputerUseScreenshotGeometry | undefined;
      const mode = request.mode ?? "ax";
      if (mode === "vision" || mode === "som") {
        const shotArgs = ["screenshot"];
        if (app) shotArgs.push("--app", app);
        try {
          const shot = await runScoped(shotArgs);
          const decoded = decodeScreenshot(shot);
          if (decoded) {
            screenshotPng = decoded.png;
            if (decoded.width && decoded.height) {
              // The PNG is the client area; centre it horizontally inside the
              // frame and hang it from the top edge vertically.
              const offsetX = frame
                ? Math.max(0, Math.round((frame.width - decoded.width) / 2))
                : 0;
              const offsetY = frame
                ? Math.max(0, Math.round(frame.height - decoded.height))
                : 0;
              shotGeometry = {
                width: decoded.width,
                height: decoded.height,
                scaleFactor: decoded.scaleFactor ?? 1,
                offsetX,
                offsetY,
              };
            }
          }
        } catch {
          /* AX-only soft fallback */
        }
      }
      lastScreenshot = shotGeometry;

      const notes: string[] = [
        "delivery=agent-desktop (AX headless by default; no pointer move unless headed=true)",
      ];
      if (scope.sessionId) notes.push(`session=${scope.sessionId}`);
      if (scope.overlayEnabled) notes.push("cursor-overlay=on");
      if (lastSnapshotId) notes.push(`snapshot_id=${lastSnapshotId}`);
      if (mode === "som") {
        notes.push(
          "mode=som is a vision alias on agent-desktop (no element labels are drawn) — read indices from the AX tree, not from pixels",
        );
      }
      if (frame) {
        notes.push(
          `frame=${frame.x},${frame.y} ${frame.width}x${frame.height} (logical screen px)`,
        );
      }
      if (shotGeometry) {
        notes.push(
          `coords: screenshot ${shotGeometry.width}x${shotGeometry.height}, ` +
            `client inset ${shotGeometry.offsetX},${shotGeometry.offsetY}; ` +
            "pass screenshot pixels with coordinateSpace=window (default) and the provider adds the frame origin",
        );
      }
      if (elements.length <= 2) {
        notes.push(
          "hollow AX tree (≤2 nodes — custom-drawn / accessibility-light UI): " +
            "keyboard first — clipboard_set + key=ctrl+v then key=return moves no pointer; " +
            "focus_window then press keys to reach rows/fields; " +
            "only when keyboard cannot reach a target use headed=true click with screenshot pixels " +
            "(coordinateSpace=window converts them; preserveCursor=true puts the real pointer back)",
        );
      }

      return buildCaptureResult({
        mode: mode === "som" ? "som" : mode === "vision" ? "vision" : "ax",
        app: lastApp || app || "desktop",
        windowTitle:
          typeof data.window_title === "string"
            ? data.window_title
            : lastApp || "desktop",
        elements,
        note: notes.join("; "),
        ...(frame ? { frame } : {}),
        ...(shotGeometry ? { screenshot: shotGeometry } : {}),
        ...(screenshotPng ? { screenshotPng } : {}),
      });
    },
    async find(request, signal) {
      if (signal?.aborted) {
        throw new ComputerUseError("aborted", "COMPUTER_USE_BACKEND");
      }
      const args = ["find"];
      const app = request.app?.trim();
      const role = request.role?.trim();
      const name = request.name?.trim();
      const text = request.text?.trim();
      if (app) args.push("--app", app);
      if (role) args.push("--role", role);
      if (name) args.push("--name", name);
      if (text) args.push("--text", text);
      if (request.exact === true) args.push("--exact");
      if (request.first === true) args.push("--first");
      if (typeof request.limit === "number" && Number.isFinite(request.limit)) {
        args.push("--limit", String(Math.floor(request.limit)));
      }
      const envelope = await runScoped(args);
      const data = asRecord(envelope.data) ?? {};
      const matches = Array.isArray(data.matches)
        ? data.matches
        : Array.isArray(data.elements)
          ? data.elements
          : Array.isArray(envelope.data)
            ? envelope.data
            : [];
      const elements: ComputerUseElement[] = [];
      for (const row of matches) {
        const rec = asRecord(row);
        if (!rec) continue;
        const ref =
          typeof rec.ref_id === "string"
            ? rec.ref_id
            : typeof rec.ref === "string"
              ? rec.ref
              : undefined;
        if (!ref) continue;
        elements.push({
          index: elements.length + 1,
          role: typeof rec.role === "string" ? rec.role : "unknown",
          name: typeof rec.name === "string" ? rec.name : "",
          elementToken: ref,
        });
      }
      lastElements = elements;
      lastSnapshotId =
        typeof data.snapshot_id === "string" ? data.snapshot_id : lastSnapshotId;
      if (elements[0]?.elementToken) lastScrollRef = elements[0].elementToken;
      if (app) lastApp = app;
      const notes: string[] = [
        "delivery=agent-desktop find (matches replace last capture indices)",
      ];
      if (lastSnapshotId) notes.push(`snapshot_id=${lastSnapshotId}`);
      if (elements.length === 0) {
        notes.push(
          "no matches — broaden filters, capture the window, or escalate (vision → headed with consent → refuse/Background)",
        );
      }
      return buildCaptureResult({
        mode: "ax",
        app: lastApp || app || "desktop",
        windowTitle: lastApp || "find",
        elements,
        note: notes.join("; "),
      });
    },
    async act(request, signal) {
      if (signal?.aborted) {
        throw new ComputerUseError("aborted", "COMPUTER_USE_BACKEND");
      }
      const el = pickElement(request.element);
      const ref = el?.elementToken;
      const headed = request.headed === true;
      const app = request.app?.trim() || lastApp;

      if (request.label?.trim() && request.action !== "overlay") {
        await runScoped(buildOverlayEnableArgs(request.label.trim()));
        scope.overlayEnabled = true;
      }

      switch (request.action) {
        case "list_windows": {
          const windows = await this.listWindows(signal);
          return okAct(
            "list_windows",
            windows
              .map((w) => `${w.title}${w.app ? ` (${w.app})` : ""}`)
              .join("\n") || "(none)",
          );
        }
        case "list_apps": {
          const envelope = await runScoped(["list-apps"]);
          return okAct("list_apps", JSON.stringify(envelope.data ?? []));
        }
        case "list_displays": {
          const envelope = await runScoped(["list-displays"]);
          return okAct("list_displays", JSON.stringify(envelope.data ?? []));
        }
        case "list_surfaces": {
          const args = ["list-surfaces"];
          if (app) args.push("--app", app);
          const envelope = await runScoped(args);
          return okAct("list_surfaces", JSON.stringify(envelope.data ?? []));
        }
        case "list_notifications": {
          const args = ["list-notifications"];
          if (app) args.push("--app", app);
          if (request.text?.trim()) args.push("--text", request.text.trim());
          if (
            typeof request.amount === "number" &&
            Number.isFinite(request.amount)
          ) {
            args.push("--limit", String(Math.floor(request.amount)));
          }
          const envelope = await runScoped(args);
          return okAct(
            "list_notifications",
            JSON.stringify(envelope.data ?? []),
          );
        }
        case "status": {
          const envelope = await runScoped(["status"], { skipSession: true });
          return okAct("status", JSON.stringify(envelope.data ?? {}));
        }
        case "permissions": {
          const envelope = await runScoped(["permissions"], {
            skipSession: true,
          });
          return okAct("permissions", JSON.stringify(envelope.data ?? {}));
        }
        case "screenshot": {
          const args = ["screenshot"];
          if (app) args.push("--app", app);
          const envelope = await runScoped(args);
          const png = decodeScreenshot(envelope)?.png;
          return {
            ok: true,
            action: "screenshot",
            message: png
              ? `screenshot-png-bytes=${png.byteLength}`
              : JSON.stringify(envelope.data ?? {}),
            delivery: "agent-desktop",
            ...(png
              ? {
                  capture: buildCaptureResult({
                    mode: "vision",
                    app: app || "desktop",
                    windowTitle: app || "desktop",
                    elements: lastElements,
                    screenshotPng: png,
                    note: "action=screenshot",
                  }),
                }
              : {}),
          };
        }
        case "get": {
          requireRef(ref, "get");
          const prop = request.property?.trim() || "text";
          const envelope = await runScoped([
            "get",
            ref,
            "--property",
            prop,
          ]);
          return okAct("get", JSON.stringify(envelope.data ?? {}));
        }
        case "is": {
          requireRef(ref, "is");
          const prop = request.property?.trim() || "visible";
          const envelope = await runScoped([
            "is",
            ref,
            "--property",
            prop,
          ]);
          return okAct("is", JSON.stringify(envelope.data ?? {}));
        }
        case "clipboard_set": {
          await clipboardSet(request.text ?? "");
          return okAct("clipboard_set", "clipboard-set");
        }
        case "clipboard_get": {
          const envelope = await runScoped(["clipboard-get"]);
          const data = asRecord(envelope.data);
          const text =
            typeof data?.text === "string"
              ? data.text
              : typeof envelope.data === "string"
                ? envelope.data
                : JSON.stringify(envelope.data ?? "");
          return okAct("clipboard_get", text);
        }
        case "clipboard_clear": {
          await runScoped(["clipboard-clear"]);
          return okAct("clipboard_clear", "clipboard-clear");
        }
        case "overlay": {
          const label = (request.label ?? request.text ?? "").trim();
          if (!label || /^off|disable|false|0$/i.test(label)) {
            await runScoped(buildOverlayDisableArgs());
            scope.overlayEnabled = false;
            return okAct("overlay", "cursor-overlay disabled");
          }
          await runScoped(buildOverlayEnableArgs(label));
          scope.overlayEnabled = true;
          return okAct("overlay", `cursor-overlay label=${label}`);
        }
        case "wait": {
          const timeout =
            typeof request.timeoutMs === "number" &&
            Number.isFinite(request.timeoutMs)
              ? Math.floor(request.timeoutMs)
              : 5000;
          const args = ["wait", "--timeout", String(timeout)];
          const pred = request.predicate?.trim() ?? "";
          if (isAgentDesktopWaitEvent(pred)) {
            args.push("--event", pred.toLowerCase());
            if (app) args.push("--app", app);
            if (request.text?.trim()) args.push("--window", request.text.trim());
          } else if (ref) {
            args.push("--element", ref);
            if (pred) args.push("--predicate", pred);
            if (app) args.push("--app", app);
          } else if (request.text?.trim()) {
            args.push("--text", request.text.trim());
            if (app) args.push("--app", app);
          } else if (
            typeof request.amount === "number" &&
            Number.isFinite(request.amount)
          ) {
            // CLI takes positional milliseconds, not --time.
            args.splice(1, 0, String(Math.max(0, Math.floor(request.amount))));
          } else {
            args.splice(1, 0, String(timeout));
          }
          await runScoped(args);
          return okAct("wait", "wait ok");
        }
        case "launch": {
          const target = request.app?.trim() || request.text?.trim();
          if (!target) {
            throw new ComputerUseError(
              "launch needs app=… (application name or path)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const args = ["launch", target];
          if (request.predicate === "activate") args.push("--activate");
          await runScoped(args);
          lastApp = target;
          return okAct("launch", `launched:${target}`);
        }
        case "close_app": {
          const target = request.app?.trim() || request.text?.trim() || lastApp;
          if (!target) {
            throw new ComputerUseError(
              "close_app needs app=…",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const args = ["close-app", target];
          if (
            request.predicate === "force" ||
            request.property === "force"
          ) {
            args.push("--force");
          }
          await runScoped(args);
          return okAct("close_app", `closed:${target}`);
        }
        case "focus_window": {
          const appName = request.app?.trim() || lastApp;
          const title = request.text?.trim();
          if (!appName && !title) {
            throw new ComputerUseError(
              "focus_window needs app=… and/or text=… (window title)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          // `--app` matches a process identity ("Weixin.exe"); a CJK or spaced
          // label is a window title and must go through `--title`. Try the
          // likely reading first, then fall back — a single wrong guess used to
          // fail the focus and poison every later headed action.
          const looksLikeTitle = appName
            ? /[^\x20-\x7E]/.test(appName) || /\s/.test(appName)
            : false;
          const attempts: string[][] = [];
          if (title) {
            if (appName && !looksLikeTitle) {
              attempts.push([
                "focus-window",
                "--app",
                appName,
                "--title",
                title,
              ]);
            }
            attempts.push(["focus-window", "--title", title]);
            if (appName) attempts.push(["focus-window", "--app", appName]);
          } else if (appName) {
            if (looksLikeTitle) {
              attempts.push(["focus-window", "--title", appName]);
              attempts.push(["focus-window", "--app", appName]);
            } else {
              attempts.push(["focus-window", "--app", appName]);
              attempts.push(["focus-window", "--title", appName]);
            }
          } else {
            attempts.push(["focus-window"]);
          }
          let focusError: unknown;
          let used: string[] | undefined;
          for (const args of attempts) {
            try {
              await runScoped(args);
              used = args;
              break;
            } catch (err) {
              focusError = err;
            }
          }
          if (!used) throw focusError;
          if (appName) lastApp = appName;
          const titleAt = used.indexOf("--title");
          const appAt = used.indexOf("--app");
          const resolved =
            titleAt >= 0
              ? `title:${used[titleAt + 1] ?? ""}`
              : appAt >= 0
                ? `app:${used[appAt + 1] ?? ""}`
                : "window";
          return okAct(
            "focus_window",
            `focused:${resolved}`,
          );
        }
        case "resize_window": {
          const target = request.app?.trim() || lastApp;
          if (!target || !request.coordinate) {
            throw new ComputerUseError(
              "resize_window needs app=… and coordinate=[width,height]",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped([
            "resize-window",
            "--app",
            target,
            "--width",
            String(Math.round(request.coordinate[0])),
            "--height",
            String(Math.round(request.coordinate[1])),
          ]);
          return okAct("resize_window", "resize-window ok");
        }
        case "move_window": {
          const target = request.app?.trim() || lastApp;
          if (!target || !request.coordinate) {
            throw new ComputerUseError(
              "move_window needs app=… and coordinate=[x,y]",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped([
            "move-window",
            "--app",
            target,
            "--x",
            String(Math.round(request.coordinate[0])),
            "--y",
            String(Math.round(request.coordinate[1])),
          ]);
          return okAct("move_window", "move-window ok");
        }
        case "minimize":
        case "maximize":
        case "restore": {
          const target = request.app?.trim() || lastApp;
          if (!target) {
            throw new ComputerUseError(
              `${request.action} needs app=…`,
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped([request.action, "--app", target]);
          return okAct(request.action, `${request.action} ok`);
        }
        case "open_system_surface": {
          const surface =
            request.predicate?.trim() ||
            request.text?.trim() ||
            "start-menu";
          await runScoped([
            "open-system-surface",
            "--surface",
            surface,
          ]);
          return okAct("open_system_surface", `opened:${surface}`);
        }
        case "click": {
          if (request.coordinate) {
            if (!headed) {
              throw new ComputerUseError(
                headedDeniedMessage(),
                "COMPUTER_USE_BAD_ARGS",
              );
            }
            const point = await resolveCoordinate(
              request.coordinate,
              request.coordinateSpace,
              app,
            );
            const preserve = request.preserveCursor !== false;
            const saved = preserve ? await readCursorPosition() : undefined;
            let restored = false;
            try {
              await runScoped(
                headedArgs(true, ["mouse-click", "--xy", xyPair(point)]),
              );
            } finally {
              if (saved) restored = await restoreCursorPosition(saved);
            }
            return okAct(
              "click",
              `clicked-coordinate:${xyPair(point)} (headed` +
                (request.coordinateSpace === "screen"
                  ? ", screen-space"
                  : ", from-screenshot→screen") +
                (restored ? ", cursor-restored" : "") +
                ")",
            );
          }
          requireRef(ref, "click");
          await runScoped(headedArgs(headed, ["click", ref]));
          return okAct("click", `clicked:${ref}`);
        }
        case "double_click": {
          requireRef(ref, "double_click");
          if (!headed) {
            throw new ComputerUseError(
              "double_click requires headed=true (physical double-click)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped(headedArgs(true, ["double-click", ref]));
          return okAct("double_click", `double-clicked:${ref}`);
        }
        case "triple_click": {
          requireRef(ref, "triple_click");
          if (!headed) {
            throw new ComputerUseError(
              "triple_click requires headed=true",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped(headedArgs(true, ["triple-click", ref]));
          return okAct("triple_click", `triple-clicked:${ref}`);
        }
        case "right_click": {
          requireRef(ref, "right_click");
          await runScoped(headedArgs(headed, ["right-click", ref]));
          return okAct("right_click", `right-clicked:${ref}`);
        }
        case "hover": {
          if (!headed) {
            throw new ComputerUseError(
              "hover requires headed=true (moves the real cursor)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          if (request.coordinate) {
            const point = await resolveCoordinate(
              request.coordinate,
              request.coordinateSpace,
              app,
            );
            await runScoped(
              headedArgs(true, ["hover", "--xy", xyPair(point)]),
            );
            return okAct(
              "hover",
              `hovered-coordinate:${xyPair(point)}`,
            );
          }
          requireRef(ref, "hover");
          await runScoped(headedArgs(true, ["hover", ref]));
          return okAct("hover", `hovered:${ref}`);
        }
        case "mouse_move": {
          if (!headed) {
            throw new ComputerUseError(
              "mouse_move requires headed=true",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          if (!request.coordinate) {
            throw new ComputerUseError(
              "mouse_move needs coordinate=[x,y]",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const point = await resolveCoordinate(
            request.coordinate,
            request.coordinateSpace,
            app,
          );
          await runScoped(
            headedArgs(true, ["mouse-move", "--xy", xyPair(point)]),
          );
          return okAct(
            "mouse_move",
            `moved:${xyPair(point)}`,
          );
        }
        case "mouse_wheel": {
          if (!headed) {
            throw new ComputerUseError(
              "mouse_wheel requires headed=true",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          if (!request.coordinate) {
            throw new ComputerUseError(
              "mouse_wheel needs coordinate=[x,y] (wheel position)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const dy =
            typeof request.amount === "number" && Number.isFinite(request.amount)
              ? Math.trunc(request.amount)
              : request.direction === "up"
                ? 3
                : -3;
          const point = await resolveCoordinate(
            request.coordinate,
            request.coordinateSpace,
            app,
          );
          await runScoped(
            headedArgs(true, [
              "mouse-wheel",
              "--x",
              String(point[0]),
              "--y",
              String(point[1]),
              "--dy",
              String(dy),
            ]),
          );
          return okAct("mouse_wheel", `wheel dy=${dy}`);
        }
        case "drag": {
          if (!headed) {
            throw new ComputerUseError(
              "drag requires headed=true",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const fromRef = ref;
          const toRef = pickElement(
            typeof request.amount === "number"
              ? Math.floor(request.amount)
              : undefined,
          )?.elementToken;
          if (fromRef && toRef) {
            await runScoped(
              headedArgs(true, [
                "drag",
                "--from",
                fromRef,
                "--to",
                toRef,
              ]),
            );
            return okAct("drag", `dragged:${fromRef}->${toRef}`);
          }
          if (request.coordinate && request.coordinate2) {
            const from = await resolveCoordinate(
              request.coordinate,
              request.coordinateSpace,
              app,
            );
            const to = await resolveCoordinate(
              request.coordinate2,
              request.coordinateSpace,
              app,
            );
            await runScoped(
              headedArgs(true, [
                "drag",
                "--from-xy",
                xyPair(from),
                "--to-xy",
                xyPair(to),
              ]),
            );
            return okAct(
              "drag",
              `dragged:${xyPair(request.coordinate)}->${xyPair(request.coordinate2)}`,
            );
          }
          throw new ComputerUseError(
            "drag needs element→amount(element index) or coordinate+coordinate2",
            "COMPUTER_USE_BAD_ARGS",
          );
        }
        case "dismiss_notification": {
          const index =
            typeof request.element === "number" &&
            Number.isFinite(request.element)
              ? Math.floor(request.element)
              : 0;
          if (index < 1) {
            throw new ComputerUseError(
              "dismiss_notification needs element=1-based index from list_notifications",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const args = ["dismiss-notification", String(index)];
          if (app) args.push("--expected-app", app);
          if (request.text?.trim()) {
            args.push("--expected-title", request.text.trim());
          }
          if (!app && !request.text?.trim()) {
            throw new ComputerUseError(
              "dismiss_notification needs app=… or text=… (expected identity)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped(args);
          return okAct("dismiss_notification", `dismissed:#${index}`);
        }
        case "dismiss_all_notifications": {
          const args = ["dismiss-all-notifications"];
          if (app) args.push("--app", app);
          await runScoped(args);
          return okAct("dismiss_all_notifications", "dismissed-all");
        }
        case "notification_action": {
          const index =
            typeof request.element === "number" &&
            Number.isFinite(request.element)
              ? Math.floor(request.element)
              : 0;
          const actionName = request.text?.trim() || request.property?.trim();
          if (index < 1 || !actionName) {
            throw new ComputerUseError(
              "notification_action needs element=index and text=action name",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const args = [
            "notification-action",
            String(index),
            actionName,
          ];
          if (app) args.push("--expected-app", app);
          if (request.label?.trim()) {
            args.push("--expected-title", request.label.trim());
          }
          if (!app && !request.label?.trim()) {
            throw new ComputerUseError(
              "notification_action needs app=… or label=… (expected identity)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped(args);
          return okAct(
            "notification_action",
            `notification:#${index} → ${actionName}`,
          );
        }
        case "type": {
          requireRef(ref, "type");
          const text = request.text ?? "";
          if (needsClipboardType(text)) {
            return okAct("type", await typeViaClipboard(ref, text));
          }
          try {
            await runScoped(["set-value", ref, text]);
            return okAct("type", "set-value");
          } catch (err) {
            if (!(err instanceof ComputerUseError)) throw err;
            try {
              await runScoped(["type", ref, text]);
              return okAct("type", "typed");
            } catch {
              return okAct("type", await typeViaClipboard(ref, text));
            }
          }
        }
        case "set_value": {
          requireRef(ref, "set_value");
          await runScoped(["set-value", ref, request.text ?? ""]);
          return okAct("set_value", "set-value");
        }
        case "clear": {
          requireRef(ref, "clear");
          await runScoped(["clear", ref]);
          return okAct("clear", "cleared");
        }
        case "focus": {
          requireRef(ref, "focus");
          await runScoped(["focus", ref]);
          return okAct("focus", `focused:${ref}`);
        }
        case "select": {
          requireRef(ref, "select");
          const value = request.text?.trim();
          if (!value) {
            throw new ComputerUseError(
              "select needs text=… (option label/value)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped(["select", ref, value]);
          return okAct("select", `selected:${value}`);
        }
        case "toggle":
        case "check":
        case "uncheck":
        case "expand":
        case "collapse": {
          requireRef(ref, request.action);
          await runScoped([request.action, ref]);
          return okAct(request.action, `${request.action}:${ref}`);
        }
        case "scroll": {
          const direction = request.direction ?? "down";
          const amount =
            typeof request.amount === "number" && Number.isFinite(request.amount)
              ? String(Math.max(1, Math.floor(request.amount)))
              : "3";
          const target = ref || lastScrollRef;
          if (!target) {
            throw new ComputerUseError(
              "scroll needs a capture first (no scrollable ref yet)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          await runScoped([
            "scroll",
            target,
            "--direction",
            direction,
            "--amount",
            amount,
          ]);
          return okAct("scroll", `scrolled:${direction}`);
        }
        case "scroll_to": {
          requireRef(ref, "scroll_to");
          await runScoped(["scroll-to", ref]);
          return okAct("scroll_to", `scrolled-to:${ref}`);
        }
        case "key": {
          const keys = request.keys?.trim() || request.text?.trim();
          if (!keys) {
            throw new ComputerUseError(
              "key needs keys=… (e.g. Enter, Ctrl+C)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const combo = mapPressCombo(keys);
          const args = ["press", combo];
          if (app) args.push("--app", app);
          await runScoped(headedArgs(headed, args));
          return okAct("key", `pressed:${combo}`);
        }
        default:
          throw new ComputerUseError(
            `unsupported action ${String(request.action)}`,
            "COMPUTER_USE_BAD_ARGS",
          );
      }
    },
    async listWindows(signal) {
      if (signal?.aborted) {
        throw new ComputerUseError("aborted", "COMPUTER_USE_BACKEND");
      }
      const envelope = await runScoped(["list-windows"]);
      const rows = Array.isArray(envelope.data)
        ? envelope.data
        : Array.isArray(asRecord(envelope.data)?.windows)
          ? (asRecord(envelope.data)!.windows as unknown[])
          : Array.isArray(asRecord(envelope.data)?.items)
            ? (asRecord(envelope.data)!.items as unknown[])
            : [];
      const windows: ComputerUseWindow[] = [];
      for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const title =
          typeof rec.title === "string"
            ? rec.title
            : typeof rec.name === "string"
              ? rec.name
              : "";
        if (!title) continue;
        const appName =
          typeof rec.app_name === "string"
            ? rec.app_name
            : typeof rec.app === "string"
              ? rec.app
              : undefined;
        windows.push({
          title,
          ...(typeof rec.pid === "number" ? { pid: rec.pid } : {}),
          ...(appName ? { app: appName } : {}),
        });
      }
      return windows;
    },
  };
}
