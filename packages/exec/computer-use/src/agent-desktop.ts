/**
 * ComputerUseService backed by Vercel Labs `agent-desktop` CLI v1.x
 * (AX tree with snapshot-qualified refs `@<snapshot_id>:eN`; JSON envelopes).
 *
 * Contract notes (1.2.x):
 * - stdout is always JSON (`ok` / `data` / `error`); do **not** pass `--json`
 * - click/type/scroll refs must be qualified (`@s…:eN`), never bare `@eN`
 * - `list-windows` returns `data` as an array
 * - `screenshot` without a path returns `{ data: { data: <base64>, format, … } }`
 * - Actions are **headless by default** (no pointer move, no focus steal).
 * - coordinate / mouse-click require `--headed` and explicit `headed=true` from the tool.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCaptureResult } from "./format.js";
import { resolveAgentDesktopBin } from "./resolve-cli.js";
import {
  ComputerUseError,
  type ComputerUseActResult,
  type ComputerUseElement,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface AgentDesktopProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override binary path (tests / packaged Host). */
  readonly bin?: string;
  readonly timeoutMs?: number;
  /** Injected runner for tests. */
  readonly run?: (
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

interface AgentDesktopEnvelope {
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

/** True when the text has any character outside ASCII — clipboard paste is the reliable route. */
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
  const hint =
    /STALE_REF|AMBIGUOUS_TARGET/i.test(code)
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

/**
 * Spawn agent-desktop and parse its JSON envelope.
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

function decodeScreenshotPng(envelope: AgentDesktopEnvelope): Uint8Array | undefined {
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
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function clipboardSet(
  text: string,
  options: AgentDesktopProviderOptions,
): Promise<void> {
  // Prefer argv for short text; CLI also accepts --stdin for secrets.
  await runAgentDesktop(["clipboard-set", text], options);
}

async function typeViaClipboard(
  ref: string,
  text: string,
  lastApp: string,
  options: AgentDesktopProviderOptions,
): Promise<string> {
  await clipboardSet(text, options);
  try {
    await runAgentDesktop(["focus", ref], options);
  } catch {
    // focus may be unavailable on some roles; paste still targets last focused.
  }
  const pasteArgs = ["press", "ctrl+v"];
  if (lastApp) pasteArgs.push("--app", lastApp);
  await runAgentDesktop(pasteArgs, options);
  return "typed-clipboard-paste";
}

/**
 * Create a ComputerUseService that shells out to `agent-desktop`.
 */
export function createAgentDesktopProvider(
  options: AgentDesktopProviderOptions = {},
): ComputerUseService {
  let lastElements: ComputerUseElement[] = [];
  let lastApp = "";
  let lastSnapshotId = "";
  /** Prefer first interactive ref as a scroll target when act has no element. */
  let lastScrollRef = "";

  return {
    providerId: "agent-desktop",
    delivery: "agent-desktop",
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
      const envelope = await runAgentDesktop(args, options);
      const data = asRecord(envelope.data) ?? {};
      const elements: ComputerUseElement[] = [];
      flattenTree(data.tree ?? data, elements, max);
      lastElements = elements;
      lastSnapshotId =
        typeof data.snapshot_id === "string" ? data.snapshot_id : "";
      lastScrollRef = elements[0]?.elementToken ?? "";
      lastApp =
        typeof data.app === "string" && data.app.trim()
          ? data.app.trim()
          : app || "desktop";
      const windowTitle =
        typeof data.title === "string"
          ? data.title
          : typeof asRecord(data.tree)?.name === "string"
            ? String(asRecord(data.tree)!.name)
            : lastApp;
      const mode =
        request.mode === "vision" || request.mode === "som"
          ? request.mode
          : "ax";
      let screenshotPng: Uint8Array | undefined;
      if (mode === "vision" || mode === "som") {
        try {
          const shotArgs = ["screenshot"];
          if (app) shotArgs.push("--app", app);
          const shot = await runAgentDesktop(shotArgs, options);
          screenshotPng = decodeScreenshotPng(shot);
        } catch {
          // AX-only still succeeds; vision note below.
        }
      }
      const notes: string[] = [
        "delivery=agent-desktop (AX headless by default; no pointer move unless headed=true)",
      ];
      if (lastSnapshotId) notes.push(`snapshot_id=${lastSnapshotId}`);
      if (mode !== "ax" && !screenshotPng) {
        notes.push("agent-desktop screenshot unavailable; AX tree only");
      }
      if (elements.length === 0) {
        notes.push(
          "no AX refs — do not steal the mouse via bash/SetCursorPos; try another app, browser_* for web, or Background helper",
        );
      } else if (elements.length <= 2) {
        notes.push(
          "AX tree looks hollow (≤2 nodes — custom-drawn / accessibility-light UIs) — no reliable headless element path; do not steal the mouse via bash",
        );
      }
      return buildCaptureResult({
        mode,
        app: lastApp,
        windowTitle,
        elements,
        ...(screenshotPng ? { screenshotPng } : {}),
        note: notes.join("; "),
      });
    },
    async find(request, signal) {
      if (signal?.aborted) {
        throw new ComputerUseError("aborted", "COMPUTER_USE_BACKEND");
      }
      const role = request.role?.trim() ?? "";
      const name = request.name?.trim() ?? "";
      const text = request.text?.trim() ?? "";
      if (!role && !name && !text) {
        throw new ComputerUseError(
          "find needs role, name, and/or text",
          "COMPUTER_USE_BAD_ARGS",
        );
      }
      const args: string[] = ["find"];
      const app = request.app?.trim() || lastApp;
      if (app) args.push("--app", app);
      if (role) args.push("--role", role);
      if (name) args.push("--name", name);
      if (text) args.push("--text", text);
      if (request.exact === true) args.push("--exact");
      if (request.first === true) {
        args.push("--first");
      } else if (
        typeof request.limit === "number" &&
        Number.isFinite(request.limit) &&
        request.limit >= 0
      ) {
        args.push("--limit", String(Math.floor(request.limit)));
      }
      const envelope = await runAgentDesktop(args, options);
      const data = asRecord(envelope.data) ?? {};
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const max =
        typeof request.limit === "number" &&
        Number.isFinite(request.limit) &&
        request.limit > 0
          ? Math.floor(request.limit)
          : 80;
      const elements: ComputerUseElement[] = [];
      for (const row of matches) {
        if (elements.length >= max) break;
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
      if (elements[0]?.elementToken) {
        lastScrollRef = elements[0].elementToken;
      }
      if (app) lastApp = app;
      const total =
        typeof data.total_matches === "number" ? data.total_matches : undefined;
      const notes: string[] = [
        "delivery=agent-desktop find (matches replace last capture indices)",
      ];
      if (lastSnapshotId) notes.push(`snapshot_id=${lastSnapshotId}`);
      if (total !== undefined) notes.push(`total_matches=${total}`);
      if (data.truncated === true) notes.push("truncated=true");
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
      const pick = (index?: number): ComputerUseElement | undefined => {
        if (index === undefined) return undefined;
        return lastElements.find((el) => el.index === index);
      };
      const el = pick(request.element);
      const ref = el?.elementToken;
      const headed = request.headed === true;

      if (request.action === "clipboard_set") {
        await clipboardSet(request.text ?? "", options);
        return {
          ok: true,
          action: "clipboard_set",
          message: "clipboard-set",
          delivery: "agent-desktop",
        };
      }
      if (request.action === "clipboard_get") {
        const envelope = await runAgentDesktop(["clipboard-get"], options);
        const data = asRecord(envelope.data);
        const text =
          typeof data?.text === "string"
            ? data.text
            : typeof envelope.data === "string"
              ? envelope.data
              : JSON.stringify(envelope.data ?? "");
        return {
          ok: true,
          action: "clipboard_get",
          message: text,
          delivery: "agent-desktop",
        };
      }

      let args: string[];
      let message = `agent-desktop ${request.action} ok`;
      switch (request.action) {
        case "click": {
          if (request.coordinate) {
            if (!headed) {
              throw new ComputerUseError(
                headedDeniedMessage(),
                "COMPUTER_USE_BAD_ARGS",
              );
            }
            const [x, y] = request.coordinate;
            args = [
              "mouse-click",
              "--headed",
              "--xy",
              `${Math.round(x)},${Math.round(y)}`,
            ];
            message = `clicked-coordinate:${Math.round(x)},${Math.round(y)} (headed)`;
          } else if (ref) {
            args = ["click", ref];
          } else {
            throw new ComputerUseError(
              "click needs element index from last capture (or coordinate with headed=true)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          break;
        }
        case "type": {
          if (!ref) {
            throw new ComputerUseError(
              "type needs element index from last capture",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const text = request.text ?? "";
          if (needsClipboardType(text)) {
            message = await typeViaClipboard(ref, text, lastApp, options);
            return {
              ok: true,
              action: "type",
              message,
              delivery: "agent-desktop",
            };
          }
          args = ["set-value", ref, text];
          break;
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
          args = ["press", combo];
          if (lastApp) args.push("--app", lastApp);
          break;
        }
        case "scroll": {
          const direction = request.direction ?? "down";
          const target = ref || lastScrollRef;
          if (target) {
            args = ["scroll", target, "--direction", direction, "--amount", "3"];
          } else {
            throw new ComputerUseError(
              "scroll needs a capture first (no scrollable ref yet)",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          break;
        }
        default:
          throw new ComputerUseError(
            `unsupported action ${String(request.action)}`,
            "COMPUTER_USE_BAD_ARGS",
          );
      }
      try {
        await runAgentDesktop(args, options);
      } catch (err) {
        if (
          request.action === "type" &&
          ref &&
          err instanceof ComputerUseError
        ) {
          try {
            await runAgentDesktop(["type", ref, request.text ?? ""], options);
            message = "typed-fallback";
          } catch {
            message = await typeViaClipboard(
              ref,
              request.text ?? "",
              lastApp,
              options,
            );
          }
        } else {
          throw err;
        }
      }
      const result: ComputerUseActResult = {
        ok: true,
        action: request.action,
        message,
        delivery: "agent-desktop",
      };
      return result;
    },
    async listWindows(signal) {
      if (signal?.aborted) {
        throw new ComputerUseError("aborted", "COMPUTER_USE_BACKEND");
      }
      const envelope = await runAgentDesktop(["list-windows"], options);
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
