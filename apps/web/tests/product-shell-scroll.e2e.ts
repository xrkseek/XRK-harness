/**
 * Host-serve transcript follow: send and composer resize keep the reader at
 * the bottom while pinned. Not the Cordis chat-scroll-contract lane.
 */
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  LIVE_PLACEHOLDER,
  openEnglishPage,
  prepareLiveComposer,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "scroll-bottom-marker";

async function distanceFromBottom(page: Page): Promise<number> {
  return page.locator("[data-conversation-scroll]").evaluate((host) => {
    return host.scrollHeight - host.clientHeight - host.scrollTop;
  });
}

async function expectBottom(page: Page): Promise<void> {
  await expect
    .poll(async () => Math.abs(await distanceFromBottom(page)), {
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(1);
}

describe.skipIf(!HAS_SHELL)("product shell scroll", () => {
  it(
    "scrolls to bottom after send and stays pinned when the composer grows",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-scroll-",
        llm: createReplayAdapter(
          [
            {
              content: `${MARKER}\n${Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join("\n")}`,
            },
          ],
          { enableStream: true },
        ),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "say the scroll marker");
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });
        await expectBottom(page);

        const composer = page.getByPlaceholder(LIVE_PLACEHOLDER);
        const longDraft = Array.from(
          { length: 18 },
          (_, index) =>
            `composer resize line ${String(index + 1).padStart(2, "0")}`,
        ).join("\n");
        await composer.fill(longDraft);
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
        });
        await expectBottom(page);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
