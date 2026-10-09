/**
 * Model-facing computer_use envelopes — short loop, clear next step.
 */

import type {
  ComputerUseActResult,
  ComputerUseCaptureResult,
  ComputerUseElement,
  ComputerUseWindow,
} from "./types.js";

export const DEFAULT_MAX_ELEMENTS = 80;
export const DEFAULT_MAX_SNAPSHOT_CHARS = 20_000;

export type ToolNameSet = ReadonlySet<string> | Iterable<string>;

function asSet(available: ToolNameSet): ReadonlySet<string> {
  return available instanceof Set ? available : new Set(available);
}

export function formatAxSnapshot(options: {
  readonly app: string;
  readonly windowTitle: string;
  readonly elements: readonly ComputerUseElement[];
  readonly note?: string;
  readonly maxChars?: number;
  /** Capture mode advertised to the model (ax · som · vision). */
  readonly mode?: ComputerUseCaptureResult["mode"];
}): string {
  const lines: string[] = [
    `app: ${options.app || "(unknown)"}`,
    `window: ${options.windowTitle || "(untitled)"}`,
    ...(options.mode ? [`mode: ${options.mode}`] : []),
    "elements:",
  ];
  for (const el of options.elements) {
    const bounds = el.bounds
      ? ` @(${el.bounds.x},${el.bounds.y},${el.bounds.width}x${el.bounds.height})`
      : "";
    const token = el.elementToken ? ` token=${el.elementToken}` : "";
    lines.push(`  [${el.index}] [${el.role}] ${el.name}${bounds}${token}`);
  }
  if (options.note) {
    lines.push(`note: ${options.note}`);
  }
  let text = lines.join("\n");
  const max = options.maxChars ?? DEFAULT_MAX_SNAPSHOT_CHARS;
  if (text.length > max) {
    text =
      text.slice(0, max) +
      `\n… truncated (${text.length} chars). Capture again with a narrower app target.`;
  }
  return text;
}

/**
 * Append guidance after a capture (inline image vs AX-only).
 */
export function formatCaptureEnvelope(options: {
  readonly snapshotText: string;
  readonly mode: ComputerUseCaptureResult["mode"];
  readonly attachmentId?: string;
  readonly elementCount: number;
}): string {
  const lines = [options.snapshotText.trimEnd()];
  if (options.attachmentId) {
    lines.push(`attachmentId=${options.attachmentId}`);
    lines.push(
      "use=Screenshot inline in this result. Act by [index] from elements: — attachmentId is not a disk path.",
    );
  } else if (options.mode === "ax") {
    lines.push(
      "use=AX tree. Prefer mode=vision|som when pixels help. Act with element=<index>.",
    );
  } else {
    lines.push(
      "use=No screenshot bytes. Act with element=<index>, or re-capture mode=vision|som.",
    );
  }
  lines.push(
    `next=click|type|key|scroll using element 1..${Math.max(options.elementCount, 0)}; then capture again.`,
  );
  return lines.join("\n");
}

export function formatWindowsList(windows: readonly ComputerUseWindow[]): string {
  if (windows.length === 0) {
    return [
      "windows: (none)",
      "use=Launch the target app, then capture.",
    ].join("\n");
  }
  const lines = ["windows:"];
  for (const w of windows) {
    const pid = w.pid !== undefined ? ` pid=${w.pid}` : "";
    const app = w.app ? ` app=${w.app}` : "";
    lines.push(`  - ${w.title || "(untitled)"}${app}${pid}`);
  }
  lines.push(
    "use=Pass a title fragment as capture app=…, then act by element index.",
  );
  return lines.join("\n");
}

export function formatActResult(result: ComputerUseActResult): string {
  const lines = [
    `ok=${result.ok}`,
    `action=${result.action}`,
    `delivery=${result.delivery}`,
    `message=${result.message}`,
    "next=capture again before the next click/type — indices go stale after UI changes.",
  ];
  return lines.join("\n");
}

export function buildCaptureResult(options: {
  readonly mode: ComputerUseCaptureResult["mode"];
  readonly app: string;
  readonly windowTitle: string;
  readonly elements: readonly ComputerUseElement[];
  readonly note?: string;
  readonly screenshotPng?: Uint8Array;
}): ComputerUseCaptureResult {
  return {
    mode: options.mode,
    app: options.app,
    windowTitle: options.windowTitle,
    elements: options.elements,
    text: formatAxSnapshot({
      app: options.app,
      windowTitle: options.windowTitle,
      elements: options.elements,
      mode: options.mode,
      ...(options.note !== undefined ? { note: options.note } : {}),
    }),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(options.screenshotPng !== undefined
      ? { screenshotPng: options.screenshotPng }
      : {}),
  };
}

/**
 * System prompt for `computer_use` only (orthogonal).
 * Page-vs-desktop routing lives in web `formatWebFamilyGuidance` when both exist.
 */
export function formatComputerUseGuidance(available: ToolNameSet): string {
  const names = asSet(available);
  if (!names.has("computer_use")) return "";
  return [
    "Desktop GUI (native apps):",
    "- Loop: `list_windows` → `capture` → `click`/`type`/`key`/`scroll` by element index → `capture` to verify.",
    "- `capture mode=ax` = accessibility tree; `vision`/`som` adds an inline screenshot (`attachmentId=sha256:…`, not a path).",
    "- Prefer element indices from the last capture. Optional `coordinate=[x,y]` for pixel click when vision is active.",
    "- Enable: Settings → Plugins → Computer use, or `XRK_COMPUTER_USE=1` (Windows UIA).",
  ].join("\n");
}

/** Full-surface default. */
export const COMPUTER_USE_PROMPT_TEXT = formatComputerUseGuidance([
  "computer_use",
]);
