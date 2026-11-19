import { describe, expect, it } from "vitest";
import { collectSessionTitleMessages } from "../src/index.js";
import type { SessionEvent } from "@xrkseek/xrk-session";

function userMessage(
  seq: number,
  content: SessionEvent extends { type: "user/message"; data: infer D }
    ? D extends { content: infer C }
      ? C
      : never
    : never,
): SessionEvent {
  return {
    type: "user/message",
    seq,
    time: seq * 10,
    data: {
      source: { kind: "user" },
      content,
    },
  } as SessionEvent;
}

describe("collectSessionTitleMessages handle captions", () => {
  it("skips image/file handle captions even without modelOnly", () => {
    const events = [
      userMessage(1, [
        {
          type: "text",
          text: "[图1 sha256:abcdef0123456789（1×1 image/png）。视觉模型直接看块]",
        },
      ]),
      userMessage(2, [
        {
          type: "text",
          text: "[文件附件 notes.docx（sha256:abcd）。需内容时用 read_file path=attachment:sha256:abcd 读取]",
        },
      ]),
      userMessage(3, [{ type: "text", text: "帮我改这段文案" }]),
    ];
    const messages = collectSessionTitleMessages(events);
    expect(messages).toEqual([{ seq: 3, text: "帮我改这段文案" }]);
  });

  it("skips modelOnly captions and keeps reader prose", () => {
    const events = [
      userMessage(1, [
        { type: "text", text: "[图1 sha256:ab]", modelOnly: true },
        { type: "text", text: "看这张图" },
      ]),
    ];
    expect(collectSessionTitleMessages(events)).toEqual([
      { seq: 1, text: "看这张图" },
    ]);
  });
});
