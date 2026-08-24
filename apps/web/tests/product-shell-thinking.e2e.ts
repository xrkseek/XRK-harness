/**
 * Host-serve thinking row: replay streams reasoning-delta then text.
 * Asserts `[data-variant="think"]` + JSONL reasoning chunks.
 */
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  readFirstPersistedSessionLog,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const THINK = "think-hard-line";
const MARKER = "think-answer-ok";

describe.skipIf(!HAS_SHELL)("product shell thinking", () => {
  it(
    "renders a Think disclosure from streamed reasoning",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-think-",
        llm: createReplayAdapter(
          [{ content: MARKER, reasoning: THINK }],
          { enableStream: true },
        ),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "think then answer");

        const think = page.locator('[data-variant="think"]');
        try {
          await think.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `Think row missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }
        await page.getByText(THINK).waitFor({ timeout: 10_000 });
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"type":"assistant/chunk"');
        expect(log).toContain('"kind":"reasoning"');
        expect(log).toContain(THINK);
        expect(log).toContain(MARKER);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
