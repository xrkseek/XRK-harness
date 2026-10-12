import { describe, expect, it } from "vitest";
import {
  projectImagesForTextModel,
  requestImageHandleText,
  textOnlyImageText,
  type ImageAttachmentRef,
} from "../src/index.ts";

const image: ImageAttachmentRef = {
  attachmentId: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  mediaType: "image/png",
  bytes: 12,
  width: 8,
  height: 6,
  name: "shot.png",
};

describe("text-only image projection", () => {
  it("builds a stable placeholder and request handle", () => {
    expect(textOnlyImageText(image)).toContain("text only");
    expect(textOnlyImageText(image)).toContain("sha256:abcdef01");
    expect(requestImageHandleText(image, { width: 4, height: 3 })).toContain(
      "request preview 4x3px",
    );
    expect(requestImageHandleText(image, { width: 4, height: 3 })).toContain(
      "shot.png",
    );
  });

  it("replaces user and tool image blocks without touching other roles", () => {
    const messages = projectImagesForTextModel([
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          { type: "image", attachment: image },
        ],
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read_image", arguments: {} }],
      },
      {
        role: "tool",
        toolCallId: "c1",
        name: "read_image",
        content: [
          { type: "text", text: "envelope" },
          { type: "image", attachment: image },
        ],
      },
    ]);
    expect(messages[0]).toEqual({ role: "system", content: "sys" });
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "see" },
      { type: "text", text: textOnlyImageText(image) },
    ]);
    expect(messages[3]?.content).toEqual([
      { type: "text", text: "envelope" },
      { type: "text", text: textOnlyImageText(image) },
    ]);
  });
});
