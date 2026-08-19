import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  offloadRequestImages,
  REQUEST_IMAGE_OFFLOAD_PLACEHOLDER,
} from "../src/request-image-bound.js";

describe("offloadRequestImages", () => {
  it("leaves messages unchanged when under bound", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            attachment: {
              attachmentId: "a1",
              mediaType: "image/png" as const,
              bytes: 1000,
              width: 10,
              height: 10,
            },
          },
        ],
      },
    ];
    expect(offloadRequestImages(messages, DEFAULT_MAX_REQUEST_IMAGE_BYTES)).toBe(
      messages,
    );
  });

  it("replaces oldest images first when over bound", () => {
    const big = {
      attachmentId: "big",
      mediaType: "image/png" as const,
      bytes: 16 * 1024 * 1024,
      width: 100,
      height: 100,
    };
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "image" as const, attachment: big },
          { type: "text" as const, text: "keep" },
        ],
      },
      {
        role: "user" as const,
        content: [{ type: "image" as const, attachment: big }],
      },
    ];
    const out = offloadRequestImages(messages, 20 * 1024 * 1024);
    const first = out[0]!.content;
    expect(typeof first).not.toBe("string");
    if (typeof first === "string") throw new Error("expected blocks");
    expect(first[0]).toEqual({
      type: "text",
      text: REQUEST_IMAGE_OFFLOAD_PLACEHOLDER,
    });
    expect(first[1]).toEqual({ type: "text", text: "keep" });
  });
});
