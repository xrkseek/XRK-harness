/**
 * Minimal 16-color ANSI roles for `xrkh tui`, adapted from community dsh-tui
 * palette roles (dim / accent / success / warning / error). No truecolor,
 * no nested color spans — one role per span.
 */

export interface TuiPalette {
  readonly enabled: boolean;
  dim(text: string): string;
  accent(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  bold(text: string): string;
}

function wrap(open: string, close: string, enabled: boolean) {
  if (!enabled || open === "") return (text: string) => text;
  return (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
}

/** Respect NO_COLOR / FORCE_COLOR=0; require a TTY when color is auto. */
export function tuiColorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTty = process.stdout.isTTY === true,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") return true;
  return isTty;
}

export function createTuiPalette(enabled = tuiColorEnabled()): TuiPalette {
  return {
    enabled,
    // SGR 2+39 — recessed chrome / tool bodies / reasoning (dsh-tui dim).
    dim: wrap("2;39", "22;39", enabled),
    accent: wrap("95", "39", enabled),
    success: wrap("32", "39", enabled),
    warning: wrap("33", "39", enabled),
    error: wrap("31", "39", enabled),
    bold: wrap("1", "22", enabled),
  };
}

export function formatBusyPrompt(
  busy: boolean,
  toolSummary: string,
  palette: TuiPalette,
): string {
  if (!busy) return `${palette.accent("›")} `;
  const tools = toolSummary.trim();
  const body = tools.length > 0 ? `… ${tools}` : "…";
  return `${palette.dim(body)} ${palette.accent("›")} `;
}
