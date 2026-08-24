import { describe, expect, it } from "vitest";
import { createXrkWalletPort } from "../src/dsh-compat/underlying/wallet-service.js";
import type { WalletFaceBridge } from "../src/dsh-compat/underlying/contracts/wallet-port.js";

function faceStub(
  balance: {
    status: "ok" | "err" | "off";
    currency: string;
    totalBalance: number;
    fetchedAt?: number;
  },
): WalletFaceBridge {
  return {
    async getSessionCost() {
      return null;
    },
    async getUsageTimeline() {
      return {
        today: { date: "2026-08-24", cost: 0.15 },
        days: [],
        ready: true,
        degraded: false,
      };
    },
    async getOfficialBalance() {
      return balance;
    },
    async refreshOfficialBalance() {
      return { ...balance, status: "ok", totalBalance: 42.5, fetchedAt: 1 };
    },
  };
}

describe("wallet balance from cost-meter face", () => {
  it("surfaces official balance when cost-meter cache is ok", async () => {
    const port = createXrkWalletPort({
      face: faceStub({
        status: "ok",
        currency: "CNY",
        totalBalance: 12.34,
        fetchedAt: Date.now(),
      }),
    });
    const view = await port.getBalanceView();
    expect(view.available).toBe(true);
    expect(view.total).toBe(12.34);
    expect(view.currency).toBe("CNY");
    expect((view as { incomplete?: string[] }).incomplete).toBeUndefined();
  });

  it("refreshes once when cache is still off", async () => {
    const port = createXrkWalletPort({
      face: faceStub({
        status: "off",
        currency: "CNY",
        totalBalance: 0,
        fetchedAt: 0,
      }),
    });
    const view = await port.getBalanceView();
    expect(view.total).toBe(42.5);
  });

  it("refreshBalanceView forces official refresh", async () => {
    const port = createXrkWalletPort({
      face: faceStub({
        status: "err",
        currency: "CNY",
        totalBalance: 0,
        fetchedAt: 1,
      }),
    });
    const view = await port.refreshBalanceView();
    expect(view.total).toBe(42.5);
  });
});
