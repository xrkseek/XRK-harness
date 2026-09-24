/**
 * Classify human-approval asks for UX (Codex network vs escalation vs tool).
 * Heuristic only — never a security boundary by itself.
 */

export type ApprovalCategory = "tool" | "network" | "escalation";

export type NetworkApprovalProtocol = "http" | "https" | "ws" | "wss" | "other";

export interface NetworkApprovalContext {
  readonly host: string;
  readonly protocol: NetworkApprovalProtocol;
}

export interface ApprovalClassification {
  readonly category: ApprovalCategory;
  readonly network?: NetworkApprovalContext;
}

const NETWORK_TOOLS = new Set([
  "web_fetch",
  "web_search",
  "browser_open",
  "browser_act",
  "browser_snapshot",
  "browser_vision",
  "browser_scroll",
]);

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function protocolOf(raw: string): NetworkApprovalProtocol {
  const p = raw.toLowerCase();
  if (p === "http" || p === "https" || p === "ws" || p === "wss") return p;
  return "other";
}

/** Best-effort URL/host extraction from tool args or summaries. */
export function extractNetworkContext(
  args: unknown,
): NetworkApprovalContext | undefined {
  const obj = asObject(args);
  const candidates: string[] = [];
  if (obj) {
    for (const key of ["url", "href", "uri", "endpoint", "host", "cdpUrl"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) candidates.push(v.trim());
    }
    const summary = obj.summary;
    if (typeof summary === "string" && summary.trim()) candidates.push(summary.trim());
  } else if (typeof args === "string" && args.trim()) {
    candidates.push(args.trim());
  }
  for (const raw of candidates) {
    try {
      const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
        ? raw
        : `https://${raw}`;
      const u = new URL(withScheme);
      if (!u.hostname) continue;
      return {
        host: u.hostname,
        protocol: protocolOf(u.protocol.replace(/:$/, "")),
      };
    } catch {
      // try next
    }
  }
  return undefined;
}

function hasSandboxEscalationArgs(args: unknown): boolean {
  const obj = asObject(args);
  if (!obj) return false;
  if (obj.sandbox_permissions !== undefined && obj.sandbox_permissions !== null) {
    return true;
  }
  if (typeof obj.sandbox === "string" && /danger|full-access|escalat/i.test(obj.sandbox)) {
    return true;
  }
  return false;
}

/**
 * Map tool / host-gate name + args onto an approval UX category.
 */
export function classifyApproval(input: {
  readonly toolName: string;
  readonly args?: unknown;
  readonly reason?: string;
}): ApprovalClassification {
  const name = input.toolName.trim();
  const reason = input.reason ?? "";
  const network = extractNetworkContext(input.args);

  if (
    name === "mcp.connect" ||
    name === "office.connect" ||
    name === "host.open" ||
    NETWORK_TOOLS.has(name) ||
    name.startsWith("browser_")
  ) {
    const action =
      asObject(input.args)?.action ??
      asObject(input.args)?.kind;
    if (name === "host.open" && action === "path") {
      // Local path open is not network.
    } else {
      return {
        category: "network",
        ...(network !== undefined ? { network } : {}),
      };
    }
  }

  if (
    hasSandboxEscalationArgs(input.args) ||
    /^(sandbox\.|escalat)/i.test(name) ||
    /^danger[-_.]/i.test(name) ||
    /escalat|sandbox\s*upgrade|danger-full-access|privileged/i.test(reason)
  ) {
    return { category: "escalation" };
  }

  if (network) {
    return { category: "network", network };
  }

  return { category: "tool" };
}
