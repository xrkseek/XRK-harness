/**
 * Host-serve turn-error UI (C.3 / DSH): AUTH failure → turn-error row,
 * displayFailureMessage strips credential echo.
 */
import { describe, expect, it } from "vitest";
import type { LlmAdapter, LlmChatRequest } from "@xrkseek/llm";
import { LlmError } from "@xrkseek/llm";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  readFirstPersistedSessionLog,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const AUTH_PROVIDER_MESSAGE =
  "Authentication Fails, Your api key: sk-preview-secret is invalid";
const SECRET_FRAGMENT = "sk-preview-secret";

function createAuthFailAdapter(): LlmAdapter {
  return {
    id: "auth-fail",
    async chat(_request: LlmChatRequest) {
      throw new LlmError(AUTH_PROVIDER_MESSAGE, "AUTH", { status: 401 });
    },
  };
}

describe.skipIf(!HAS_SHELL)("product shell turn error", () => {
  it(
    "surfaces AUTH as This turn failed without leaking the key",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-error-",
        llm: createAuthFailAdapter(),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "will fail auth");

        const errorStatus = page
          .getByRole("status")
          .filter({ hasText: "This turn failed" });
        await errorStatus.waitFor({ timeout: 30_000 });
        const text = (await errorStatus.textContent()) ?? "";
        expect(text).toContain("API key is invalid");
        expect(text).toContain("AUTH");
        expect(text).not.toContain(SECRET_FRAGMENT);

        await page
          .getByRole("button", { name: "Send message" })
          .waitFor({ timeout: 15_000 });

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"type":"turn/end"');
        expect(log).toContain('"kind":"error"');
        expect(log).toContain('"code":"AUTH"');
        // Durable log may keep the provider message; UI must not.
        expect(await page.locator("body").textContent()).not.toContain(
          SECRET_FRAGMENT,
        );

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
