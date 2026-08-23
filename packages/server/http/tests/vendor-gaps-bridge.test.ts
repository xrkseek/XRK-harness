/**
 * Vendor gap bridges — IM messaging, TongFlow runtime, GenUI React, vision OCR.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderGenuiFromSchema,
  analyzeVisionImage,
} from "../src/dsh-compat/host-feature-bridge.js";
import {
  ingestImWebhook,
  listImMessages,
  sendImMessage,
} from "../src/dsh-compat/im-messaging-bridge.js";
import { executeTongflowNode } from "../src/dsh-compat/tongflow-node-runtime.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("vendor gap bridges", () => {
  it("sends and lists IM messages via bridge", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-msg-"));
    temps.push(home);
    const sent = sendImMessage(home, "weixin", {
      botId: "bot-1",
      text: "hello bridge",
    });
    expect(sent.ok).toBe(true);
    ingestImWebhook(home, "weixin", { text: "inbound ping" }, "bot-1");
    const list = listImMessages(home, "weixin", { botId: "bot-1" });
    expect((list.messages as unknown[]).length).toBe(2);
  });

  it("executes tongflow builtin nodes", () => {
    const echo = executeTongflowNode("echo", { text: "ping" });
    expect(echo.ok).toBe(true);
    expect(echo.data).toBe("ping");
    const tpl = executeTongflowNode("text.template", {
      template: "hi {{name}}",
      vars: { name: "xrk" },
    });
    expect(tpl.data).toBe("hi xrk");
  });

  it("renders genui react tree", () => {
    const out = renderGenuiFromSchema({
      type: "card",
      title: "Title",
      children: [{ type: "text", value: "body" }],
    });
    expect(out.live).toBe(true);
    expect(out.reactTree.type).toBe("Card");
    expect(out.componentRegistry.length).toBeGreaterThan(0);
  });

  it("analyzes vision image with ocr heuristic", () => {
    const buf = Buffer.from("plain-text-HELLO-XRK-END", "utf8");
    const out = analyzeVisionImage(buf);
    expect(out.analyzed).toBe(true);
    expect(out.ocrText).toContain("HELLO");
  });
});
