/** Plan / Office preview loaders read existing RPC envelopes and nothing else. */
import { describe, expect, it, vi } from "vitest";
import {
  loadPreviewTabs,
  parseOfficePreview,
  parsePlanPreview,
} from "../src/client/preview-load.ts";

describe("preview tab envelopes", () => {
  it("reads plan.preview and office status and rejects other bodies", () => {
    expect(
      parsePlanPreview({ ok: true, value: { active: true, pending: false } }),
    ).toEqual({ active: true, pending: false });
    expect(parsePlanPreview({ ok: false })).toBeNull();
    expect(
      parseOfficePreview({
        result: { ok: true, value: { configured: true, connected: false } },
      }),
    ).toEqual({ configured: true, connected: false });
    expect(
      parseOfficePreview({ result: { ok: true, value: { state: "idle" } } }),
    ).toBeNull();
  });

  it("loads both endpoints and keeps a tab when the other request fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("plan.preview")) {
        return new Response(
          JSON.stringify({ ok: true, value: { active: false, pending: true } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("office down");
    });
    const loaded = await loadPreviewTabs("s1", fetchImpl);
    expect(loaded.plan).toEqual({ active: false, pending: true });
    expect(loaded.office).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const planCall = fetchImpl.mock.calls[0];
    expect(String(planCall?.[0])).toBe("/sidebar/api/plan.preview");
    expect(JSON.parse(String(planCall?.[1]?.body))).toEqual({ sessionId: "s1" });
    const officeCall = fetchImpl.mock.calls[1];
    expect(String(officeCall?.[0])).toBe("/office/connection.status");
  });
});
