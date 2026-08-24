/**
 * Host-serve cancel: slow replay stream -> Stop -> aborted turn in log.
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

const MARKER = "cancel-prefix-marker";

describe.skipIf(!HAS_SHELL)("product shell cancel", () => {
  it(
    "stops mid-stream and records an aborted turn",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-cancel-",
        llm: createReplayAdapter([{ content: MARKER }], {
          enableStream: true,
          streamDelayMs: 120,
          hangBeforeDone: true,
        }),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "stream slowly");

        const stop = page.getByRole("button", { name: "Stop generating" });
        await stop.waitFor({ timeout: 20_000 });

        const chunkDeadline = Date.now() + 10_000;
        while (Date.now() < chunkDeadline) {
          const peek = readFirstPersistedSessionLog(shell.sessionsDir);
          if (peek.includes('"type":"assistant/chunk"')) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        await stop.click();

        await page
          .getByRole("button", { name: "Send message" })
          .waitFor({ timeout: 30_000 });

        let log = "";
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          log = readFirstPersistedSessionLog(shell.sessionsDir);
          if (log.includes('"kind":"interrupted"')) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        expect(log).toContain('"type":"turn/end"');
        expect(log).toContain('"kind":"interrupted"');
        if (log.includes('"type":"assistant/message"')) {
          expect(log).toContain('"interrupted":true');
        }
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
