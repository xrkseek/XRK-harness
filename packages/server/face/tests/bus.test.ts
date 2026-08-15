import { describe, expect, it } from "vitest";
import { createFaceBus } from "../src/bus.js";
import { createFaceSeqClock } from "../src/seq.js";

describe("face seq + bus", () => {
  it("seq is monotonic per session", () => {
    const seq = createFaceSeqClock();
    expect(seq.last("a")).toBe(0);
    expect(seq.next("a")).toBe(1);
    expect(seq.next("a")).toBe(2);
    expect(seq.next("b")).toBe(1);
    expect(seq.last("a")).toBe(2);
  });

  it("mux and host are separate", () => {
    const bus = createFaceBus();
    const mux: unknown[] = [];
    const host: unknown[] = [];
    bus.subscribeMux((_id, f) => mux.push(f));
    bus.subscribeHost((_id, f) => host.push(f));
    bus.publishMux({
      type: "session/subscribed",
      sessionId: "s",
      lastSeq: 0,
    });
    bus.publishHost({
      type: "host/session-added",
      sessionId: "s",
      blank: true,
    });
    expect(mux).toHaveLength(1);
    expect(host).toHaveLength(1);
  });
});
