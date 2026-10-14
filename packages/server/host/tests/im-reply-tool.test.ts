/**
 * IM tool surface — im_send / im_binding + multimodal attachments + ports.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  bindImSession,
  listImMessages,
  normalizeImAttachments,
  type ImAttachment,
  type ImMessageRow,
} from "@xrkseek/server-http";
import {
  bindImTools,
  createImToolDefinitions,
  setImToolPorts,
} from "../src/im-reply-tool.js";
import { imInboundContentBlocks } from "../src/im-face-admit.js";

const temps: string[] = [];

afterEach(() => {
  setImToolPorts(undefined);
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bindImTools", () => {
  it("im_send posts to the bound channel; final concludesTurn", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-tool-"));
    temps.push(home);
    bindImSession(home, {
      chatKey: "mock:p:1",
      channel: "mock",
      sessionId: "im-sess",
    });
    const tools = createToolRegistry();
    bindImTools(tools, { sessionId: "im-sess", xrkHome: home });
    expect(tools.get("im_send")).toBeTruthy();
    expect(tools.get("im_reply")).toBeTruthy();
    expect(tools.get("im_binding")).toBeTruthy();

    const sent = await tools.get("im_send")!.execute({
      text: "hello im",
      final: true,
    });
    expect(sent.isError).toBeFalsy();
    expect(sent.concludesTurn).toBe(true);
    const list = listImMessages(home, "mock", { limit: 8 });
    const messages = list.messages as Array<{ text: string; direction: string }>;
    expect(
      messages.some((m) => m.text === "hello im" && m.direction === "outbound"),
    ).toBe(true);

    const binding = await tools.get("im_binding")!.execute({});
    expect(binding.isError).toBeFalsy();
    expect(String(binding.content)).toContain("mock:p:1");
  });

  it("im_send accepts image attachment + caption text", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-media-"));
    temps.push(home);
    bindImSession(home, {
      chatKey: "mock:p:media",
      channel: "mock",
      sessionId: "im-media",
    });
    const tools = createToolRegistry();
    bindImTools(tools, { sessionId: "im-media", xrkHome: home });
    const out = await tools.get("im_send")!.execute({
      text: "see this",
      attachments: [
        {
          kind: "image",
          url: "https://example.test/a.png",
          name: "a.png",
          mediaType: "image/png",
        },
      ],
    });
    expect(out.isError).toBeFalsy();
    const list = listImMessages(home, "mock", { limit: 4 });
    const row = (list.messages as ImMessageRow[]).find(
      (m) => m.direction === "outbound" && m.text === "see this",
    );
    expect(row?.attachments?.length).toBe(1);
    expect(row?.attachments?.[0]?.kind).toBe("image");
    expect(row?.attachments?.[0]?.url).toContain("a.png");
  });

  it("im_send allows media-only and rejects empty", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-mediaonly-"));
    temps.push(home);
    bindImSession(home, {
      chatKey: "mock:p:only",
      channel: "mock",
      sessionId: "im-only",
    });
    const tools = createToolRegistry();
    bindImTools(tools, { sessionId: "im-only", xrkHome: home });

    const empty = await tools.get("im_send")!.execute({});
    expect(empty.isError).toBe(true);

    const media = await tools.get("im_send")!.execute({
      attachments: [{ kind: "video", path: "/tmp/clip.mp4", name: "clip.mp4" }],
    });
    expect(media.isError).toBeFalsy();
    const list = listImMessages(home, "mock", { limit: 4 });
    const row = (list.messages as ImMessageRow[])[0];
    expect(row?.attachments?.[0]?.kind).toBe("video");
    expect(row?.text).toBe("");
  });

  it("im_send errors without a binding", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-tool-nobind-"));
    temps.push(home);
    const tools = createToolRegistry();
    bindImTools(tools, { sessionId: "orphan", xrkHome: home });
    const out = await tools.get("im_send")!.execute({ text: "x" });
    expect(out.isError).toBe(true);
  });

  it("setImToolPorts / mapTools / extraTools let AGT reshape the surface", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-ports-"));
    temps.push(home);
    const sent: Array<{ text: string; attachments?: readonly ImAttachment[] }> =
      [];
    setImToolPorts({
      lookupBinding: () => ({
        chatKey: "agt:g:9",
        sessionId: "im-agt",
        channel: "weixin",
        updatedAt: new Date().toISOString(),
      }),
      send: async (req) => {
        sent.push({
          text: req.text,
          ...(req.attachments ? { attachments: req.attachments } : {}),
        });
        return { ok: true, mode: "agt-reply" };
      },
    });
    const defs = createImToolDefinitions({
      sessionId: "im-agt",
      xrkHome: home,
      replyAlias: false,
      mapTools: (tools) =>
        tools.map((t) =>
          t.name === "im_send"
            ? { ...t, description: `${t.description} [agt]` }
            : t,
        ),
      extraTools: [
        {
          name: "im_vendor_ping",
          description: "AGT-only probe",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: "pong" }),
        },
      ],
    });
    expect(defs.some((t) => t.name === "im_reply")).toBe(false);
    expect(defs.find((t) => t.name === "im_send")?.description).toContain(
      "[agt]",
    );
    expect(defs.some((t) => t.name === "im_vendor_ping")).toBe(true);

    const tools = createToolRegistry();
    for (const t of defs) tools.register(t);
    const out = await tools.get("im_send")!.execute({
      text: "via-agt",
      attachments: [{ kind: "file", url: "https://example.test/x.pdf" }],
    });
    expect(out.isError).toBeFalsy();
    expect(sent[0]?.text).toBe("via-agt");
    expect(sent[0]?.attachments?.[0]?.kind).toBe("file");
    expect(String(out.content)).toContain("agt-reply");
  });
});

describe("normalizeImAttachments + admit blocks", () => {
  it("normalizes attachments array and vendor image_url", () => {
    expect(
      normalizeImAttachments({
        attachments: [{ kind: "audio", url: "https://x/a.ogg" }],
      }),
    ).toEqual([{ kind: "audio", url: "https://x/a.ogg" }]);
    expect(
      normalizeImAttachments({ image_url: "https://x/p.jpg" })[0],
    ).toMatchObject({ kind: "image", url: "https://x/p.jpg" });
  });

  it("imInboundContentBlocks emits modelOnly handles for url media", async () => {
    const blocks = await imInboundContentBlocks({
      id: "m1",
      channel: "mock",
      direction: "inbound",
      text: "photo for you",
      attachments: [
        {
          kind: "image",
          url: "https://example.test/p.png",
          name: "p.png",
        },
      ],
      createdAt: new Date().toISOString(),
    });
    expect(blocks.some((b) => b.type === "text" && b.text === "photo for you")).toBe(
      true,
    );
    const handle = blocks.find(
      (b) => b.type === "text" && b.modelOnly === true,
    );
    expect(handle?.type === "text" && handle.text).toContain("kind=image");
    expect(handle?.type === "text" && handle.text).toContain(
      "url=https://example.test/p.png",
    );
  });
});
