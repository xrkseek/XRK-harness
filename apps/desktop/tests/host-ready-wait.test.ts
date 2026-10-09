import { describe, expect, it } from "vitest";
import { waitForHostReady } from "../src/host-ready-wait.js";

describe("waitForHostReady", () => {
  it("resolves when getReady is already true", async () => {
    await expect(
      waitForHostReady({
        getReady: async () => true,
        getFailed: async () => null,
        onReady: () => () => {},
        onFailed: () => () => {},
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects sticky failed after listen (no ready)", async () => {
    await expect(
      waitForHostReady({
        getReady: async () => false,
        getFailed: async () => "sticky boom",
        onReady: () => () => {},
        onFailed: () => () => {},
      }),
    ).rejects.toThrow(/sticky boom/);
  });

  it("resolves when ready arrives before getReady returns", async () => {
    let readyListener: (() => void) | undefined;
    let ready = false;
    const pending = waitForHostReady({
      getReady: async () => {
        await Promise.resolve();
        return ready;
      },
      getFailed: async () => null,
      onReady: (listener) => {
        readyListener = listener;
        return () => {
          readyListener = undefined;
        };
      },
      onFailed: () => () => {},
    });
    ready = true;
    readyListener?.();
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects when failed event fires", async () => {
    let failedListener: ((message: string) => void) | undefined;
    const pending = waitForHostReady({
      getReady: async () => false,
      getFailed: async () => null,
      onReady: () => () => {},
      onFailed: (listener) => {
        failedListener = listener;
        return () => {
          failedListener = undefined;
        };
      },
    });
    failedListener?.("pushed fail");
    await expect(pending).rejects.toThrow(/pushed fail/);
  });
});
