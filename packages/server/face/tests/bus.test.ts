import { describe, expect, expectTypeOf, it } from "vitest";
import { createFaceBus } from "../src/bus.js";
import { createFaceSeqClock, FaceMuxSeq, type FaceMuxSeq as FaceMuxSeqBrand } from "../src/seq.js";

describe("face seq + bus", () => {
  it("seq is monotonic per session", () => {
    const seq = createFaceSeqClock();
    expect(seq.last("a")).toBe(0);
    expect(seq.next("a")).toBe(1);
    expect(seq.next("a")).toBe(2);
    expect(seq.next("b")).toBe(1);
    expect(seq.last("a")).toBe(2);
  });

  it("ensureAtLeast jumps the mux watermark without walking next", () => {
    const seq = createFaceSeqClock();
    expect(seq.ensureAtLeast("s", 100)).toBe(100);
    expect(seq.last("s")).toBe(100);
    expect(seq.ensureAtLeast("s", 50)).toBe(100);
    expect(seq.next("s")).toBe(101);
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
