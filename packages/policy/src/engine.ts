import type {
  PolicyDecision,
  PolicyEngine,
  PolicyRule,
  PolicySubject,
  PolicySubjectKind,
  PolicyVerdict,
} from "./types.js";

const DEFAULT_VERDICTS: Record<PolicySubjectKind, PolicyVerdict> = {
  "tool.call": "allow",
  "provider.use": "allow",
  /** MCP package is an empty shell — refuse connect until a real client exists. */
  "mcp.connect": "deny",
};

export interface CreatePolicyEngineOptions {
  readonly rules?: readonly PolicyRule[];
  /** Override per-kind default when no rule matches. */
  readonly defaults?: Partial<Record<PolicySubjectKind, PolicyVerdict>>;
}

function defaultReason(kind: PolicySubjectKind, verdict: PolicyVerdict): string {
  if (kind === "mcp.connect" && verdict === "deny") {
    return "mcp.connect denied (MCP client not shipped)";
  }
  return `default ${verdict} for ${kind}`;
}

/**
 * Ordered rule engine. First match wins; else per-kind defaults.
 */
export function createPolicyEngine(
  options: CreatePolicyEngineOptions = {},
): PolicyEngine {
  const rules = options.rules ?? [];
  const defaults: Record<PolicySubjectKind, PolicyVerdict> = {
    ...DEFAULT_VERDICTS,
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

/** Convenience: throw when evaluate is not allow (host / adapter gates). */
export function assertPolicyAllow(
  engine: PolicyEngine,
  subject: PolicySubject,
): void {
  const d = engine.evaluate(subject);
  if (d.verdict === "allow") return;
  const label = d.ruleId ? `rule ${d.ruleId}` : "policy";
  throw new Error(
    `policy ${d.verdict}: ${d.reason ?? subject.kind} (${label})`,
  );
}
