/**
 * Host-serve: community settings.section that throws must not close the
 * dialog or erase its nav row (abdication used to make "click → vanish").
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  dismissWelcome,
  openEnglishPage,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/crash-settings-plugin", import.meta.url),
);

describe.skipIf(!HAS_SHELL)("product shell settings plugin crash", () => {
  it(
    "keeps the settings dialog and crash-demo nav after a throwing section",
    async () => {
      const pluginsDir = await mkdtemp(path.join(os.tmpdir(), "xrk-crash-plg-"));
      await cp(FIXTURE, pluginsDir, { recursive: true });
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-settings-crash-",
        llm: createReplayAdapter([{ content: "pong" }]),
        pluginsDir,
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 });
        await dismissWelcome(page);

        const trigger = page.getByRole("button", {
          name: "Settings",
          exact: true,
        });
        await trigger.waitFor({ timeout: 15_000 });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Settings" });
        await dialog.waitFor({ timeout: 10_000 });

        const crashNav = dialog.getByRole("button", {
          name: "Crash Demo",
          exact: true,
        });
        await crashNav.waitFor({ timeout: 15_000 });
        await crashNav.click();

        await expect
          .poll(() => page.getByRole("dialog", { name: "Settings" }).count(), {
            timeout: 5_000,
          })
          .toBe(1);
        expect(await crashNav.getAttribute("aria-current")).toBe("true");
        await expect
          .poll(
            () =>
              dialog.locator('[data-slot-error="settings.section"]').count(),
            { timeout: 5_000 },
          )
          .toBeGreaterThan(0);
        // Nav row must survive abdication.
        expect(
          await dialog.getByRole("button", { name: "Crash Demo", exact: true }).count(),
        ).toBe(1);
        expect(
          pageErrors.some((e) => e.includes("intentional section crash")),
        ).toBe(true);
      } finally {
        await browser.close();
        await shell.dispose();
        await rm(pluginsDir, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
