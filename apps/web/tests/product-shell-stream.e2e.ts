/**
 * Host-serve stream: one prompt; replay adapter emits text-delta then
 * assistant/message. Not the DSH Cordis scaffold lane.
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

const MARKER = "stream-pong-marker";

describe.skipIf(!HAS_SHELL)("product shell stream", () => {
  it(
    "sends one prompt and lands streamed assistant text",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-stream-",
        llm: createReplayAdapter([{ content: MARKER }], { enableStream: true }),
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

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"type":"assistant/chunk"');
        expect(log).toContain('"type":"assistant/message"');
        expect(log).toContain(MARKER);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
