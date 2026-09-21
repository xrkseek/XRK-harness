import { deflateRawSync } from "node:zlib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFsLocalProvider, createFsTools } from "../src/index.js";

function zipFiles(files: Record<string, Buffer>, method: 0 | 8 = 0): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const chunk = Buffer.concat([local, nameBuf, data]);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(chunk);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += chunk.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

describe("read document extraction", () => {
  it("converts ipynb, docx, xlsx, and pdf inside read_file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-doc-"));
    const fs = createFsLocalProvider({ root });
    await writeFile(
      path.join(root, "note.ipynb"),
      JSON.stringify({
        cells: [
          { cell_type: "markdown", source: ["# Title\n"] },
          {
            cell_type: "code",
            source: "print(1)\n",
            outputs: [{ text: "1\n" }],
          },
        ],
      }),
    );
    await writeFile(
      path.join(root, "note.docx"),
      zipFiles(
        {
          "word/document.xml": Buffer.from(
            `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello doc</w:t></w:r></w:p></w:body></w:document>`,
          ),
        },
        8,
      ),
    );
    await writeFile(
      path.join(root, "book.xlsx"),
      zipFiles({
        "xl/sharedStrings.xml": Buffer.from(
          `<sst><si><t>Hello</t></si></sst>`,
        ),
        "xl/workbook.xml": Buffer.from(
          `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>`,
        ),
        "xl/_rels/workbook.xml.rels": Buffer.from(
          `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
        ),
        "xl/worksheets/sheet1.xml": Buffer.from(
          `<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row></sheetData></worksheet>`,
        ),
      }),
    );
    await writeFile(
      path.join(root, "plain.pdf"),
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 44 >>\nstream\nBT (Hello pdf) Tj ET\nendstream\nendobj\n%%EOF\n"),
    );
    await writeFile(path.join(root, "not-a.docx"), "plain text\n");

    const notebook = await fs.read("note.ipynb");
    expect(notebook.content).toContain("Markdown cell 1");
    expect(notebook.content).toContain("# Title");
    expect(notebook.content).toContain("print(1)");
    expect(notebook.content).toContain("Output (cell 1)");

    const doc = await fs.read("note.docx");
    expect(doc.content).toContain("Hello doc");

    const sheet = await fs.read("book.xlsx");
    expect(sheet.content).toContain("Sheet: Data");
    expect(sheet.content).toContain("Hello\t2");

    const pdf = await fs.read("plain.pdf");
    expect(pdf.content).toContain("Hello pdf");

    const fallback = await fs.read("not-a.docx");
    expect(fallback.content).toBe("plain text\n");

    const tools = createFsTools(fs);
    const read = tools.find((t) => t.name === "read_file");
    expect(read?.description).toMatch(/PDF, DOCX, XLSX, and ipynb/);
    const shown = await read!.execute({ path: "note.docx" });
    expect(String(shown.content)).toContain("Hello doc");
    expect(tools.some((t) => t.name === "extract_document")).toBe(false);
  });

  it("says when a PDF has no text layer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-pdf-"));
    const fs = createFsLocalProvider({ root });
    await writeFile(path.join(root, "scan.pdf"), Buffer.from("%PDF-1.4\n%%EOF\n"));
    const out = await fs.read("scan.pdf");
    expect(out.content).toMatch(/no extractable text layer/);
  });
});
