/**
 * Host-serve aria golden (learns DSH scaffold captureStableAria, not Cordis boot).
 * Refresh: `XRK_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/product-shell-stream-aria.e2e.ts`
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  captureStableAria,
  compareOrRefreshGolden,
  openEnglishPage,
  prepareLiveComposer,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "aria-stream-marker";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(
  HERE,
  "snapshots",
  "product-shell-stream",
  "settled.expected.md",
);

describe.skipIf(!HAS_SHELL)("product shell stream aria golden", () => {
  it(
    "settles chat region aria after one streamed turn",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-stream-aria-",
        llm: createReplayAdapter(
          [
            {
              content: MARKER,
              usage: { inputTokens: 3, outputTokens: 2 },
            },
          ],
          { enableStream: true },
        ),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell.base, pageErrors);
        await sendComposerPrompt(page, "say the marker");
        try {
          await page.getByText(MARKER).waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `streamed marker missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }

        // Chat tab surface — roles + labels, not Cordis scaffold geometry.
        const actual = await captureStableAria(
          page,
          'main, [role="main"], body',
          shell.workspaceRoot,
        );
        expect(actual).toContain(MARKER);
        await compareOrRefreshGolden(GOLDEN, actual);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
