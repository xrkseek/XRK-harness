import { describe, expect, it } from "vitest";
import {
  fileHandleText,
  flattenText,
  projectFilesToText,
  type FileAttachmentRef,
} from "../src/index.ts";

const ref: FileAttachmentRef = {
  attachmentId: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  name: "report.pdf",
  bytes: 12,
};

describe("fileHandleText / projectFilesToText", () => {
  it("describes an uploaded file without a readable path", () => {
    const text = fileHandleText(ref, undefined);
    expect(text).toContain("report.pdf");
    expect(text).toContain("cannot access a readable path");
  });

  it("points models at read_file when a path is available", () => {
    const text = fileHandleText(ref, "/tmp/attachments/v1/files/ab/digest/report.pdf");
    expect(text).toContain("read_file");
    expect(text).toContain("/tmp/attachments/v1/files/ab/digest/report.pdf");
  });

  it("projects user file blocks before LLM assembly", () => {
    const messages = projectFilesToText(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "file", attachment: ref },
          ],
        },
      ],
      () => "/host/files/report.pdf",
    );
    expect(messages[0]?.role).toBe("user");
    const content = messages[0] && "content" in messages[0] ? messages[0].content : [];
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual([
      { type: "text", text: "see" },
      {
        type: "text",
        text: fileHandleText(ref, "/host/files/report.pdf"),
      },
    ]);
  });

  it("flattenText uses handle text for file blocks", () => {
    expect(
      flattenText([{ type: "file", attachment: ref }]),
    ).toBe(fileHandleText(ref, undefined));
  });
});
