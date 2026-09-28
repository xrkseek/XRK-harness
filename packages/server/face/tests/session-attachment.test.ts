import { describe, expect, it } from "vitest";
import type { MessageContent, SessionEvent } from "@xrkseek/protocol";
import { referencedAttachmentIds } from "../src/session-attachment.js";

function toolResult(content: MessageContent): SessionEvent {
  return {
    type: "tool/result",
    ts: 1,
    turnId: "t1",
    stepId: "s1",
    result: {
      toolCallId: "c1",
      name: "image_generate",
      content,
    },
  };
}

describe("referencedAttachmentIds", () => {
  it("includes image blocks from tool/result", () => {
    const ids = referencedAttachmentIds([
      toolResult([
        { type: "text", text: "ok" },
        {
          type: "image",
          attachment: {
            attachmentId: "sha256:aaa",
            mediaType: "image/png",
            bytes: 12,
            width: 1,
            height: 1,
          },
        },
      ]),
    ]);
    expect([...ids]).toEqual(["sha256:aaa"]);
  });

  it("includes attachmentId= lines from text-only tool/result", () => {
    const ids = referencedAttachmentIds([
      toolResult(
        "provider=memory images=1\nattachmentId=sha256:bbb\nuse=Shown in chat.",
      ),
    ]);
    expect([...ids]).toEqual(["sha256:bbb"]);
  });

  it("still collects user/message image refs", () => {
    const ids = referencedAttachmentIds([
      {
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: [
          {
            type: "image",
            attachment: {
              attachmentId: "sha256:ccc",
              mediaType: "image/png",
              bytes: 4,
              width: 2,
              height: 2,
            },
          },
        ],
      },
    ]);
    expect([...ids]).toEqual(["sha256:ccc"]);
  });
});
