/**
 * DSH Host feature bridges — unit tests (no network).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyAutoReviewHeuristic,
  analyzeImageBuffer,
  renderGenuiFromSchema,
  runModsearchQuery,
  searchNoemaMemories,
  validateImConnector,
} from "../src/dsh-compat/host-feature-bridge.js";
import {
  beginImProvision,
  pollImProvision,
} from "../src/dsh-compat/im-provision-bridge.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("host-feature-bridge", () => {
  it("runs local workspace search fallback", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-bridge-ws-"));
    temps.push(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "needle.ts"),
      "export const BRIDGE_NEEDLE = true;\n",
    );
    const res = await runModsearchQuery("BRIDGE_NEEDLE", {
      workspaceRoot: root,
      engine: "local",
    });
    expect(res.ok).toBe(true);
    expect((res.results as unknown[]).length).toBeGreaterThan(0);
  });

  it("renders genui schema tree preview", () => {
    const out = renderGenuiFromSchema({
      type: "card",
      title: "Hello",
      body: { type: "text", value: "world" },
    });
    expect(out.preview).toContain("card");
    expect(out.preview).toContain("title");
    expect(out.html).toContain("data-xrk-genui-preview");
    expect(out.html).toContain("Hello");
    expect(out.reactTree.type).toBe("Card");
    expect(out.live).toBe(true);
  });

  it("analyzes png image buffers", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
      0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x08, 0x06,
    ]);
    const analysis = analyzeImageBuffer(png);
    expect(analysis.format).toBe("png");
    expect(analysis.width).toBe(2);
    expect(analysis.height).toBe(3);
  });

  it("searches noema memories by keyword", () => {
    const hits = searchNoemaMemories(
      [
        { id: "1", text: "XRK harness bridge", tags: ["docs"] },
        { id: "2", text: "unrelated", tags: [] },
      ],
      "harness",
    );
    expect(hits[0]?.id).toBe("1");
  });

  it("classifies auto-review heuristically", () => {
    const deny = classifyAutoReviewHeuristic({
      toolName: "shell",
      args: { cmd: "rm -rf /" },
    });
    expect(deny.verdict).toBe("deny");
    const allow = classifyAutoReviewHeuristic({
      toolName: "read_file",
      args: { path: "README.md" },
    });
    expect(allow.verdict).toBe("allow");
  });

  it("validates IM connector fields", () => {
    expect(validateImConnector({ appId: "wx-1" }).ok).toBe(true);
    expect(validateImConnector(undefined).ok).toBe(false);
  });

  it("runs IM provision begin and poll with authCode", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-prov-"));
    temps.push(home);
    const begin = beginImProvision(home, "weixin", {
      botId: "bot-1",
      connector: { appId: "wx-app", redirectUri: "http://127.0.0.1/cb" },
    });
    expect(begin.ok).toBe(true);
    const provisionId = String(begin.provisionId);
    const pending = pollImProvision(home, "weixin", { provisionId });
    expect(pending.status).toBe("pending");
    const done = pollImProvision(home, "weixin", {
      provisionId,
      authCode: "code-123",
    });
    expect(done.status).toBe("completed");
    expect((done.tokens as { authCode?: string }).authCode).toBe("code-123");
  });
});
