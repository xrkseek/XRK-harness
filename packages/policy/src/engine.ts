import type {
  PolicyDecision,
  PolicyEngine,
  PolicyRule,
  PolicySubject,
  PolicySubjectKind,
  PolicyVerdict,
} from "./types.js";
import { PolicyGateError, policyWireError } from "./wire-error.js";

/** Product per-kind defaults when no rule matches (Host always injects an engine). */
export const DEFAULT_POLICY_VERDICTS: Readonly<
  Record<PolicySubjectKind, PolicyVerdict>
> = {
  "tool.call": "allow",
  "provider.use": "allow",
  /** MCP client M0 exists; connect still defaults to deny until host allows. */
  "mcp.connect": "deny",
  /** Resource list/read after a connected server — default allow (DSH/Codex). */
  "mcp.resource": "allow",
  /** Desktop open path/URL — allow; Host still validates targets. */
  "host.open": "allow",
  /** Sidebar URL embed — allow http(s); Host probe still required. */
  "sidebar.embed": "allow",
  /** Sidebar FS — allow; cwd sandbox remains the hard fence. */
  "sidebar.fs": "allow",
  /** Office connector — deny until configured (align mcp.connect). */
  "office.connect": "deny",
};

export interface CreatePolicyEngineOptions {
  readonly rules?: readonly PolicyRule[];
  /** Override per-kind default when no rule matches. */
  readonly defaults?: Partial<Record<PolicySubjectKind, PolicyVerdict>>;
}

function defaultReason(kind: PolicySubjectKind, verdict: PolicyVerdict): string {
  if (kind === "mcp.connect" && verdict === "deny") {
    return "mcp.connect denied by default";
  }
  if (kind === "office.connect" && verdict === "deny") {
    return "office.connect denied by default";
  }
  return `default ${verdict} for ${kind}`;
}

/**
 * Ordered rule engine. First match wins; else {@link DEFAULT_POLICY_VERDICTS}
 * (or `options.defaults` overrides).
 *
 * Host always injects an engine — file ruleset **or** this constructor with no
 * args — so sidebar / office never run ungated.
 */
export function createPolicyEngine(
  options: CreatePolicyEngineOptions = {},
): PolicyEngine {
  const rules = options.rules ?? [];
  const defaults: Record<PolicySubjectKind, PolicyVerdict> = {
    ...DEFAULT_POLICY_VERDICTS,
    ...options.defaults,
  };

  return {
    evaluate(subject: PolicySubject): PolicyDecision {
      for (const rule of rules) {
        const hit = rule.match(subject);
        if (hit) {
          return {
            verdict: hit.verdict,
            ...(hit.reason !== undefined ? { reason: hit.reason } : {}),
            ruleId: hit.ruleId ?? rule.id,
          };
        }
      }
      const verdict = defaults[subject.kind];
      return {
        verdict,
        reason: defaultReason(subject.kind, verdict),
      };
    },
  };
}

/**
 * Explicit product default (same as `createPolicyEngine()`).
 * Prefer this name at Host / sidebar call sites that must not omit policy.
 */
export function createDefaultPolicyEngine(): PolicyEngine {
  return createPolicyEngine();
}

/** Convenience: throw when evaluate is not allow (host / adapter gates). */
export function assertPolicyAllow(
  engine: PolicyEngine,
  subject: PolicySubject,
): void {
  const d = engine.evaluate(subject);
  if (d.verdict === "allow") return;
  const phase = d.verdict === "ask" ? "ask" : "deny";
  throw new PolicyGateError(policyWireError(subject, d, phase));
}
