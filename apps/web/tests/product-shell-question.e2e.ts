/**
 * Host-serve ask_user: replay questions[] ‚Ü?`[data-question-key]`
 * ‚Ü?pick an option ‚Ü?Submit ‚Ü?`/api/respond` ‚Ü?final assistant text.
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

const MARKER = "question-blue-ok";
const PROMPT_Q = "Which color?";

describe.skipIf(!HAS_SHELL)("product shell question", () => {
  it(
    "shows the question composer, answers once, and lands the follow-up",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-q-",
        llm: createReplayAdapter([
          {
            content: "",
            toolCalls: [
              {
                id: "q1",
                name: "ask_user",
                arguments: {
                  questions: [
                    {
                      id: "color",
                      question: PROMPT_Q,
                      options: [{ label: "Blue" }, { label: "Green" }],
                    },
                  ],
                },
              },
            ],
          },
          { content: MARKER },
        ]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "ask me a color then stop");

        const card = page.locator("[data-question-key]");
        try {
          await card.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `question card missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }
        await card.getByRole("heading", { name: PROMPT_Q }).waitFor({
          timeout: 10_000,
        });
        await card.getByRole("radio", { name: "Blue" }).click();
        await card.getByRole("button", { name: /Submit|Êèê‰∫§/ }).click();
        await card.waitFor({ state: "hidden", timeout: 20_000 });
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"name":"ask_user"');
        expect(log).toContain('"type":"tool/result"');
        expect(log).toContain(MARKER);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
