import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSidebarPublicHandler } from "../src/sidebar/index.js";
import {
  OfficeToPdfError,
  createSofficeOfficeToPdfProvider,
} from "../src/sidebar/office-to-pdf.js";

async function withSidebar(
  options: Parameters<typeof createSidebarPublicHandler>[0],
  run: (base: string) => Promise<void>,
): Promise<void> {
  const handler = createSidebarPublicHandler(options);
  const server = createServer((req, res) => {
    void (async () => {
      const claimed = await handler(req, res);
      if (!claimed) {
        res.writeHead(404);
        res.end("no");
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("sidebar Office→PDF preview", () => {
  it("converts via the injected provider and leaves raw file reads alone", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-office-pdf-"));
    const doc = path.join(root, "report.docx");
    writeFileSync(doc, "not-a-real-docx");
    await withSidebar(
      {
        defaultCwd: root,
        officeToPdf: {
          async convert(request) {
            expect(request.path).toBe(doc);
            return { pdf: Buffer.from("%PDF-1.4 preview\n"), missingFonts: [] };
          },
        },
      },
      async (base) => {
        const preview = await fetch(
          `${base}/sidebar/file?preview=pdf&path=${encodeURIComponent(doc)}`,
        );
        expect(preview.status).toBe(200);
        expect(preview.headers.get("content-type")).toBe("application/pdf");
        expect(await preview.text()).toContain("%PDF-1.4 preview");

        const raw = await fetch(
          `${base}/sidebar/file?path=${encodeURIComponent(doc)}`,
        );
        expect(raw.headers.get("content-type")).toBe("application/octet-stream");
        expect(await raw.text()).toBe("not-a-real-docx");
      },
    );
  });

  it("reports unavailable when soffice is missing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-office-missing-"));
    const doc = path.join(root, "report.docx");
    writeFileSync(doc, "x");
    const provider = createSofficeOfficeToPdfProvider({
      command: "xrk-soffice-not-installed",
    });
    await expect(provider.convert({ path: doc })).rejects.toMatchObject({
      name: "OfficeToPdfError",
      code: "unavailable",
    });
    await expect(
      provider.convert({ path: path.join(root, "note.txt") }),
    ).rejects.toBeInstanceOf(OfficeToPdfError);
  });
});
