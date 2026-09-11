/**
 * Host-serve: Face `session.prompt` file part (arbitrary upload wire) + Host-native
 * `/sidebar/file` MIME preview. Composer drag/paste UI is covered by client unit
 * tests; Chromium rejects untrusted DataTransfer on document drop listeners.
 * Full better-sidebar tabs still need the community client.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  faceRpc,
  openEnglishPage,
  prepareLiveComposer,
  readFirstPersistedSessionLog,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "file-upload-shell-ok";
const UPLOAD_NAME = "upload-note.txt";
const UPLOAD_BODY = "arbitrary upload body for product-shell e2e\n";
const PREVIEW_NAME = "sidebar-preview.md";
const PREVIEW_BODY = "# sidebar preview e2e\n";

describe.skipIf(!HAS_SHELL)("product shell file upload + sidebar preview", () => {
  it(
    "admits a Face file part and serves /sidebar/file with markdown MIME",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-file-side-",
        llm: createReplayAdapter([{ content: MARKER }]),
      });
      const workspaceDir = path.join(shell.workspaceRoot, "workspace");
      const previewPath = path.join(workspaceDir, PREVIEW_NAME);
      await writeFile(previewPath, PREVIEW_BODY, "utf8");

      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);

        const listed = await faceRpc(shell.base, "session.list", {});
        expect(listed.ok, JSON.stringify(listed.error)).toBe(true);
        const items = (listed.value as { items?: readonly { sessionId: string }[] })
          ?.items;
        const sessionId = items?.[0]?.sessionId;
        expect(sessionId, `session.list: ${JSON.stringify(listed.value)}`).toBeTypeOf(
          "string",
        );

        const prompted = await faceRpc(shell.base, "session.prompt", {
          sessionId,
          mode: "queue",
          content: [
            {
              type: "file",
              data: Buffer.from(UPLOAD_BODY, "utf8").toString("base64"),
              name: UPLOAD_NAME,
              mediaType: "text/plain",
            },
          ],
        });
        expect(prompted.ok, JSON.stringify(prompted.error)).toBe(true);

        await page.getByText(MARKER, { exact: true }).waitFor({ timeout: 20_000 });

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"type":"file"');
        expect(log).toContain(UPLOAD_NAME);
        expect(log).toContain(MARKER);

        const sidebar = await fetch(
          `${shell.base}/sidebar/file?path=${encodeURIComponent(previewPath)}`,
        );
        expect(sidebar.status).toBe(200);
        expect(sidebar.headers.get("content-type")).toMatch(/text\/markdown/);
        expect(await sidebar.text()).toBe(PREVIEW_BODY);

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
