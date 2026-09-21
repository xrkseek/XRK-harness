/**
 * Thrown from Host RPC handlers when policy denies / ask is unresolved.
 * Cordis registry maps this to `rpcErr` with the policy code + details
 * (same shape as Face / sidebar {@link PolicyWireError}).
 */

import type { PolicyWireCode, PolicyWireDetails } from "@xrkseek/policy";

export class HostPolicyError extends Error {
  readonly code: PolicyWireCode;
  readonly details: PolicyWireDetails;

  constructor(
    code: PolicyWireCode,
    message: string,
    details?: PolicyWireDetails,
  ) {
    super(message);
    this.name = "HostPolicyError";
    this.code = code;
    this.details = details ?? {
      kind: "unknown",
      reason: message,
    };
  }
}
