import { describe, expect, it, afterEach } from "vitest";
import {
  disposeLiveHostApply,
  gateLiveHostHttp,
  isLiveHostApplyActive,
  registerLiveHostApply,
  resetLiveHostApply,
} from "../src/dsh-compat/live-host-apply.js";

afterEach(() => {
  resetLiveHostApply();
});

describe("live-host-apply", () => {
  it("gates HTTP after dispose", async () => {
    let cleaned = 0;
    await registerLiveHostApply("dsh-workbuddy-connect", () => {
      cleaned += 1;
    });
    expect(isLiveHostApplyActive("dsh-workbuddy-connect")).toBe(true);

    const [row] = gateLiveHostHttp("dsh-workbuddy-connect", [
      {
        match: (p) => p.startsWith("/plugins/dsh-workbuddy-connect/"),
        handle: async () => true,
      },
    ]);
    expect(
      await row!.handle(
        {} as never,
        {} as never,
        "/plugins/dsh-workbuddy-connect/status",
      ),
    ).toBe(true);

    expect(await disposeLiveHostApply("dsh-workbuddy-connect")).toBe(true);
    expect(cleaned).toBe(1);
    expect(isLiveHostApplyActive("dsh-workbuddy-connect")).toBe(false);
    expect(
      await row!.handle(
        {} as never,
        {} as never,
        "/plugins/dsh-workbuddy-connect/status",
      ),
    ).toBe(false);
  });

  it("replaces a prior live session", async () => {
    let first = 0;
    let second = 0;
    await registerLiveHostApply("dsh-our-free-model", () => {
      first += 1;
    });
    await registerLiveHostApply("dsh-our-free-model", () => {
      second += 1;
    });
    expect(first).toBe(1);
    expect(await disposeLiveHostApply("dsh-our-free-model")).toBe(true);
    expect(second).toBe(1);
  });
});
