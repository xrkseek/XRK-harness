import type {
  ComputerUseCaptureResult,
  ComputerUseElement,
  ComputerUseWindow,
} from "./types.js";

export const DEFAULT_MAX_ELEMENTS = 80;
export const DEFAULT_MAX_SNAPSHOT_CHARS = 20_000;

export function formatAxSnapshot(options: {
  readonly app: string;
  readonly windowTitle: string;
  readonly elements: readonly ComputerUseElement[];
  readonly note?: string;
  readonly maxChars?: number;
}): string {
  const lines: string[] = [
    `app: ${options.app || "(unknown)"}`,
    `window: ${options.windowTitle || "(untitled)"}`,
    "elements:",
  ];
  for (const el of options.elements) {
    const bounds = el.bounds
      ? ` @(${el.bounds.x},${el.bounds.y},${el.bounds.width}x${el.bounds.height})`
      : "";
    lines.push(`  [${el.index}] [${el.role}] ${el.name}${bounds}`);
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

export function formatWindowsList(windows: readonly ComputerUseWindow[]): string {
  if (windows.length === 0) return "windows: (none)";
  const lines = ["windows:"];
  for (const w of windows) {
    const pid = w.pid !== undefined ? ` pid=${w.pid}` : "";
    const app = w.app ? ` app=${w.app}` : "";
    lines.push(`  - ${w.title || "(untitled)"}${app}${pid}`);
  }
  return lines.join("\n");
}

export function buildCaptureResult(options: {
  readonly mode: ComputerUseCaptureResult["mode"];
  readonly app: string;
  readonly windowTitle: string;
  readonly elements: readonly ComputerUseElement[];
  readonly note?: string;
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
      ...(options.note !== undefined ? { note: options.note } : {}),
    }),
    ...(options.note !== undefined ? { note: options.note } : {}),
  };
}

export const COMPUTER_USE_PROMPT_TEXT =
  "Use computer_use only for native host GUI apps (Notepad, Explorer, IDE chrome, OS dialogs) " +
  "via an accessibility tree + input Provider. Prefer action=capture (mode=ax) then " +
  "click/type/key/scroll by element index (key/scroll may omit element to target the focused window). " +
  "Do NOT use computer_use for web pages — use browser_open / browser_snapshot / browser_act " +
  "(and browser_vision when a page screenshot is needed). " +
  "Windows delivery is UIA (Invoke/ValuePattern/SendKeys/ScrollPattern), not full background SPI; " +
  "enable with Settings → Plugins → Computer use or XRK_COMPUTER_USE=1.";
