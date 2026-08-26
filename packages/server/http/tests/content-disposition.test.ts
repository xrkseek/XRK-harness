import { describe, expect, it } from "vitest";
import { attachmentContentDisposition } from "../src/content-disposition.js";

describe("attachmentContentDisposition", () => {
  it("keeps ASCII filenames in filename=", () => {
    expect(attachmentContentDisposition("report.pdf")).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf',
    );
  });

  it("escapes non-ASCII for Node headers and adds filename*", () => {
    const header = attachmentContentDisposition("简历.docx");
    expect(header).toBe(
      'attachment; filename="__.docx"; filename*=UTF-8\'\'%E7%AE%80%E5%8E%86.docx',
    );
    expect(header).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
