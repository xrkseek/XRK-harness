/**
 * Host-serve Access chip: Permissions projection �?switch Read Only
 * via the composer Access mode control (runs `/permission`).
 */
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  readFirstPersistedSessionLog,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

describe.skipIf(!HAS_SHELL)("product shell access", () => {
  it(
    "switches Access mode to Read Only without page errors",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-access-",
        llm: createReplayAdapter([{ content: "access-idle" }]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);

        const access = page.getByRole("button", {
          name: /Access mode|访问模式/,
        });
        try {
          await access.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `Access chip missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }
        await access.click();
        await page
          .getByRole("menuitem", { name: /Read Only|只读/ })
          .click({ timeout: 10_000 });
        await expect
          .poll(async () => access.getAttribute("aria-label"), {
            timeout: 10_000,
          })
          .toMatch(/Read Only|只读|read-only/i);

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toMatch(/permission\/preset|read-only/);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
