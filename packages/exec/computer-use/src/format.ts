/**
 * Model-facing computer_use envelopes — short loop, clear next step.
 */

import type {
  ComputerUseActResult,
  ComputerUseCaptureResult,
  ComputerUseElement,
  ComputerUseFrame,
  ComputerUseScreenshotGeometry,
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
  /** Window frame in logical screen pixels. */
  readonly frame?: ComputerUseFrame;
  /** Screenshot geometry + client inset. */
  readonly screenshot?: ComputerUseScreenshotGeometry;
}): string {
  const lines: string[] = [
    `app: ${options.app || "(unknown)"}`,
    `window: ${options.windowTitle || "(untitled)"}`,
    ...(options.mode ? [`mode: ${options.mode}`] : []),
    ...(options.frame
      ? [
          `frame: origin=${options.frame.x},${options.frame.y} ` +
            `size=${options.frame.width}x${options.frame.height} (logical screen px)`,
        ]
      : []),
    ...(options.screenshot
      ? [
          `screenshot: ${options.screenshot.width}x${options.screenshot.height} ` +
            `inset=${options.screenshot.offsetX},${options.screenshot.offsetY} ` +
            `scale=${options.screenshot.scaleFactor}`,
          "coords: click coordinateSpace=window with screenshot pixels — the provider adds frame+inset",
        ]
      : []),
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
  /** Live Provider delivery — scopes ladder copy away from agent-desktop-only verbs. */
  readonly delivery?: string;
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
    options.elementCount > 0
      ? `next=click|type|key|scroll element 1..${options.elementCount}, then capture again`
      : "next=no element indices here — use the keyboard (press/clipboard_set) or a headed coordinate click, then capture again",
  );
  return lines.join("\n");
}

export function formatWindowsList(windows: readonly ComputerUseWindow[]): string {
  if (windows.length === 0) {
    return [
      "windows: (none)",
      "use=Open or focus the target app, then capture (launch only if that action is on this Provider).",
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
  readonly frame?: ComputerUseFrame;
  readonly screenshot?: ComputerUseScreenshotGeometry;
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
      ...(options.frame !== undefined ? { frame: options.frame } : {}),
      ...(options.screenshot !== undefined
        ? { screenshot: options.screenshot }
        : {}),
      ...(options.note !== undefined ? { note: options.note } : {}),
    }),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(options.frame !== undefined ? { frame: options.frame } : {}),
    ...(options.screenshot !== undefined
      ? { screenshot: options.screenshot }
      : {}),
    ...(options.screenshotPng !== undefined
      ? { screenshotPng: options.screenshotPng }
      : {}),
  };
}

/**
 * System prompt for `computer_use` only (how to use the tool well).
 * Action names live on the tool schema; page-vs-desktop routing lives in web
 * `formatWebFamilyGuidance` when both tools are present.
 */
export function formatComputerUseGuidance(
  available: ToolNameSet,
  options?: ComputerUseModalityOptions,
): string {
  const names = asSet(available);
  if (!names.has("computer_use")) return "";
  const modality = options?.multimodal;
  const delivery = options?.delivery?.trim() || "agent-desktop";
  const ladder =
    modality === false
      ? "Ladder (text-only): try accessibility actions, then find, then clipboard; headed=true only with user consent (it moves the real cursor). vision/som soft-degrade on this route."
      : modality === true
        ? "Ladder (multimodal): accessibility → find → clipboard → vision/som → headed=true only with user consent (it moves the real cursor)."
        : "Ladder: accessibility → find → clipboard → vision/som when the route is multimodal → headed=true only with user consent (it moves the real cursor). On text-only routes, vision/som soft-degrade.";
  if (delivery === "uia" || delivery === "background") {
    return [
      `Native desktop GUI via ${delivery === "uia" ? "Windows UI Automation" : "Background helper + UIA capture"} (delivery=${delivery}). ` +
        "Tool action enum is already narrowed — do not call launch/get/overlay/list_apps; they are not on this Provider.",
      "Usual loop: list_windows → focus_window → capture or find → click/type/key/scroll by element index → capture again. Indices go stale after UI changes.",
      "Prefer focus_window over shell scripts. For CJK text, clipboard_set then key=ctrl+v (or type on an AX ref).",
      ladder,
      "A coordinate click needs headed=true.",
      "Hollow AX (custom-drawn apps): keyboard first — focus_window → press keys → clipboard_set + key=ctrl+v → key=return. A headed coordinate click is the last resort, not the first move.",
      "Need the full agent-desktop surface → Settings → Computer use → agent-desktop.",
    ].join("\n");
  }
  if (delivery === "memory") {
    return [
      "In-memory computer_use fake (delivery=memory). Limited actions: capture/find/list_windows/click/type/key/scroll.",
      ladder,
    ].join("\n");
  }
  return [
    "Native desktop GUI through agent-desktop. Ref actions are headless: they do not move the cursor, steal focus, or touch the clipboard.",
    "Usual loop: list_windows → focus_window or launch → capture or find → click/type/key/scroll by element index → capture again. A newer capture or find invalidates older indices.",
    "Prefer focus_window / launch / restore over shell scripts. For CJK or awkward text, clipboard_set then key=ctrl+v (or type on an AX ref).",
    ladder,
    "Keyboard first: press and clipboard_set move no pointer; only coordinate clicks do, and they need headed=true.",
    "A coordinate click takes screenshot pixels (coordinateSpace=window, the default) and the provider adds the window frame origin — never add it yourself and never do DPI math. preserveCursor=true (default) puts the user's pointer back after the click.",
    "If a window returns almost no accessibility nodes (custom-drawn apps), stay on the keyboard: focus_window → press to reach the row or field → clipboard_set + key=ctrl+v → key=return. Use a headed coordinate click only when the keyboard genuinely cannot reach the target. Do not invent PowerShell or user32 helpers.",
    "Prefer the computer_use tool over bare `agent-desktop` in bash — the tool resolves the binary (like Host already seeing node/npm); do not expect PATH injection.",
  ].join("\n");
}

/** Full-surface default (dual-path modality copy). */
export const COMPUTER_USE_PROMPT_TEXT = formatComputerUseGuidance([
  "computer_use",
]);
