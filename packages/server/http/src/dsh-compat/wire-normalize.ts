/**
 * Flatten Host wire context (`tokenLedger.*`) into DSH compat options.
 * Prewarm and HTTP handlers must share the same shape — registry cache keys
 * ignore bridge fields, so nested vs flat must not diverge.
 */
import type { DshCompatWireOptions } from "./adapter-types.js";

export function normalizeDshCompatWireCtx(
  ctx: DshCompatWireOptions & {
    readonly tokenLedger?: {
      readonly aggregateUsage?: DshCompatWireOptions["aggregateUsage"];
      readonly fetchBalance?: DshCompatWireOptions["fetchBalance"];
      readonly listUsageProviders?: DshCompatWireOptions["listUsageProviders"];
    };
    readonly harnessConnector?: {
      readonly onJobAccepted?: DshCompatWireOptions["onJobAccepted"];
    };
  },
): DshCompatWireOptions {
  const nested = ctx.tokenLedger;
  const aggregateUsage = ctx.aggregateUsage ?? nested?.aggregateUsage;
  const fetchBalance = ctx.fetchBalance ?? nested?.fetchBalance;
  const listUsageProviders =
    ctx.listUsageProviders ?? nested?.listUsageProviders;
  const onJobAccepted =
    ctx.onJobAccepted ?? ctx.harnessConnector?.onJobAccepted;

  return {
    ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
    ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
    ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
    ...(ctx.defaultCwd ? { defaultCwd: ctx.defaultCwd } : {}),
    ...(ctx.resolveSessionCwd
      ? { resolveSessionCwd: ctx.resolveSessionCwd }
      : {}),
    ...(aggregateUsage ? { aggregateUsage } : {}),
    ...(fetchBalance ? { fetchBalance } : {}),
    ...(listUsageProviders ? { listUsageProviders } : {}),
    ...(onJobAccepted ? { onJobAccepted } : {}),
    ...(ctx.walletPort ? { walletPort: ctx.walletPort } : {}),
    ...(ctx.face ? { face: ctx.face } : {}),
    ...(ctx.sidebarFace ? { sidebarFace: ctx.sidebarFace } : {}),
  };
}
