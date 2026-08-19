/**
 * Host-serve settings Plugins page: inventory mixes process plugins
 * (`extensions/example-tools`) with product-boot entries.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const EXTENSIONS = path.resolve(process.cwd(), "extensions");

describe.skipIf(!HAS_SHELL)("product shell inventory", () => {
  it(
    "lists process plugins and boot entries in Settings → Plugins",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-inv-",
        pluginsDir: EXTENSIONS,
        llm: createReplayAdapter([{ content: "inventory-idle" }]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell.base, pageErrors);
        await page.getByRole("button", { name: /Settings|设置/ }).click();
        const dialog = page.getByRole("dialog", { name: /Settings|设置/ });
        await dialog.waitFor({ timeout: 10_000 });
        await dialog.getByRole("button", { name: /Plugins|插件/ }).click();
        await dialog.getByRole("tab", { name: /Plugin list|插件列表/ }).click();

        const processRow = dialog.locator('[data-plugin-entry="example-tools"]');
        const bootRow = dialog.locator(
          '[data-plugin-entry="@xrkseek/client-runtime"]',
        );
        try {
          await processRow.waitFor({ timeout: 20_000 });
          await bootRow.waitFor({ timeout: 10_000 });
        } catch (error) {
          throw new Error(
            `inventory rows missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }

        const count = Number(
          await dialog.locator("[data-plugin-count]").getAttribute("data-plugin-count"),
        );
        expect(count).toBeGreaterThan(30);

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
