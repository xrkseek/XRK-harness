/**
 * Host-serve Session log export: header button -> HEAD /api/session.export
 * -> browser download (`xrk-session-*.zip`) + success dialog.
 */
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "export-shell-ok";

describe.skipIf(!HAS_SHELL)("product shell session export", () => {
  it(
    "downloads a session ZIP from the Session log header action",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-exp-",
        llm: createReplayAdapter([{ content: MARKER }]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "say export-shell-ok then stop");
        await page.getByText(MARKER, { exact: true }).waitFor({ timeout: 20_000 });

        const exportButton = page.getByRole("button", { name: "Session log" });
        try {
          await exportButton.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `Session log button missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }

        const responsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "HEAD" &&
            new URL(response.url()).pathname === "/api/session.export",
          { timeout: 30_000 },
        );
        const downloadPromise = page.waitForEvent("download", {
          timeout: 30_000,
        });
        await exportButton.click();

        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^xrk-session-.+\.zip$/);

        const dialog = page.getByRole("dialog", {
          name: "Session download started",
        });
        await dialog.waitFor({ timeout: 20_000 });
        await dialog.getByText("Close", { exact: true }).click();

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
