import { describe, expect, it, vi } from "vitest";
import { createSessionDrainHub } from "../src/drain-hub.js";

describe("createSessionDrainHub", () => {
  it("isolates drains per sessionId", async () => {
    const seen: string[] = [];
    const hub = createSessionDrainHub({
      createDrain: (sessionId) => async () => {
        seen.push(sessionId);
      },
    });

    await Promise.all([hub.run("a"), hub.run("b")]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("wake coalesces on the same session", async () => {
    const forces: boolean[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let second = false;

    const hub = createSessionDrainHub({
      createDrain: () => async ({ force }) => {
        forces.push(force);
        if (forces.length === 1) {
          await gate;
          return;
        }
        second = true;
      },
    });

    const runP = hub.run("s1");
    hub.wake("s1");
    hub.wake("s1");
    release();
    await vi.waitFor(() => expect(second).toBe(true));
    await runP;
    expect(forces).toEqual([true, false]);
  });
});
