import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inferDshCommunityHostManifest,
  isDshCommunityClientPackage,
  isDshCommunityPackageName,
} from "../src/dsh-compat/dsh-community-infer.js";
import {
  httpCapabilityForPath,
  listDshHttpCapabilityPrefixes,
} from "../src/dsh-compat/dsh-path-capabilities.js";
import { scanClientHostSurface } from "../src/dsh-compat/dsh-client-scan.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("dsh-community-infer", () => {
  it("detects DSH package names", () => {
    expect(isDshCommunityPackageName("dsh-poison-guard")).toBe(true);
    expect(isDshCommunityPackageName("@huanlin/dsh-plugin-spur")).toBe(true);
    expect(isDshCommunityPackageName("vision-router")).toBe(true);
    expect(isDshCommunityPackageName("@xrkseek/my-tool")).toBe(false);
  });

  it("prefers explicit xrk client over DSH name heuristic", () => {
    expect(
      isDshCommunityClientPackage("@xrkseek/foo", {
        xrkseek: { client: { inject: [] } },
      }),
    ).toBe(false);
    expect(
      isDshCommunityClientPackage("dsh-foo", {
        dsh: { client: { inject: [] } },
      }),
    ).toBe(true);
  });

  it("maps standard HTTP paths to capability providers (not per-package presets)", () => {
    expect(httpCapabilityForPath("/api/wallet/snapshot")?.provider).toBe(
      "xrk-wallet",
    );
    expect(httpCapabilityForPath("/sidebar/api/fs.tree")?.provider).toBe(
      "xrk-sidebar",
    );
    expect(listDshHttpCapabilityPrefixes().length).toBeGreaterThan(10);
  });

  it("infers RPC + residual HTTP from client.js scan", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-scan-"));
    temps.push(root);
    writeFileSync(
      path.join(root, "client.js"),
      `
      fetch("/api/wallet/snapshot");
      fetch(\`/api/memento/entries\`);
      rpc("/dsh-poison-guard-settings/get");
      fetch("/_dsh/dsh-poison-guard/status");
    `,
    );
    const scanned = scanClientHostSurface(root);
    expect(scanned.httpPaths).toContain("/api/wallet/snapshot");
    expect(scanned.httpPaths).toContain("/api/memento/entries");
    expect(scanned.rpcChannels).toContain("/dsh-poison-guard-settings");

    const manifest = inferDshCommunityHostManifest(root, "dsh-poison-guard");
    expect(manifest.rpc?.some((r) => r.channel.includes("settings"))).toBe(
      true,
    );
    // `/_dsh/…` covered by global capability table — no per-package HTTP manifest.
    expect(manifest.http ?? []).toHaveLength(0);
    expect(httpCapabilityForPath("/_dsh/dsh-poison-guard/status")?.provider).toBe(
      "xrk-dsh-http",
    );
  });

  it("convention-infers mnemon channels without manifest", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-mn-"));
    temps.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "client.js"), "// minimal\n");
    const manifest = inferDshCommunityHostManifest(root, "dsh-mnemon");
    expect(
      manifest.rpc?.some((r) => r.channel === "/dsh-mnemon-settings"),
    ).toBe(true);
    expect(manifest.rpc?.find((r) => r.channel === "/dsh-mnemon-settings")?.provider).toBe(
      "xrk-mnemon",
    );
  });
});
