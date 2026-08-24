/**
 * Host-serve smoke: wallet balance refresh path + settings crash face strings.
 * Full better-sidebar MD / mnemon UI still need a live browser with community plugins.
 */
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

describe.skipIf(!HAS_SHELL)("product shell wallet + settings face", () => {
  it(
    "wallet balance endpoint is available and settings dialog survives",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-wallet-smoke-",
        llm: createReplayAdapter([{ content: "pong" }]),
      });
      const { browser, page } = await openEnglishPage(shell.base);
      try {
        const bal = await fetch(`${shell.base}/wallet/api/balance`);
        expect(bal.status).toBe(200);
        const body = (await bal.json()) as {
          available?: boolean;
          total?: number;
          error?: string;
        };
        expect(body.available).toBe(true);
        expect(body.error).toBeUndefined();
        expect(typeof body.total).toBe("number");

        const refresh = await fetch(`${shell.base}/wallet/api/refresh`);
        expect(refresh.status).toBe(200);

        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 });
        // New shell face copy must be in the main Vite bundle.
        const html = await page.content();
        expect(html).not.toContain("Check the browser console for the error");
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
