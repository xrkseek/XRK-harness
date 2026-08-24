/**
 * XRK wallet port ↔ community wallet client HTTP shapes.
 * Adapter forwards; bridge maps fields; service persists + Face data.
 */

/** Community wallet client `GET /wallet/api/balance`. */
export interface DshWalletBalanceView {
  readonly available?: boolean;
  readonly error?: string;
  readonly currency?: string;
  readonly total?: number;
  readonly balances?: ReadonlyArray<{ currency: string; total: number }>;
  readonly low?: ReadonlyArray<{ currency: string; total: number }>;
}

/** Community wallet client `GET /wallet/api/cost`. */
export interface DshWalletCostView {
  readonly ok: boolean;
  readonly cost?: number;
  readonly costThreshold?: number;
  readonly uncachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly breakdown?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
  };
  readonly band?: "base" | "peak" | "offPeak";
  readonly sessionId?: string;
}

/** Community wallet client `GET /wallet/api/usage`. */
export interface DshWalletUsageView {
  readonly ok: boolean;
  readonly ready?: boolean;
  readonly degraded?: boolean;
  readonly today?: { readonly date: string; readonly cost: number };
  readonly days?: ReadonlyArray<{ readonly date: string; readonly cost: number }>;
}

/** Face / cost-meter injection — XRK source of truth (shape-agnostic). */
export interface WalletFaceBridge {
  getSessionCost(
    sessionId?: string,
  ): Promise<{
    readonly uncachedInputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly costCny: number;
    readonly breakdownCny: {
      readonly input: number;
      readonly output: number;
      readonly cacheRead: number;
    };
  } | null>;
  getUsageTimeline(): Promise<{
    readonly today: { readonly date: string; readonly cost: number };
    readonly days: ReadonlyArray<{ readonly date: string; readonly cost: number }>;
    readonly ready: boolean;
    readonly degraded: boolean;
  }>;
  /** Official balance cache from cost-meter (e.g. DeepSeek `/user/balance`). */
  getOfficialBalance(): Promise<{
    readonly status: "ok" | "err" | "off";
    readonly currency: string;
    readonly totalBalance: number;
    readonly fetchedAt?: number;
    readonly message?: string;
  } | null>;
  /** Refresh official balance and return the latest cache. */
  refreshOfficialBalance(): Promise<{
    readonly status: "ok" | "err" | "off";
    readonly currency: string;
    readonly totalBalance: number;
    readonly fetchedAt?: number;
    readonly message?: string;
  } | null>;
}

/** XRK wallet port — HTTP adapter calls only this interface. */
export interface XrkWalletPort {
  getBalanceView(): Promise<DshWalletBalanceView>;
  /** Refresh official balance cache, then read (wallet refresh button). */
  refreshBalanceView(): Promise<DshWalletBalanceView>;
  getCostView(sessionId?: string): Promise<DshWalletCostView>;
  getUsageView(): Promise<DshWalletUsageView>;
  setCostThreshold(threshold: number): Promise<number>;
  getSnapshot(): Promise<Record<string, unknown>>;
  listAccounts(): Promise<readonly WalletAccountRow[]>;
  addAccount(input: {
    label?: string;
    provider?: string;
    balance?: number | null;
    currency?: string;
  }): Promise<WalletAccountRow>;
  updateAccount(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<WalletAccountRow | undefined>;
  removeAccount(id: string): Promise<void>;
}

export interface WalletAccountRow {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly balance: number | null;
  readonly currency: string;
  readonly updatedAt: string;
}

export interface WalletPersistedState {
  threshold: number | null;
  pricingWindows: unknown[];
  accounts: WalletAccountRow[];
}
