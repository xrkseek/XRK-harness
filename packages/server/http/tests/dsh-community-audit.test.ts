import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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

  it("classifies nested community slug API paths as community-root", () => {
    expect(classifyCommunityHttpPath("/dsh-whale-girl/api/state")).toBe(
      "community-root",
    );
    expect(classifyCommunityHttpPath("/dsh-whale-girl/whale-girl.png")).toBe(
      "community-root",
    );
    expect(classifyCommunityHttpPath("/api/dsh-context/balance")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/api/mobile-access")).toBe("capability");
    expect(
      classifyCommunityHttpPath(
        "/skin-assets/maid-atelier/405917afdb68d725624bbf7e4f1619a35fc4004039b7d553c5528ca5f65308d3.webp",
      ),
    ).toBe("capability");
    expect(classifyCommunityHttpPath("/api/dsh/skins")).toBe("capability");
    expect(classifyCommunityHttpPath("/api/skin-center/v2/catalog")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/api/skin-manager/list")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/api/pet/state")).toBe("capability");
    expect(classifyCommunityHttpPath("/univer-api/status")).toBe("capability");
    expect(classifyCommunityHttpPath("/api/michengai/dsh-archive-manager/update")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/api/billing/usage-stats")).toBe("capability");
    expect(classifyCommunityHttpPath("/mcp-connector/api")).toBe("capability");
    expect(classifyCommunityHttpPath("/code-server/status")).toBe("capability");
    expect(classifyCommunityHttpPath("/token-usage-stats")).toBe("capability");
    expect(classifyCommunityHttpPath("/plugins/dsh-agent-teams/state")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/wallpaper-engine/inventory")).toBe(
      "capability",
    );
    expect(classifyCommunityHttpPath("/api-import/sessions")).toBe("capability");
  });

  it("marks dreamSkin seats as shell-seat for skin Settings cards", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-audit-dream-skin-"));
    temps.push(root);
    writeFileSync(
      path.join(root, "client.js"),
      `
      ctx.slots.register({ name: "settings.section", id: "dream" }, Dream);
      ctx.slots.register({ name: "settings.dreamSkin.item", id: "row" }, Row);
      ctx.slots.register({ name: "settings.undo.item", id: "undo" }, Undo);
    `,
    );
    const audit = auditCommunityClientSurface(root);
    expect(audit.seatCoverage["settings.dreamSkin.item"]).toBe("shell-seat");
    expect(audit.seatCoverage["settings.undo.item"]).toBe("shell-seat");
  });

  it("marks product conversation/sidebar contribution seats as shell-seat", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-audit-shell-seats-"));
    temps.push(root);
    writeFileSync(
      path.join(root, "client.js"),
      `
      ctx.slots.register({ name: "conversation.chat.turnTail", id: "x" }, X);
      ctx.slots.register({ name: "sidebar.footer.action", id: "y" }, Y);
      ctx.slots.register({ name: "conversation.session.header.actions", id: "z" }, Z);
      ctx.slots.register({ name: "sidebar.panellist", id: "panel" }, Panel);
    `,
    );
    const audit = auditCommunityClientSurface(root);
    expect(audit.seatCoverage["conversation.chat.turnTail"]).toBe("shell-seat");
    expect(audit.seatCoverage["sidebar.footer.action"]).toBe("shell-seat");
    expect(audit.seatCoverage["conversation.session.header.actions"]).toBe(
      "shell-seat",
    );
    expect(audit.seatCoverage["sidebar.panellist"]).toBe("missing-seat");
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
