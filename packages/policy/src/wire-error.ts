/**
 * Shared policy gate wire shape for Face RPC · sidebar HTTP · Host Cordis.
 * `policy-ask` is never conflated with `policy-denied`.
 */

import type { PolicyDecision, PolicySubject } from "./types.js";

export type PolicyWireCode = "policy-denied" | "policy-ask";

export interface PolicyWireDetails {
  readonly kind: string;
  readonly reason: string;
  readonly ruleId?: string;
}

/** Closed `{ code, message, details }` used on every policy gate surface. */
export interface PolicyWireError {
  readonly code: PolicyWireCode;
  readonly message: string;
  readonly details: PolicyWireDetails;
}

export type PolicyWirePhase = "deny" | "ask" | "ask-rejected";

function fallbackReason(
  subject: PolicySubject,
  phase: PolicyWirePhase,
): string {
  if (phase === "ask" || phase === "ask-rejected") {
    return `${subject.kind} requires approval`;
  }
  return `${subject.kind} denied`;
}

/**
 * Build the shared wire error. Message is the human reason (same string as
 * `details.reason`); `ruleId` rides details only.
 */
export function policyWireError(
  subject: PolicySubject,
  decision: Pick<PolicyDecision, "reason" | "ruleId">,
  phase: PolicyWirePhase,
): PolicyWireError {
  const reason = decision.reason?.trim() || fallbackReason(subject, phase);
  const code: PolicyWireCode = phase === "ask" ? "policy-ask" : "policy-denied";
  return {
    code,
    message: reason,
    details: {
      kind: subject.kind,
      reason,
      ...(decision.ruleId ? { ruleId: decision.ruleId } : {}),
    },
  };
}

/** Thrown by {@link assertPolicyAllow} so Face / Host can map code + details. */
export class PolicyGateError extends Error {
  readonly code: PolicyWireCode;
  readonly details: PolicyWireDetails;

  constructor(wire: PolicyWireError) {
    // Prefix keeps legacy `toThrow(/policy deny/)` call sites; wire.message
    // (also details.reason) is the product-facing reason without the prefix.
    const verdict = wire.code === "policy-ask" ? "ask" : "deny";
    super(`policy ${verdict}: ${wire.message}`);
    this.name = "PolicyGateError";
    this.code = wire.code;
    this.details = wire.details;
  }
}
