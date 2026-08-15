/** Policy plane subjects — tool / provider / mcp gates. */
export type PolicySubjectKind = "tool.call" | "provider.use" | "mcp.connect";

export type PolicySubject =
  | {
      readonly kind: "tool.call";
      readonly name: string;
      readonly args?: Record<string, unknown>;
    }
  | {
      readonly kind: "provider.use";
      readonly providerId: string;
    }
  | {
      readonly kind: "mcp.connect";
      readonly serverId: string;
    };

/** Product verdicts. Pipeline maps `ask` via pre-execute approval when wired. */
export type PolicyVerdict = "allow" | "deny" | "ask";

export interface PolicyDecision {
  readonly verdict: PolicyVerdict;
  readonly reason?: string;
  readonly ruleId?: string;
}

/**
 * First matching rule wins (registration order).
 * Return `undefined` to continue to the next rule / defaults.
 */
export interface PolicyRule {
  readonly id: string;
  match(subject: PolicySubject): PolicyDecision | undefined;
}

export interface PolicyEngine {
  evaluate(subject: PolicySubject): PolicyDecision;
}
