/**
 * XRK wallet service: persistence + optional Face bridge → community HTTP shapes.
 */
import { randomUUID } from "node:crypto";
import { honestReady } from "../honest-envelope.js";
import { tag } from "../meta.js";
import { createXrkDocStore } from "./doc-store.js";
import type {
  DshWalletBalanceView,
  DshWalletCostView,
  DshWalletUsageView,
  WalletAccountRow,
  WalletFaceBridge,
  WalletPersistedState,
  XrkWalletPort,
} from "./contracts/wallet-port.js";

const EMPTY: WalletPersistedState = {
  threshold: null,
  pricingWindows: [],
  accounts: [],
};

const WALLET_STORE = createXrkDocStore<WalletPersistedState>(
  ["wallet", "state.json"],
  EMPTY,
);

function loadState(xrkHome?: string): WalletPersistedState {
  const data = WALLET_STORE.read(xrkHome).data;
  return {
    threshold: data.threshold ?? null,
    pricingWindows: Array.isArray(data.pricingWindows) ? data.pricingWindows : [],
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
  };
}

function defaultThreshold(state: WalletPersistedState): number {
  return typeof state.threshold === "number" ? state.threshold : 5;
}

/** Process-local calendar day (aligned with Face cost-meter dayKey). */
function localDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function splitCostBreakdown(
  costCny: number,
  input: number,
  output: number,
  cacheRead: number,
): { input: number; output: number; cacheRead: number } {
  const total = input + output + cacheRead;
  if (total <= 0 || costCny <= 0) {
    return { input: 0, output: 0, cacheRead: 0 };
  }
  return {
    input: (costCny * input) / total,
    output: (costCny * output) / total,
    cacheRead: (costCny * cacheRead) / total,
  };
}

export interface XrkWalletServiceOptions {
  readonly xrkHome?: string;
  readonly face?: WalletFaceBridge;
}

export function createXrkWalletPort(
  options: XrkWalletServiceOptions,
): XrkWalletPort {
  const { xrkHome, face } = options;

  async function balanceFromFace(
    refresh: boolean,
  ): Promise<DshWalletBalanceView | null> {
    if (!face?.getOfficialBalance) return null;
    let snap = await face.getOfficialBalance();
    // First paint: cost-meter never queried → refresh once (not on every poll after err).
    if (
      !refresh &&
      snap &&
      (snap.status === "off" || !snap.fetchedAt)
    ) {
      snap = (await face.refreshOfficialBalance?.()) ?? snap;
    } else if (refresh) {
      snap = (await face.refreshOfficialBalance?.()) ?? snap;
    }
    if (!snap || snap.status !== "ok") return null;
    const currency = snap.currency || "CNY";
    const total = snap.totalBalance;
    return {
      available: true,
      currency,
      total,
      balances: [{ currency, total }],
      low: total < 10 ? [{ currency, total }] : [],
      ...honestReady(),
    };
  }

  return {
    async getBalanceView(): Promise<DshWalletBalanceView> {
      const state = loadState(xrkHome);
      const manual = state.accounts.filter((a) => typeof a.balance === "number");
      if (manual.length > 0) {
        const currency = manual[0]?.currency ?? "CNY";
        const total = manual.reduce((sum, row) => sum + (row.balance ?? 0), 0);
        return {
          available: true,
          currency,
          total,
          balances: manual.map((row) => ({
            currency: row.currency,
            total: row.balance ?? 0,
          })),
          low: total < 10 ? [{ currency, total }] : [],
          ...honestReady(),
        };
      }
      const fromMeter = await balanceFromFace(false);
      if (fromMeter) return fromMeter;
      return tag(
        {
          available: true,
          currency: "CNY",
          total: 0,
          balances: [{ currency: "CNY", total: 0 }],
          low: [],
          note: "DeepSeek balance not cached yet — open cost-meter or hit wallet refresh; session cost still comes from cost-meter.",
          ...honestReady(),
        },
        ["wallet-host"],
      );
    },

    async refreshBalanceView(): Promise<DshWalletBalanceView> {
      const state = loadState(xrkHome);
      const manual = state.accounts.filter((a) => typeof a.balance === "number");
      if (manual.length > 0) {
        const currency = manual[0]?.currency ?? "CNY";
        const total = manual.reduce((sum, row) => sum + (row.balance ?? 0), 0);
        return {
          available: true,
          currency,
          total,
          balances: manual.map((row) => ({
            currency: row.currency,
            total: row.balance ?? 0,
          })),
          low: total < 10 ? [{ currency, total }] : [],
          ...honestReady(),
        };
      }
      const fromMeter = await balanceFromFace(true);
      if (fromMeter) return fromMeter;
      return tag(
        {
          available: true,
          currency: "CNY",
          total: 0,
          balances: [{ currency: "CNY", total: 0 }],
          low: [],
          note: "DeepSeek balance not cached yet — open cost-meter or hit wallet refresh; session cost still comes from cost-meter.",
          ...honestReady(),
        },
        ["wallet-host"],
      );
    },

    async getCostView(sessionId?: string): Promise<DshWalletCostView> {
      const state = loadState(xrkHome);
      const threshold = defaultThreshold(state);
      const fromFace = face ? await face.getSessionCost(sessionId) : null;
      if (fromFace) {
        return {
          ok: true,
          cost: fromFace.costCny,
          costThreshold: threshold,
          uncachedInputTokens: fromFace.uncachedInputTokens,
          outputTokens: fromFace.outputTokens,
          cacheReadTokens: fromFace.cacheReadTokens,
          breakdown: fromFace.breakdownCny,
          band: "base" as const,
          ...(sessionId ? { sessionId } : {}),
          ...honestReady(),
        };
      }
      return tag(
        {
          ok: true,
          cost: 0,
          costThreshold: threshold,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          breakdown: { input: 0, output: 0, cacheRead: 0 },
          band: "base" as const,
          ...(sessionId ? { sessionId } : {}),
          note: "No cost-meter session row yet; usage records as turns complete.",
          ...honestReady(),
        },
        ["wallet-host"],
      );
    },

    async getUsageView(): Promise<DshWalletUsageView> {
      const timeline = face
        ? await face.getUsageTimeline()
        : {
            today: { date: localDayKey(), cost: 0 },
            days: [],
            ready: false,
            degraded: true,
          };
      return tag(
        {
          ok: true,
          ready: timeline.ready,
          degraded: timeline.degraded,
          today: timeline.today,
          days: timeline.days,
          ...honestReady(),
        },
        timeline.degraded ? ["wallet-host"] : undefined,
      );
    },

    async setCostThreshold(threshold: number): Promise<number> {
      const saved = WALLET_STORE.patch(xrkHome, (current: WalletPersistedState) => ({
        ...current,
        threshold,
      }));
      return defaultThreshold(saved.data);
    },

    async getSnapshot(): Promise<Record<string, unknown>> {
      const doc = WALLET_STORE.read(xrkHome);
      return {
        ok: true,
        threshold: doc.data.threshold,
        pricingWindows: doc.data.pricingWindows,
        accounts: doc.data.accounts,
        revision: doc.revision,
        adapter: "xrk-dsh-compat",
        ...honestReady(),
      };
    },

    async listAccounts(): Promise<readonly WalletAccountRow[]> {
      return loadState(xrkHome).accounts;
    },

    async addAccount(input): Promise<WalletAccountRow> {
      const account: WalletAccountRow = {
        id: randomUUID(),
        label: input.label ?? "account",
        provider: input.provider ?? "manual",
        balance: typeof input.balance === "number" ? input.balance : null,
        currency: input.currency ?? "USD",
        updatedAt: new Date().toISOString(),
      };
      WALLET_STORE.patch(xrkHome, (current: WalletPersistedState) => ({
        ...current,
        accounts: [...current.accounts, account],
      }));
      return account;
    },

    async updateAccount(id, patch): Promise<WalletAccountRow | undefined> {
      let updated: WalletAccountRow | undefined;
      WALLET_STORE.patch(xrkHome, (current: WalletPersistedState) => ({
        ...current,
        accounts: current.accounts.map((row: WalletAccountRow) => {
          if (row.id !== id) return row;
          const next = { ...row };
          if (typeof patch.label === "string") next.label = patch.label;
          if (typeof patch.provider === "string") next.provider = patch.provider;
          if (typeof patch.balance === "number" || patch.balance === null) {
            next.balance = patch.balance;
          }
          next.updatedAt = new Date().toISOString();
          updated = next;
          return next;
        }),
      }));
      return updated;
    },

    async removeAccount(id: string): Promise<void> {
      WALLET_STORE.patch(xrkHome, (current: WalletPersistedState) => ({
        ...current,
        accounts: current.accounts.filter((a: WalletAccountRow) => a.id !== id),
      }));
    },
  };
}

/** Map Face session totals into CNY breakdown for dsh-wallet. */
export function mapSessionCostToDsh(
  totals: {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  },
  exchangeRate: number,
): {
  costCny: number;
  breakdownCny: { input: number; output: number; cacheRead: number };
} {
  const costCny = totals.costUsd * exchangeRate;
  return {
    costCny,
    breakdownCny: splitCostBreakdown(
      costCny,
      totals.uncachedInputTokens,
      totals.outputTokens,
      totals.cacheReadTokens,
    ),
  };
}
