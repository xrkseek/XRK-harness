/**
 * Attachment handle text is written into the log so the model can address an
 * image/file by id, but a reader must never see it. One place, both rules:
 * `flattenText` (model) keeps it, `readerText` (human) drops it.
 */
import { describe, expect, it } from "vitest";
import {
  fileUploadHandleBlock,
  flattenText,
  imageHandleBlock,
  isContentBlock,
  isModelOnlyText,
  parseSessionEvent,
  readerText,
  type ImageAttachmentRef,
} from "../src/index.ts";

const image: ImageAttachmentRef = {
  attachmentId: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  mediaType: "image/png",
  bytes: 2047,
  width: 2048,
  height: 1222,
};

describe("modelOnly handle text", () => {
  it("reaches the model and stays out of reader text", () => {
    const blocks = [
      { type: "text" as const, text: "看看这张" },
      imageHandleBlock(1, image),
      { type: "image" as const, attachment: image },
    ];
    const model = flattenText(blocks);
    expect(model).toContain("看看这张");
    expect(model).toContain(image.attachmentId);
    expect(model).toContain("read_image");
    expect(readerText(blocks)).toBe("看看这张");
  });

  it("marks the file handle block the same way", () => {
    const block = fileUploadHandleBlock({
      attachmentId: "sha256:beef",
      name: "notes.txt",
      bytes: 3,
    });
    expect(isModelOnlyText(block)).toBe(true);
    expect(readerText([block])).toBe("");
  });

  it("survives the durable event parse round trip", () => {
    const ev = parseSessionEvent({
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: [imageHandleBlock(1, image), { type: "image", attachment: image }],
    });
    if (ev.type !== "user/message" || typeof ev.content === "string") {
      throw new Error("narrow");
    }
    expect(ev.content.every(isContentBlock)).toBe(true);
    expect(isModelOnlyText(ev.content[0]!)).toBe(true);
    expect(readerText(ev.content)).toBe("");
  });
});