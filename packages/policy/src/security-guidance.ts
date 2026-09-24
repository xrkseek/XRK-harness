/**
 * Write-path security guidance (Hermes security-guidance shape, thin subset).
 *
 * - Sensitive destination paths → fail-closed deny on `onPre` (before policy).
 * - Content patterns → advisory append on `onPost` by default; set
 *   `XRK_SECURITY_GUIDANCE_BLOCK=1` to refuse the write on `onPre` instead.
 * - `XRK_SECURITY_GUIDANCE_DISABLE=1` kill switch.
 */

import type { PostHandler, PreHandler } from "@xrkseek/core-tools";

const WRITE_TOOLS: ReadonlyMap<string, { pathKeys: readonly string[]; contentKeys: readonly string[] }> =
  new Map([
    ["write_file", { pathKeys: ["path", "file_path"], contentKeys: ["content"] }],
    ["apply_edit", { pathKeys: ["path", "file_path"], contentKeys: ["new_string", "content"] }],
    [
      "apply_patch",
      { pathKeys: ["path", "file_path"], contentKeys: ["patch", "new_string", "input"] },
    ],
  ]);

const MAX_SCAN_BYTES = 256 * 1024;

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function envFlag(
  env: NodeJS.ProcessEnv,
  name: string,
): boolean {
  return TRUTHY.has(String(env[name] ?? "").trim().toLowerCase());
}

/** Sensitive write destinations — deny before policy (fail-closed). */
export interface SensitiveWritePathRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

export const SENSITIVE_WRITE_PATH_RULES: readonly SensitiveWritePathRule[] = [
  {
    id: "dot-env",
    pattern: /(?:^|[/\\])\.env(?:\.[^/\\]+)?$/i,
    reason: "hardline: write to project .env (credentials)",
  },
  {
    id: "ssh-dir",
    pattern: /(?:^|[/\\])\.ssh(?:[/\\]|$)/i,
    reason: "hardline: write under .ssh",
  },
  {
    id: "xrk-credentials",
    pattern: /(?:^|[/\\])\.xrk(?:[/\\].*)?[/\\]\.credentials(?:\.ya?ml)?$/i,
    reason: "hardline: write to harness credentials file",
  },
  {
    id: "shell-rc",
    pattern: /(?:^|[/\\])\.(?:bashrc|zshrc|profile|bash_profile|zprofile)$/i,
    reason: "hardline: write to shell rc / profile",
  },
  {
    id: "system-etc",
    pattern: /(?:^|[/\\])(?:etc|private[/\\]etc)[/\\]/i,
    reason: "hardline: write under /etc",
  },
];

export interface ContentSecurityRule {
  readonly id: string;
  readonly reminder: string;
  readonly substrings?: readonly string[];
  readonly regex?: RegExp;
  readonly pathFilter?: (path: string) => boolean;
  readonly pathCheck?: (path: string) => boolean;
}

const JS_EXTS = /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte)$/i;
const PY_EXTS = /\.(?:py|pyi|ipynb)$/i;
const DOC_EXTS = /\.(?:md|mdx|txt|rst|json|ya?ml)$/i;

/** Curated content patterns (inspired by Hermes / Anthropic security-guidance; not a verbatim fork). */
export const WRITE_CONTENT_SECURITY_RULES: readonly ContentSecurityRule[] = [
  {
    id: "github_actions_workflow",
    reminder:
      "Security warning: editing a GitHub Actions workflow — never interpolate untrusted event fields into `run:` or `ref:`; pass via `env:` with quoting.",
    pathCheck: (p) =>
      p.replace(/\\/g, "/").includes(".github/workflows/") &&
      /\.ya?ml$/i.test(p),
  },
  {
    id: "eval_injection",
    reminder:
      "Security warning: eval() executes arbitrary code. Prefer JSON.parse / ast.literal_eval / a safe expression parser.",
    pathFilter: (p) => !DOC_EXTS.test(p),
    regex: /(?<![A-Za-z0-9_.])eval\s*\(/,
  },
  {
    id: "child_process_exec",
    reminder:
      "Security warning: child_process.exec / execSync run through a shell — prefer execFile/spawn with an argv array.",
    pathFilter: (p) => JS_EXTS.test(p),
    substrings: ["child_process.exec", "execSync("],
    regex: /(?<![A-Za-z0-9_.])exec\s*\(/,
  },
  {
    id: "dangerously_set_inner_html",
    reminder:
      "Security warning: dangerouslySetInnerHTML can XSS untrusted HTML — sanitize (e.g. DOMPurify) or avoid.",
    substrings: ["dangerouslySetInnerHTML"],
  },
  {
    id: "inner_html_assign",
    reminder:
      "Security warning: assigning to innerHTML with untrusted content enables XSS — prefer textContent or a sanitizer.",
    substrings: [".innerHTML =", ".innerHTML="],
  },
  {
    id: "pickle_load",
    reminder:
      "Security warning: pickle / Unpickler loads can execute arbitrary code — prefer JSON or schema-validated formats.",
    pathFilter: (p) => PY_EXTS.test(p),
    regex: /(?<![A-Za-z0-9_])pickle\.(?:loads?|Unpickler)\b/,
  },
  {
    id: "os_system",
    reminder:
      "Security warning: os.system() is a shell injection sink — use subprocess.run([...]) with an argv list.",
    pathFilter: (p) => PY_EXTS.test(p),
    regex: /\bos\.system\s*\(/,
  },
  {
    id: "subprocess_shell_true",
    reminder:
      "Security warning: subprocess(..., shell=True) enables command injection — pass argv as a list without shell.",
    regex: /subprocess\.(?:run|call|Popen|check_output|check_call)\([^)]*shell\s*=\s*True/,
  },
  {
    id: "yaml_unsafe_load",
    reminder:
      "Security warning: yaml.load() can construct arbitrary objects — use yaml.safe_load() for data.",
    regex: /\byaml\.load\s*\((?![^)\n]{0,80}\bSafe)/,
  },
];

export interface SecurityFinding {
  readonly id: string;
  readonly reminder: string;
}

function ruleMatches(
  rule: ContentSecurityRule,
  filePath: string,
  content: string,
): boolean {
  try {
    if (rule.pathCheck) return rule.pathCheck(filePath);
    if (rule.pathFilter && !rule.pathFilter(filePath)) return false;
  } catch {
    return false;
  }
  if (rule.substrings?.some((s) => content.includes(s))) return true;
  if (rule.regex?.test(content)) return true;
  return false;
}

/** Scan write args; empty when disabled or oversize. */
export function scanWritePathSecurity(
  toolName: string,
  args: unknown,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly contentRules?: readonly ContentSecurityRule[];
  } = {},
): readonly SecurityFinding[] {
  const env = options.env ?? process.env;
  if (envFlag(env, "XRK_SECURITY_GUIDANCE_DISABLE")) return [];
  const spec = WRITE_TOOLS.get(toolName);
  if (!spec || !args || typeof args !== "object" || Array.isArray(args)) {
    return [];
  }
  const rec = args as Record<string, unknown>;
  let filePath = "";
  for (const k of spec.pathKeys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) {
      filePath = v;
      break;
    }
  }
  const rules = options.contentRules ?? WRITE_CONTENT_SECURITY_RULES;
  const findings: SecurityFinding[] = [];
  const seen = new Set<string>();

  // path_check rules fire on path alone
  for (const rule of rules) {
    if (!rule.pathCheck) continue;
    if (ruleMatches(rule, filePath, "") && !seen.has(rule.id)) {
      seen.add(rule.id);
      findings.push({ id: rule.id, reminder: rule.reminder });
    }
  }

  for (const ck of spec.contentKeys) {
    const raw = rec[ck];
    if (typeof raw !== "string" || !raw) continue;
    if (Buffer.byteLength(raw, "utf8") > MAX_SCAN_BYTES) continue;
    for (const rule of rules) {
      if (rule.pathCheck) continue;
      if (!ruleMatches(rule, filePath, raw) || seen.has(rule.id)) continue;
      seen.add(rule.id);
      findings.push({ id: rule.id, reminder: rule.reminder });
    }
  }
  return findings;
}

export function matchSensitiveWritePath(
  filePath: string,
  rules: readonly SensitiveWritePathRule[] = SENSITIVE_WRITE_PATH_RULES,
): SensitiveWritePathRule | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) return rule;
  }
  return undefined;
}

function extractWritePath(toolName: string, args: unknown): string {
  const spec = WRITE_TOOLS.get(toolName);
  if (!spec || !args || typeof args !== "object" || Array.isArray(args)) {
    return "";
  }
  const rec = args as Record<string, unknown>;
  for (const k of spec.pathKeys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function formatWarningBlock(findings: readonly SecurityFinding[]): string {
  const names = findings.map((f) => f.id).join(", ");
  const lines = [
    "",
    "---",
    `Security guidance — ${findings.length} pattern${findings.length === 1 ? "" : "s"} matched (${names})`,
    "",
  ];
  for (const f of findings) {
    lines.push(f.reminder, "");
  }
  lines.push(
    "Pattern matches can be false positives. If the construct is safe here, document why briefly and continue; otherwise fix before moving on.",
  );
  return lines.join("\n");
}

export interface WritePathSecurityOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly pathRules?: readonly SensitiveWritePathRule[];
  readonly contentRules?: readonly ContentSecurityRule[];
}

/**
 * Pre-policy floor for write tools: sensitive path deny; optional content block.
 */
export function createWritePathSecurityPre(
  options: WritePathSecurityOptions = {},
): PreHandler {
  const env = options.env ?? process.env;
  return (ctx) => {
    if (!WRITE_TOOLS.has(ctx.call.name)) {
      return { action: "continue", args: ctx.args };
    }
    if (envFlag(env, "XRK_SECURITY_GUIDANCE_DISABLE")) {
      return { action: "continue", args: ctx.args };
    }
    const filePath = extractWritePath(ctx.call.name, ctx.args);
    const pathHit = matchSensitiveWritePath(filePath, options.pathRules);
    if (pathHit) {
      return { action: "deny", reason: pathHit.reason };
    }
    if (envFlag(env, "XRK_SECURITY_GUIDANCE_BLOCK")) {
      const findings = scanWritePathSecurity(ctx.call.name, ctx.args, options);
      if (findings.length > 0) {
        return {
          action: "deny",
          reason:
            "security-guidance refused this write:" +
            formatWarningBlock(findings) +
            "\n\nTo override, unset XRK_SECURITY_GUIDANCE_BLOCK and retry.",
        };
      }
    }
    return { action: "continue", args: ctx.args };
  };
}

/**
 * Advisory post: append guidance to a successful write result (Hermes default).
 */
export function createWritePathSecurityPost(
  options: WritePathSecurityOptions = {},
): PostHandler {
  const env = options.env ?? process.env;
  return (ctx) => {
    if (!WRITE_TOOLS.has(ctx.call.name)) return { action: "accept" };
    if (envFlag(env, "XRK_SECURITY_GUIDANCE_DISABLE")) {
      return { action: "accept" };
    }
    if (envFlag(env, "XRK_SECURITY_GUIDANCE_BLOCK")) {
      return { action: "accept" };
    }
    if (!ctx.result || ctx.result.isError) return { action: "accept" };
    const findings = scanWritePathSecurity(ctx.call.name, ctx.args, options);
    if (findings.length === 0) return { action: "accept" };
    const block = formatWarningBlock(findings);
    const prev = ctx.result.content;
    const next =
      typeof prev === "string"
        ? `${prev}${block}`
        : `${JSON.stringify(prev)}${block}`;
    return { action: "replace", content: next };
  };
}
