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

/** Live model route modality for tool envelopes / guidance. */
export interface ComputerUseModalityOptions {
  /**
   * `true` = multimodal (pixels on the wire).
   * `false` = text-only (screenshots soft-degrade).
   * omit = dual-path copy (tests / static prompt constant).
   */
  readonly multimodal?: boolean;
}

/**
 * Append guidance after a capture (inline image vs AX-only).
 */
export function formatCaptureEnvelope(options: {
  readonly snapshotText: string;
  readonly mode: ComputerUseCaptureResult["mode"];
  readonly attachmentId?: string;
  readonly elementCount: number;
  /** When false, vision/som screenshots do not ride the LLM wire. */
  readonly multimodal?: boolean;
}): string {
  const lines = [options.snapshotText.trimEnd()];
  const textOnly = options.multimodal === false;
  if (options.attachmentId) {
    lines.push(`attachmentId=${options.attachmentId}`);
    if (textOnly) {
      lines.push(
        "note=text-only route: the screenshot did not reach you (pixels off wire)",
      );
      lines.push(
        "use=act by [index] or find; do not guess at pixels; switch model for vision",
      );
    } else {
      lines.push(
        "use=the screenshot is above; act by [index]. attachmentId is not a disk path",
      );
    }
  } else if (options.mode === "ax") {
    lines.push(
      textOnly
        ? "use=AX tree only — re-capturing mode=vision will not help on this route"
        : "use=AX tree; re-capture mode=vision|som when pixels would help",
    );
  } else {
    lines.push(
      textOnly
        ? "use=no screenshot bytes on this route; act by [index] or find"
        : "use=no screenshot bytes; act by [index] or re-capture mode=vision|som",
    );
  }
  lines.push(
    `next=click|type|key|scroll element 1..${Math.max(options.elementCount, 0)}, then capture again`,
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
  if (result.delivery === "background") {
    lines.push(
      "note=background delivery: input was handed to the helper; verify outcome with a fresh capture (UIA AX on Windows).",
    );
  }
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
export function formatComputerUseGuidance(
  available: ToolNameSet,
  options?: ComputerUseModalityOptions,
): string {
  const names = asSet(available);
  if (!names.has("computer_use")) return "";
  const modality = options?.multimodal;
  const ladder =
    modality === false
      ? "Ladder (text-only): AX → find → clipboard → headed=true (real mouse; steals the cursor, ask first). vision/som soft-degrade here."
      : modality === true
        ? "Ladder (multimodal): AX → find → clipboard → vision/som → headed=true (real mouse; steals the cursor, ask first)."
        : "Ladder: AX → find → clipboard → vision/som (multimodal) → headed=true (real mouse; steals the cursor, ask first). vision/som soft-degrade on text-only routes.";
  return [
    "Native desktop GUI (agent-desktop; AX capture is headless):",
    "Loop: list_windows → capture|find → click/type/key/scroll by index → capture again.",
    "find matches role/name/text and returns fresh indices; any newer capture or find invalidates them.",
    ladder,
    "A coordinate click needs headed=true.",
    "If a window yields almost no AX nodes, report it instead of guessing.",
    "Do not move the cursor through bash or OS scripts; headed=true is the only door to the real mouse.",
  ].join("\n");
}
/** Full-surface default (dual-path modality copy). */
export const COMPUTER_USE_PROMPT_TEXT = formatComputerUseGuidance([
  "computer_use",
]);
