import { describe, expect, it } from "vitest";
import { deriveMessages } from "../src/index.js";
import type { SessionEvent } from "@xrkseek/protocol";

describe("deriveMessages context-fragment chronology", () => {
  it("keeps fragment updates in place (no last-wins relocate)", () => {
    const events: SessionEvent[] = [
      {
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: "<session_capability>\npermission: default\n</session_capability>",
        source: {
          kind: "context-fragment",
          form: "fragment",
          fragmentId: "additional_context.session_capability",
          fragmentKind: "additional_context",
        },
      },
      {
        type: "user/message",
        ts: 2,
        turnId: "t1",
        content: "first ask",
      },
      {
        type: "assistant/message",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        content: "ok",
      },
      {
        type: "user/message",
        ts: 4,
        turnId: "t2",
        content: "<session_capability>\npermission: full\n</session_capability>",
        source: {
          kind: "context-fragment",
          form: "fragment",
          fragmentId: "additional_context.session_capability",
          fragmentKind: "additional_context",
          update: true,
        },
      },
      {
        type: "user/message",
        ts: 5,
        turnId: "t2",
        content: "second ask",
      },
    ];
    const msgs = deriveMessages(events);
    const texts = msgs.map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    );
    // Both snapshots stay: relocating to the latest slot would rewrite the
    // prefix after "first ask" / "ok" and miss provider KV cache.
    expect(texts.filter((t) => t.includes("session_capability"))).toEqual([
      "<session_capability>\npermission: default\n</session_capability>",
      "<session_capability>\npermission: full\n</session_capability>",
    ]);
    expect(texts).toEqual([
      "<session_capability>\npermission: default\n</session_capability>",
      "first ask",
      "ok",
      "<session_capability>\npermission: full\n</session_capability>",
      "second ask",
    ]);
  });

  it("does not collapse distinct fragmentIds or human messages", () => {
    const events: SessionEvent[] = [
      {
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: "<seat_identity>\na\n</seat_identity>",
        source: {
          kind: "context-fragment",
          form: "fragment",
          fragmentId: "additional_context.seat_identity",
          fragmentKind: "additional_context",
        },
      },
      {
        type: "user/message",
        ts: 2,
        turnId: "t1",
        content: "<boss_status>\nmood=ok\n</boss_status>",
        source: {
          kind: "context-fragment",
          form: "fragment",
          fragmentId: "additional_context.boss_status",
          fragmentKind: "additional_context",
        },
      },
      {
        type: "user/message",
        ts: 3,
        turnId: "t1",
        content: "hi",
      },
    ];
    const msgs = deriveMessages(events);
    expect(msgs).toHaveLength(3);
  });
});
