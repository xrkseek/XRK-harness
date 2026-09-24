/**
 * Outbound host allowlist + audit log for web_fetch (Codex network-proxy
 * policy_decision shape, without MITM / SOCKS). Starlark execpolicy deferred.
 */
import { WebError } from "./types.js";
import { isBlockedHost } from "./url-policy.js";

export type OutboundAllowlistDecision = "allow" | "deny";

export type OutboundAllowlistSource =
  | "open"
  | "allowlist"
  | "private_host";

/** One completed egress decision (Codex-shaped; no tenant identity). */
export interface OutboundAllowlistAuditEvent {
  readonly ts: number;
  readonly decision: OutboundAllowlistDecision;
  readonly source: OutboundAllowlistSource;
  readonly reason: string;
  readonly host: string;
  readonly url: string;
  readonly protocol: "http" | "https";
}

export type OutboundAllowlistAuditObserver = (
  event: OutboundAllowlistAuditEvent,
) => void;

export interface OutboundAllowlistConfig {
  /**
   * Allowed hostnames. Empty / omitted = open (private hosts still blocked).
   * Entries are case-insensitive; `*.example.com` matches subdomains.
   */
  readonly hosts?: readonly string[];
  readonly onAudit?: OutboundAllowlistAuditObserver;
  /** Ring buffer size for {@link getOutboundAllowlistAuditLog}. Default 200. */
  readonly auditCapacity?: number;
}

export interface OutboundAllowlist {
  readonly mode: "open" | "allowlist";
  readonly hosts: readonly string[];
  /** Validate a parsed URL; throws WebError on deny and always audits. */
  assertAllowed(url: URL): void;
  /** Non-throwing check. */
  decide(url: URL): {
    readonly decision: OutboundAllowlistDecision;
    readonly source: OutboundAllowlistSource;
    readonly reason: string;
  };
}

const DEFAULT_AUDIT_CAPACITY = 200;

let sharedLog: OutboundAllowlistAuditEvent[] = [];
let sharedCapacity = DEFAULT_AUDIT_CAPACITY;
let sharedObserver: OutboundAllowlistAuditObserver | undefined;

function pushAudit(event: OutboundAllowlistAuditEvent): void {
  sharedLog.push(event);
  if (sharedLog.length > sharedCapacity) {
    sharedLog = sharedLog.slice(sharedLog.length - sharedCapacity);
  }
  try {
    sharedObserver?.(event);
  } catch {
    /* best-effort */
  }
}

/** Recent audit events (newest last). */
export function getOutboundAllowlistAuditLog(): readonly OutboundAllowlistAuditEvent[] {
  return [...sharedLog];
}

/** Test / Host hook to clear the process-local ring. */
export function clearOutboundAllowlistAuditLog(): void {
  sharedLog = [];
}

/** Optional process-wide observer (Host logger). */
export function setOutboundAllowlistAuditObserver(
  observer: OutboundAllowlistAuditObserver | undefined,
): void {
  sharedObserver = observer;
}

/** Parse `XRK_WEB_FETCH_ALLOWLIST` — comma / whitespace separated hosts. */
export function parseOutboundAllowlistHosts(
  raw: string | undefined,
): readonly string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function outboundAllowlistFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options?: Omit<OutboundAllowlistConfig, "hosts">,
): OutboundAllowlist {
  return createOutboundAllowlist({
    hosts: parseOutboundAllowlistHosts(env.XRK_WEB_FETCH_ALLOWLIST),
    ...options,
  });
}

function hostMatches(pattern: string, hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".example.com"
    return host === p.slice(2) || host.endsWith(suffix);
  }
  return host === p;
}

export function createOutboundAllowlist(
  config: OutboundAllowlistConfig = {},
): OutboundAllowlist {
  const hosts = (config.hosts ?? [])
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const mode = hosts.length === 0 ? "open" : "allowlist";
  if (
    typeof config.auditCapacity === "number" &&
    Number.isFinite(config.auditCapacity) &&
    config.auditCapacity > 0
  ) {
    sharedCapacity = Math.floor(config.auditCapacity);
  }
  if (config.onAudit) {
    sharedObserver = config.onAudit;
  }

  const decide = (
    url: URL,
  ): {
    decision: OutboundAllowlistDecision;
    source: OutboundAllowlistSource;
    reason: string;
    host: string;
    protocol: "http" | "https";
  } => {
    const host = url.hostname;
    const protocol = url.protocol === "https:" ? "https" : "http";
    if (isBlockedHost(host)) {
      return {
        decision: "deny" as const,
        source: "private_host" as const,
        reason: "url targets a loopback or private-network host",
        host,
        protocol: protocol,
      };
    }
    if (mode === "open") {
      return {
        decision: "allow" as const,
        source: "open" as const,
        reason: "allow",
        host,
        protocol: protocol,
      };
    }
    const ok = hosts.some((p) => hostMatches(p, host));
    if (ok) {
      return {
        decision: "allow" as const,
        source: "allowlist" as const,
        reason: "allow",
        host,
        protocol: protocol,
      };
    }
    return {
      decision: "deny" as const,
      source: "allowlist" as const,
      reason: `host not on XRK_WEB_FETCH_ALLOWLIST (${hosts.slice(0, 8).join(", ")}${hosts.length > 8 ? ", …" : ""})`,
      host,
      protocol: protocol,
    };
  };

  return {
    mode,
    hosts,
    decide(url) {
      const d = decide(url);
      return {
        decision: d.decision,
        source: d.source,
        reason: d.reason,
      };
    },
    assertAllowed(url) {
      const d = decide(url);
      // Audit denials always; allowlist-mode allows; skip noisy open allows.
      if (d.decision === "deny" || d.source === "allowlist") {
        pushAudit({
          ts: Date.now(),
          decision: d.decision,
          source: d.source,
          reason: d.reason,
          host: d.host,
          url: url.href,
          protocol: d.protocol,
        });
      }
      if (d.decision === "deny") {
        throw new WebError(
          d.reason,
          d.source === "private_host"
            ? "WEB_BLOCKED_HOST"
            : "WEB_ALLOWLIST_DENIED",
        );
      }
    },
  };
}

