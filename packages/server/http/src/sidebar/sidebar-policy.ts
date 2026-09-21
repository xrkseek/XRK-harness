/**
 * Sidebar / Office Host policy gate.
 * `deny` → hard fail; `ask` → optional approval seam (not hard-mapped to deny).
 *
 * When callers omit `policy`, product defaults apply via
 * {@link createDefaultPolicyEngine} — never silent ungated allow for deny-by-default
 * kinds (`mcp.connect` · `office.connect`).
 *
 * Wire shape matches Face RPC: `{ code, message, details }` via {@link policyWireError}.
 */
import {
  createDefaultPolicyEngine,
  policyWireError,
  type PolicyEngine,
  type PolicySubject,
  type PolicyWireError,
} from "@xrkseek/policy";

/** Shared default engine (immutable kind defaults; no extra rules). */
const PRODUCT_DEFAULT_POLICY: PolicyEngine = createDefaultPolicyEngine();

function resolveEngine(policy: PolicyEngine | undefined): PolicyEngine {
  return policy ?? PRODUCT_DEFAULT_POLICY;
}

/** Host→Face (or other) approval for policy `ask` verdicts.
 * `undefined` = cannot resolve now → keep honest `policy-ask` (not deny).
 */
export type SidebarPolicyAskResolver = (args: {
  readonly subject: PolicySubject;
  readonly reason: string;
  readonly sessionId?: string;
}) => Promise<boolean | undefined>;

/** Same closed shape as Face `policy-denied` / `policy-ask` RPC errors. */
export type SidebarPolicyFailure = PolicyWireError;

/**
 * Sync deny-only helper (tests / call sites that cannot await).
 * `ask` returns `policy-ask` — never conflated with `policy-denied`.
 * Omitting `policy` uses the product default engine.
 */
export function sidebarPolicyDenied(
  policy: PolicyEngine | undefined,
  subject: PolicySubject,
): SidebarPolicyFailure | undefined {
  const d = resolveEngine(policy).evaluate(subject);
  if (d.verdict === "allow") return undefined;
  if (d.verdict === "ask") return policyWireError(subject, d, "ask");
  return policyWireError(subject, d, "deny");
}

/**
 * Enforce policy with an optional ask→approval seam.
 * - allow → undefined (continue)
 * - deny → policy-denied
 * - ask + resolveAsk → await; allow continues, reject → policy-denied
 * - ask without seam → policy-ask (honest; not a silent deny)
 *
 * Omitting `policy` uses the product default engine (not ungated).
 */
export async function enforceSidebarPolicy(
  policy: PolicyEngine | undefined,
  subject: PolicySubject,
  options?: {
    readonly resolveAsk?: SidebarPolicyAskResolver;
    readonly sessionId?: string;
  },
): Promise<SidebarPolicyFailure | undefined> {
  const d = resolveEngine(policy).evaluate(subject);
  if (d.verdict === "allow") return undefined;
  if (d.verdict === "deny") return policyWireError(subject, d, "deny");
  const askWire = policyWireError(subject, d, "ask");
  const resolveAsk = options?.resolveAsk;
  if (!resolveAsk) return askWire;
  const allowed = await resolveAsk({
    subject,
    reason: askWire.message,
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
  });
  if (allowed === true) return undefined;
  if (allowed === false) return policyWireError(subject, d, "ask-rejected");
  return askWire;
}
