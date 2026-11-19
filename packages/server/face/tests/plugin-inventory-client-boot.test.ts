import { describe, expect, it } from "vitest";
import { pluginInventoryClientBoot } from "../src/handlers/remotes.js";

describe("pluginInventory/clientBoot", () => {
  it("returns empty overlay when clientBootOverlay is unwired", async () => {
    const result = await pluginInventoryClientBoot(
      {
        productDir: "/tmp",
        plugins: [],
        webPlugins: [],
      } as never,
      "rpc-1",
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ rev: "none", entries: [] });
  });

  it("returns the Host overlay from clientBootOverlay", async () => {
    const overlay = {
      rev: "xrk-plugins-abc",
      entries: [
        {
          id: "side",
          url: "/plugins/side/client.js?rev=1.0.0",
          rev: "1.0.0",
          inject: ["@xrkseek/client-runtime"],
        },
      ],
    };
    const result = await pluginInventoryClientBoot(
      {
        productDir: "/tmp",
        plugins: [],
        webPlugins: [{ id: "side" }],
        clientBootOverlay: () => overlay,
      } as never,
      "rpc-2",
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(overlay);
  });

  it("adds ?rev= to legacy overlay URLs", async () => {
    const result = await pluginInventoryClientBoot(
      {
        productDir: "/tmp",
        plugins: [],
        webPlugins: [{ id: "side" }],
        clientBootOverlay: () => ({
          rev: "xrk-plugins-legacy",
          entries: [
            {
              id: "side",
              url: "/plugins/side/client.js",
              rev: "2.0.0",
              inject: [],
            },
          ],
        }),
      } as never,
      "rpc-3",
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]?.url).toBe(
      "/plugins/side/client.js?rev=2.0.0",
    );
  });

  it("replaces a stale ?rev= query to match the rev field", async () => {
    const result = await pluginInventoryClientBoot(
      {
        productDir: "/tmp",
        plugins: [],
        webPlugins: [{ id: "side" }],
        clientBootOverlay: () => ({
          rev: "xrk-plugins-stale",
          entries: [
            {
              id: "side",
              url: "/plugins/side/client.js?rev=1.0.0",
              rev: "2.0.0",
              inject: [],
            },
          ],
        }),
      } as never,
      "rpc-4",
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]?.url).toBe(
      "/plugins/side/client.js?rev=2.0.0",
    );
  });
});


