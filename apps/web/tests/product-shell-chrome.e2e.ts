/**
 * Host-serve chrome: welcome dialog / sidebar / wordmark over apps/web/dist.
 */
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

describe.skipIf(!HAS_SHELL)("product shell chrome", () => {
  it(
    "opens welcome dialog, New session, and wordmark",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-chrome-",
        llm: createReplayAdapter([{ content: "pong-shell" }]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        const dialog = page.getByRole("dialog", {
          name: /内测声明|Internal Testing Notice/,
        });
        try {
          await dialog.waitFor({ state: "visible", timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `welcome dialog missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }

        expect(await dialog.count()).toBe(1);
        expect(
          await page.getByRole("button", { name: /继续|Continue/ }).count(),
        ).toBeGreaterThan(0);
        expect(
          await page
            .getByRole("button", { name: /新建会话|New session/ })
            .count(),
        ).toBeGreaterThan(0);
        expect(
          await page.locator('svg[aria-hidden="true"]').count(),
        ).toBeGreaterThan(0);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    40_000,
  );
});
