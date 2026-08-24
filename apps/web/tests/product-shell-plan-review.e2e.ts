/**
 * Host-serve plan-review (pnpm test:web). Cordis scaffold twin: plan-review.e2e.ts.
 *
 * `/plan` then `exit_plan_mode` �?`[data-plan-review-key]` Approve �? * leave plan mode + final text.
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

const MARKER = "plan-review-done";
const PLAN = "# Ship greeting flag\n\n- add --greeting\n- wire parser\n- stop";

describe.skipIf(!HAS_SHELL)("product shell plan review", () => {
  it(
    "reviews exit_plan_mode on the decision card and approves",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-prev-",
        // `/plan` is Face slash (no LLM). First turn is exit_plan_mode review.
        llm: createReplayAdapter([
          {
            content: "",
            toolCalls: [
              {
                id: "ep1",
                name: "exit_plan_mode",
                arguments: { plan: PLAN },
              },
            ],
          },
          { content: MARKER },
        ]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "/plan");
        await page
          .getByRole("button", { name: /Plan mode on|计划模式/ })
          .waitFor({ timeout: 20_000 });

        await sendComposerPrompt(page, "call exit_plan_mode then stop");

        const card = page.locator("[data-plan-review-key]");
        try {
          await card.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `plan-review card missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }
        expect(await page.locator("[data-question-key]").count()).toBe(0);
        await card.getByText(/Plan review|计划待审/).waitFor({ timeout: 10_000 });
        await card.getByRole("button", { name: /Approve|确认执行/ }).click();
        await card.waitFor({ state: "hidden", timeout: 20_000 });
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain("exit_plan_mode");
        expect(log).toContain("Plan approved");
        expect(log).toContain(MARKER);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
