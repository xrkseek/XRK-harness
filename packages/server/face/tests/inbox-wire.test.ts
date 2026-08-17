import { describe, expect, it } from "vitest";
import {
  FaceInboxWireProjector,
  toDshWireSessionEvent,
  toQueueItems,
} from "../src/index.js";

describe("Face inbox wire + session/queue DSH shapes", () => {
  it("toQueueItems emits message blocks (not flat content)", () => {
    const items = toQueueItems(
      [
        {
          admitId: "a1",
          sessionId: "s",
          content: "hello queue",
          delivery: "queue",
        },
        {
          admitId: "a2",
          sessionId: "s",
          content: "steer me",
          delivery: "steer",
        },
      ],
      new Map([["a1", "rpc-1"]]),
    );
    expect(items).toEqual([
      {
        id: "a1",
        placement: "queued",
        message: {
          id: "a1",
          role: "user",
          content: [{ type: "text", text: "hello queue" }],
          source: { kind: "user", rpcId: "rpc-1" },
        },
      },
      {
        id: "a2",
        placement: "steering",
        message: {
          id: "a2",
          role: "user",
          content: [{ type: "text", text: "steer me" }],
          source: { kind: "user" },
        },
      },
    ]);
    expect(items[0]).not.toHaveProperty("content");
  });

  it("projector maps admit/withdraw/promote to agent/inbox/spliced coords", () => {
    const inbox = new FaceInboxWireProjector(
      new Map([
        ["a1", "rpc-a"],
        ["a2", "rpc-b"],
      ]),
    );

    const admitQ = toDshWireSessionEvent(
      {
        type: "prompt/admitted",
        ts: 1,
        admitId: "a1",
        content: "queued",
      },
      1,
      { sessionId: "s", inbox },
    );
    expect(admitQ).toEqual({
      type: "agent/inbox/spliced",
      seq: 1,
      time: 1,
      data: {
        target: "next-turn",
        start: 0,
        inserted: [
          {
            id: "a1",
            role: "user",
            content: [{ type: "text", text: "queued" }],
            source: { kind: "user", rpcId: "rpc-a" },
          },
        ],
      },
    });

    const admitS = toDshWireSessionEvent(
      {
        type: "prompt/admitted",
        ts: 2,
        admitId: "a2",
        content: "steered",
        delivery: "steer",
      },
      2,
      { sessionId: "s", inbox },
    );
    expect(admitS.data).toMatchObject({
      target: "next-step",
      start: 0,
    });

    const withdrawn = toDshWireSessionEvent(
      { type: "prompt/withdrawn", ts: 3, admitId: "a1" },
      3,
      { sessionId: "s", inbox },
    );
    expect(withdrawn).toEqual({
      type: "agent/inbox/spliced",
      seq: 3,
      time: 3,
      data: {
        target: "next-turn",
        start: 0,
        removedCount: 1,
        inserted: [],
        outcome: "canceled",
      },
    });

    const promoted = toDshWireSessionEvent(
      { type: "prompt/promoted", ts: 4, admitId: "a2" },
      4,
      { sessionId: "s", inbox },
    );
    expect(promoted.data).toEqual({
      target: "next-step",
      start: 0,
      removedCount: 1,
      inserted: [],
    });
    expect(promoted.data).not.toHaveProperty("outcome");
  });

  it("prompt/* without projector stays ignorable (isolated calls)", () => {
    const wire = toDshWireSessionEvent(
      {
        type: "prompt/admitted",
        ts: 20,
        admitId: "a1",
        content: "hi",
      },
      8,
    );
    expect(wire.ignorable).toBe(true);
    expect(wire.type).toBe("prompt/admitted");
  });
});
