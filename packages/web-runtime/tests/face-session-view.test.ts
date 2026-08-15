import { describe, expect, it } from "vitest";
import { FaceSessionView } from "../src/face-session-view.js";

describe("FaceSessionView", () => {
  it("seeds history projections and applies mux projection frames", () => {
    const view = new FaceSessionView();
    view.attach("s1");
    view.seedHistory({
      events: [
        {
          seq: 1,
          event: {
            type: "user/message",
            ts: 1,
            turnId: "t",
            content: "hi",
          },
        },
      ],
      projections: {
        asOfSeq: 1,
        values: { title: "hi", sessionListMetadata: { blank: true, lastPromptAt: 1 } },
      },
    });
    expect(view.title()).toBe("hi");
    expect(view.fold.getSnapshot().nodes[0]).toMatchObject({
      kind: "user",
      content: "hi",
    });

    view.handleMux({
      type: "session/projection",
      sessionId: "s1",
      key: "title",
      value: "Renamed",
      seq: 2,
    });
    expect(view.title()).toBe("Renamed");

    // stale lower seq dropped
    view.handleMux({
      type: "session/projection",
      sessionId: "s1",
      key: "title",
      value: "Old",
      seq: 1,
    });
    expect(view.title()).toBe("Renamed");
  });

  it("ignores mux frames when generation was bumped underneath", () => {
    const view = new FaceSessionView();
    view.attach("s1");
    view.gen.bump(); // orphan the view's token
    view.handleMux({
      type: "session/projection",
      sessionId: "s1",
      key: "title",
      value: "ghost",
      seq: 9,
    });
    expect(view.title()).toBeNull();
  });

  it("subscribed truncates ghost projection seqs; reconnect resets fold", () => {
    const view = new FaceSessionView();
    view.attach("s1");
    view.handleMux({
      type: "session/event",
      sessionId: "s1",
      seq: 1,
      event: {
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "hi",
      },
    });
    view.handleMux({
      type: "session/projection",
      sessionId: "s1",
      key: "title",
      value: "hi",
      seq: 1,
    });
    view.handleMux({
      type: "session/projection",
      sessionId: "s1",
      key: "title",
      value: "ghost-ahead",
      seq: 99,
    });
    expect(view.title()).toBe("ghost-ahead");
    // higher-seq-wins: truncating drops the ghost row entirely (no value history)
    view.handleMux({
      type: "session/subscribed",
      sessionId: "s1",
      lastSeq: 1,
    });
    expect(view.title()).toBeNull();
    view.seedHistory({
      events: [],
      projections: { asOfSeq: 1, values: { title: "hi" } },
    });
    expect(view.title()).toBe("hi");
    view.reconnect();
    expect(view.fold.getSnapshot().nodes).toEqual([]);
    expect(view.title()).toBe("hi");
  });
});
