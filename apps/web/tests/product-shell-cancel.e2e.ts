/**
 * Host-serve cancel: slow replay stream → Stop → interrupted prefix in log.
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
    "stops mid-stream and persists interrupted assistant prefix",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-cancel-",
        llm: createReplayAdapter([{ content: MARKER }], {
          enableStream: true,
          streamDelayMs: 80,
          hangBeforeDone: true,
        }),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell.base, pageErrors);
        await sendComposerPrompt(page, "stream slowly");

        const partial = MARKER.slice(0, Math.max(4, Math.floor(MARKER.length / 2)));
        await page.getByText(partial, { exact: false }).waitFor({ timeout: 20_000 });

        const stop = page.getByRole("button", { name: /Stop generating|停止生成/ });
        await stop.click();

        await page
          .getByRole("button", { name: /Send message|发送消息/ })
          .waitFor({ timeout: 30_000 });

        let log = "";
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          log = readFirstPersistedSessionLog(shell.sessionsDir);
          if (log.includes('"interrupted":true')) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        expect(log).toContain('"type":"assistant/message"');
        expect(log).toContain('"interrupted":true');
        expect(log).toContain(partial);
        expect(log).toContain('"kind":"aborted"');
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
