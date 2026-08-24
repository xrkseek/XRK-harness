/**
 * Face / cost-meter → {@link WalletFaceBridge}（Host 注入，非 adapter 逻辑）。
 */
import {
  costMeterDisplayExchangeRate,
  costMeterGetState,
  costMeterRefreshBalance,
  costMeterSessionTotals,
  costMeterWalletUsage,
  type FaceRuntime,
} from "@xrkseek/server-face";
import {
  mapSessionCostToDsh,
  type WalletFaceBridge,
} from "@xrkseek/server-http";

function balanceFromCostMeterState(): {
  readonly status: "ok" | "err" | "off";
  readonly currency: string;
  readonly totalBalance: number;
  readonly fetchedAt: number;
  readonly message?: string;
} {
  const bal = costMeterGetState().balance as {
    status?: string;
    currency?: string;
    totalBalance?: number;
    fetchedAt?: number;
    message?: string;
  };
  const status =
    bal.status === "ok" || bal.status === "err" || bal.status === "off"
      ? bal.status
      : "off";
  return {
    status,
    currency:
      typeof bal.currency === "string" && bal.currency.trim()
        ? bal.currency
        : "CNY",
    totalBalance:
      typeof bal.totalBalance === "number" && Number.isFinite(bal.totalBalance)
        ? bal.totalBalance
        : 0,
    fetchedAt:
      typeof bal.fetchedAt === "number" && Number.isFinite(bal.fetchedAt)
        ? bal.fetchedAt
        : 0,
    ...(typeof bal.message === "string" && bal.message
      ? { message: bal.message }
      : {}),
  };
}

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
    async getOfficialBalance() {
      return balanceFromCostMeterState();
    },
    async refreshOfficialBalance() {
      await costMeterRefreshBalance();
      return balanceFromCostMeterState();
    },
  };
}
