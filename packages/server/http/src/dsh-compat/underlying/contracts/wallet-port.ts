/**
 * XRK 底层契约 ↔ DSH `dsh-wallet` client HTTP 外形。
 * Adapter 只转发；Bridge 做类型/字段映射；Service 持久化 + 组合 Face 数据。
 */

/** npm `dsh-wallet` client `GET /wallet/api/balance` */
export interface DshWalletBalanceView {
  readonly available?: boolean;
  readonly error?: string;
  readonly currency?: string;
  readonly total?: number;
  readonly balances?: ReadonlyArray<{ currency: string; total: number }>;
  readonly low?: ReadonlyArray<{ currency: string; total: number }>;
}

/** npm `dsh-wallet` client `GET /wallet/api/cost` */
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

/** npm `dsh-wallet` client `GET /wallet/api/usage` */
export interface DshWalletUsageView {
  readonly ok: boolean;
  readonly ready?: boolean;
  readonly degraded?: boolean;
  readonly today?: { readonly date: string; readonly cost: number };
  readonly days?: ReadonlyArray<{ readonly date: string; readonly cost: number }>;
}

/** Face / cost-meter 注入：XRK 真源，与 DSH 外形无关 */
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
}

/** XRK 钱包底层端口 — HTTP adapter 只调这个接口 */
export interface XrkWalletPort {
  getBalanceView(): Promise<DshWalletBalanceView>;
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
