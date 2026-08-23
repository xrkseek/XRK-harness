/**
 * Face / cost-meter → {@link WalletFaceBridge}（Host 注入，非 adapter 逻辑）。
 */
import {
  costMeterDisplayExchangeRate,
  costMeterSessionTotals,
  costMeterWalletUsage,
  type FaceRuntime,
} from "@xrkseek/server-face";
import {
  mapSessionCostToDsh,
  type WalletFaceBridge,
} from "@xrkseek/server-http";

export function createWalletFaceBridgeFromFace(
  face: FaceRuntime,
): WalletFaceBridge {
  return {
    async getSessionCost(sessionId?: string) {
      const sid = sessionId?.trim();
      if (sid) {
        const fromLedger = costMeterSessionTotals(sid);
        if (fromLedger) {
          const mapped = mapSessionCostToDsh(
            fromLedger,
            costMeterDisplayExchangeRate(),
          );
          return {
            uncachedInputTokens: fromLedger.uncachedInputTokens,
            outputTokens: fromLedger.outputTokens,
            cacheReadTokens: fromLedger.cacheReadTokens,
            costCny: mapped.costCny,
            breakdownCny: mapped.breakdownCny,
          };
        }
        const tu = face.projections.snapshot(sid).values.tokenUsage;
        if (tu) {
          return {
            uncachedInputTokens: tu.uncachedInputTokens ?? 0,
            outputTokens: tu.outputTokens ?? 0,
            cacheReadTokens: tu.cacheReadTokens ?? 0,
            costCny: 0,
            breakdownCny: { input: 0, output: 0, cacheRead: 0 },
          };
        }
      }
      return null;
    },
    async getUsageTimeline() {
      return costMeterWalletUsage(7);
    },
  };
}
