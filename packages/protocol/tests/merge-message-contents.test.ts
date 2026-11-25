import { describe, expect, it } from "vitest";
import {
  flattenText,
  mergeMessageContents,
  type ImageAttachmentRef,
} from "../src/index.ts";

const image = (id: string): ImageAttachmentRef => ({
  attachmentId: `sha256:${id}`,
  mediaType: "image/png",
  bytes: 12,
  width: 8,
  height: 8,
  name: `${id}.png`,
});

describe("mergeMessageContents", () => {
  it("joins string admits with a blank line", () => {
    expect(mergeMessageContents(["A", "B"])).toBe("A\n\nB");
  });

  it("keeps blank lines between image+text steer batches for the model", () => {
    const merged = mergeMessageContents([
      [
        { type: "image", attachment: image("aaa") },
        { type: "text", text: "看图一" },
      ],
      [
        { type: "image", attachment: image("bbb") },
        { type: "text", text: "看图二" },
      ],
    ]);
    expect(merged).toEqual([
      { type: "image", attachment: image("aaa") },
      { type: "text", text: "看图一" },
      { type: "text", text: "\n\n", modelOnly: true },
      { type: "image", attachment: image("bbb") },
      { type: "text", text: "看图二" },
    ]);
    expect(flattenText(merged)).toBe("看图一\n\n看图二");
  });

  it("fuses adjacent reader texts across mixed string/block admits", () => {
    const merged = mergeMessageContents([
      "先说一句",
      [
        { type: "image", attachment: image("fileish") },
        { type: "text", text: "再看图" },
      ],
    ]);
    expect(merged).toEqual([
      { type: "text", text: "先说一句" },
      { type: "text", text: "\n\n", modelOnly: true },
      { type: "image", attachment: image("fileish") },
      { type: "text", text: "再看图" },
    ]);
    expect(flattenText(merged)).toBe("先说一句\n\n再看图");
  });
});
