/**
 * Face → cost-meter ledger aggregate for dsh-tokenledger / usage-stats.
 */
import {
  costMeterAggregateUsage,
  type FaceRuntime,
} from "@xrkseek/server-face";
import { createTokenLedgerBridgeFromFace } from "@xrkseek/server-http";

function ledgerHasUsage(body: Record<string, unknown>): boolean {
  const activity = body.activity;
  if (!Array.isArray(activity)) return false;
  return activity.some(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { tokens?: unknown }).tokens === "number" &&
      (row as { tokens: number }).tokens > 0,
  );
}

export function createCostMeterUsageBridge(face: FaceRuntime): {
  readonly aggregateUsage: (
    query: { readonly days?: number; readonly site?: string },
  ) => Promise<Record<string, unknown>>;
} {
  const fallback = createTokenLedgerBridgeFromFace(face);
  return {
    aggregateUsage: async (query) => {
      const fromLedger = costMeterAggregateUsage(query);
      if (ledgerHasUsage(fromLedger)) return fromLedger;
      const fromProjections = fallback.aggregateUsage
        ? await fallback.aggregateUsage(query)
        : undefined;
      return fromProjections ?? fromLedger;
    },
  };
}
