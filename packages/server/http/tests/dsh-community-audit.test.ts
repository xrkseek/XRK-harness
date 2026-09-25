import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditCommunityClientSurface,
  classifyCommunityHttpPath,
} from "../src/dsh-compat/audit-community-client.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("audit-community-client", () => {
  it("classifies wallet native API paths via capability table", () => {
    expect(classifyCommunityHttpPath("/wallet/api/balance")).toBe("capability");
    expect(classifyCommunityHttpPath("/wallet/api/set-threshold")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/api/wallet/snapshot")).toBe("capability");
  });

  it("classifies Host-native /sidebar/* as host-sidebar (not missing)", () => {
    expect(classifyCommunityHttpPath("/sidebar/api")).toBe("host-sidebar");
    expect(classifyCommunityHttpPath("/sidebar/upload")).toBe("host-sidebar");
    expect(classifyCommunityHttpPath("/sidebar/ws/agent-opens")).toBe(
      "host-sidebar",
    );
  });

  it("classifies npm registry /{pkg}/latest probes as npm-registry (not Host gaps)", () => {
    expect(classifyCommunityHttpPath("/dsh-context/latest")).toBe(
      "npm-registry",
    );
    expect(classifyCommunityHttpPath("/latest")).not.toBe("npm-registry");
  });

  it("flags unknown HTTP paths from client.js scan", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-audit-"));
    temps.push(root);
    writeFileSync(
      path.join(root, "client.js"),
      `
      fetch("/wallet/api/balance");
      fetch("/wallet/api/cost?session=s1");
      fetch("/sidebar/api/fs.tree");
      fetch("/dsh-context/latest");
      fetch("/api/dsh-genui/prompt");
      fetch("/dsh-genui/runtime.js");
      fetch("/totally-unknown/custom-api");
    `,
    );
    const audit = auditCommunityClientSurface(root);
    expect(audit.missingHttp).toEqual(["/totally-unknown/custom-api"]);
    expect(audit.coverage["/wallet/api/balance"]).toBe("capability");
    expect(audit.coverage["/sidebar/api/fs.tree"]).toBe("host-sidebar");
    expect(audit.coverage["/dsh-context/latest"]).toBe("npm-registry");
    expect(audit.coverage["/api/dsh-genui/prompt"]).toBe("capability");
    expect(audit.coverage["/dsh-genui/runtime.js"]).toBe("capability");
  });

  it("surfaces DSH 0.1.5+ global-panel seats as honest missing-seat gaps", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-audit-seats-"));
    temps.push(root);
    writeFileSync(
      path.join(root, "client.js"),
      `
      ctx.slots.register({ name: "sidebar.panellist", id: "wallet-panel" }, WalletPanel);
      ctx.slots.register({ name: "main.conversation", id: "conv-embed" }, ConvEmbed);
      ctx.slots.register({ name: "shell.overlay", id: "toast" }, Toast);
      slots.register({ name: "sidebar" }, Sidebar);
    `,
    );
    const audit = auditCommunityClientSurface(root);
    expect(audit.slotSeats).toEqual([
      "main.conversation",
      "shell.overlay",
      "sidebar",
      "sidebar.panellist",
    ]);
    expect(audit.seatCoverage["sidebar.panellist"]).toBe("missing-seat");
    expect(audit.seatCoverage["main.conversation"]).toBe("missing-seat");
    expect(audit.seatCoverage["shell.overlay"]).toBe("shell-seat");
    expect(audit.seatCoverage["sidebar"]).toBe("shell-seat");
    expect(audit.missingSeats).toEqual([
      "main.conversation",
      "sidebar.panellist",
    ]);
  });
});
