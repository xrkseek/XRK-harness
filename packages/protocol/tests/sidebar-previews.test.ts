import { describe, expect, it } from "vitest";
import {
  OFFICE_HARNESS_PROTOCOL,
  SIDEBAR_PREVIEW_RPC,
  SUBAGENT_PREVIEW_TEXT_MAX,
  type BrowserEmbedProbe,
  type OfficePreviewStatus,
  type PlanPreviewSummary,
  type SubagentPreviewSummary,
} from "../src/sidebar-previews.js";

describe("sidebar-previews contract", () => {
  it("exports stable RPC names and caps", () => {
    expect(SIDEBAR_PREVIEW_RPC.browserProbe).toBe("browser.probe");
    expect(SIDEBAR_PREVIEW_RPC.subagentsPreview).toBe("subagents.preview");
    expect(SIDEBAR_PREVIEW_RPC.planPreview).toBe("plan.preview");
    expect(SIDEBAR_PREVIEW_RPC.officeConnectionStatus).toBe(
      "office/connection.status",
    );
    expect(OFFICE_HARNESS_PROTOCOL).toBe("office-harness.v1");
    expect(SUBAGENT_PREVIEW_TEXT_MAX).toBe(512);
  });

  it("accepts typed preview payloads", () => {
    const probe: BrowserEmbedProbe = {
      url: "https://example.com",
      reachable: true,
      supported: true,
    };
    const sub: SubagentPreviewSummary = {
      childSessionId: "child-1",
      mode: "continuable",
      activity: "running",
      live: { text: "working" },
    };
    const plan: PlanPreviewSummary = { active: true, pending: false };
    const office: OfficePreviewStatus = {
      protocolVersion: OFFICE_HARNESS_PROTOCOL,
      configured: false,
      connected: false,
      state: "unconfigured",
    };
    expect(probe.supported).toBe(true);
    expect(sub.mode).toBe("continuable");
    expect(plan.active).toBe(true);
    expect(office.protocolVersion).toBe(OFFICE_HARNESS_PROTOCOL);
  });
});
