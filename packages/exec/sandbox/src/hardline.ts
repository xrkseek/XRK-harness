/**
 * Fail-closed argv hardline (Hermes approval hardline / Codex dangerous-command floor).
 * Runs as pipeline `onPre` **before** policy so YOLO / ask rules cannot bypass wipe / block-device damage.
 */

import type { PreHandler } from "@xrkseek/core-tools";

/** Patterns with a short deny reason (matched against joined argv / bash -lc payload). */
export interface HardlineArgvRule {
  readonly pattern: RegExp;
  readonly reason: string;
}

/** Start-of-command (Hermes _CMDPOS lite): BOL / separator / subshell, optional sudo. */
const CMDPOS = "(?:^|[\\n;|&`]|\\$\\()\\s*(?:sudo\\s+)?";

/**
 * Tiny hardline floor — only no-recovery host damage.
 * Recoverable ops (chmod 777, curl|sh, git reset --hard) stay out.
 */
export const HARDLINE_ARGV_RULES: readonly HardlineArgvRule[] = [
  {
    pattern: /\brm\s+(-[^\s]*\s+)*-rf\s+\/(?:\s|$)/i,
    reason: "hardline: recursive delete of root filesystem",
  },
  {
    pattern:
      /\brm\s+(-[^\s]*\s+)*-rf\s+\/(?:home|root|etc|usr|var|bin|sbin|boot|lib)(?:\/|\s|$)/i,
    reason: "hardline: recursive delete of system directory",
  },
  {
    pattern: /\brm\s+(-[^\s]*\s+)*-rf\s+(?:~|\$\{?HOME\}?)(?:\/|\s|$)/i,
    reason: "hardline: recursive delete of home directory",
  },
  {
    pattern: /\bdel\s+\/s\s+\/q\s+[a-z]:\\/i,
    reason: "hardline: recursive delete of drive root (Windows)",
  },
  {
    pattern:
      /\b(?:Remove-Item|ri)\b[^\n]*\s-(?:Recurse|r)\b[^\n]*\s-(?:Force|f)\b[^\n]*[a-z]:\\/i,
    reason: "hardline: recursive force delete of drive root (PowerShell)",
  },
  {
    pattern: new RegExp(CMDPOS + String.raw`mkfs(?:\.[a-z0-9]+)?\b`, "i"),
    reason: "hardline: format filesystem (mkfs)",
  },
  {
    pattern: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*/i,
    reason: "hardline: dd to raw block device",
  },
  {
    pattern: />\s*\/dev\/(?:sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*\b/i,
    reason: "hardline: redirect to raw block device",
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: "hardline: fork bomb",
  },
  {
    pattern: new RegExp(CMDPOS + String.raw`kill\s+(-[^\s]+\s+)*-1\b`, "i"),
    reason: "hardline: kill all processes",
  },
  {
    pattern: new RegExp(
      CMDPOS + String.raw`(?:shutdown|reboot|halt|poweroff)\b`,
      "i",
    ),
    reason: "hardline: system shutdown/reboot",
  },
  {
    pattern: new RegExp(
      CMDPOS + String.raw`systemctl\s+(?:poweroff|reboot|halt|kexec)\b`,
      "i",
    ),
    reason: "hardline: systemctl poweroff/reboot",
  },
];

/** RegExp-only list for {@link createDenyListSandbox} default. */
export const DEFAULT_HARDLINE_ARGV_PATTERNS: readonly RegExp[] =
  HARDLINE_ARGV_RULES.map((r) => r.pattern);

export function matchHardlineArgv(
  command: string,
  rules: readonly HardlineArgvRule[] = HARDLINE_ARGV_RULES,
): HardlineArgvRule | undefined {
  const text = command.trim();
  if (!text) return undefined;
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule;
  }
  return undefined;
}

const SHELL_TOOLS = new Set(["bash", "shell", "run_terminal_cmd"]);

/**
 * Pre-execute hardline: deny matching shell argv **before** policy / YOLO.
 * Non-shell tools continue.
 */
export function createHardlineArgvPre(
  rules: readonly HardlineArgvRule[] = HARDLINE_ARGV_RULES,
): PreHandler {
  return (ctx) => {
    if (!SHELL_TOOLS.has(ctx.call.name)) {
      return { action: "continue", args: ctx.args };
    }
    const args =
      ctx.args && typeof ctx.args === "object" && !Array.isArray(ctx.args)
        ? (ctx.args as Record<string, unknown>)
        : {};
    const command = String(args.command ?? args.cmd ?? "");
    const hit = matchHardlineArgv(command, rules);
    if (!hit) return { action: "continue", args: ctx.args };
    return { action: "deny", reason: hit.reason };
  };
}
