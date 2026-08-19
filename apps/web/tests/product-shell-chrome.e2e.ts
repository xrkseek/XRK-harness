/**
 * Host-serve chrome: welcome dialog / sidebar / wordmark over apps/web/dist.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Browser } from "playwright";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  spawnProductShell,
} from "./product-shell-host.ts";

describe.skipIf(!HAS_SHELL)("product shell chrome", () => {
  it(
    "opens welcome dialog, New session, and wordmark",
    async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "xrk-chrome-"));
      const { manager, base } = await spawnProductShell({
        workspaceRoot,
        llm: createReplayAdapter([{ content: "pong-shell" }]),
      });

      let browser: Browser | undefined;
      try {
        const opened = await openEnglishPage(base);
        browser = opened.browser;
        const { page, pageErrors } = opened;

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
        await browser?.close();
        await manager.stopAll();
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
    40_000,
  );
});
