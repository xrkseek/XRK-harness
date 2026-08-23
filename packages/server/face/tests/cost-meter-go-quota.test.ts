import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureCostMeterHome,
  costMeterGetState,
  costMeterRefreshGoQuota,
  costMeterResetHistory,
} from "../src/cost-meter-store.js";
import { queryGoQuota } from "../src/cost-meter-go-quota.js";

describe("cost-meter go quota", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureCostMeterHome(undefined);
  });

  it("queryGoQuota surfaces HTTP errors for invalid key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    const home = mkdtempSync(path.join(tmpdir(), "xrk-go-http-"));
    const snapshot = await queryGoQuota(home, { apiKey: "bad-key" });
    expect(snapshot.status).toBe("err");
    expect(snapshot.message).toContain("403");
  });

  it("refreshGoQuota calls OpenCode API and persists cache", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-go-"));
    configureCostMeterHome(home);
    costMeterResetHistory();
    writeFileSync(
      path.join(home, ".credentials.yaml"),
      "OPENCODE_GO_API_KEY: go-test-key\n",
      "utf8",
    );

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        usage: {
          rolling: { percent: 42, resetsAt: "2026-08-23T12:00:00Z" },
          weekly: { percent: 10, resetsAt: "2026-08-24T00:00:00Z" },
          monthly: { percent: 5, resetsAt: "2026-09-01T00:00:00Z" },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await costMeterRefreshGoQuota();
    expect(result.ok).toBe(true);
    expect(result.state.goQuota.rolling).toEqual({
      percent: 42,
      resetsAt: "2026-08-23T12:00:00Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer go-test-key",
        }),
      }),
    );

    const cached = costMeterGetState();
    expect(cached.goQuota.status).toBe("ok");
    expect(cached.goQuota.fetchedAt).toBeGreaterThan(0);
  });
});
