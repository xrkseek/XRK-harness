/**
 * Sidebar Office→PDF seam. Independent of `read_file`.
 * Default engine is LibreOffice `soffice` when it is on PATH; callers may
 * inject another {@link OfficeToPdfProvider}.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OFFICE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

export type OfficeToPdfErrorCode =
  | "unsupported-format"
  | "unavailable"
  | "input-too-large"
  | "timeout"
  | "failed";

export class OfficeToPdfError extends Error {
  readonly code: OfficeToPdfErrorCode;

  constructor(code: OfficeToPdfErrorCode, message: string) {
    super(message);
    this.name = "OfficeToPdfError";
    this.code = code;
  }
}

export interface OfficeToPdfRequest {
  readonly path: string;
  readonly signal?: AbortSignal;
}

export interface OfficeToPdfResult {
  readonly pdf: Uint8Array;
  readonly missingFonts: readonly string[];
}

export interface OfficeToPdfProvider {
  convert(request: OfficeToPdfRequest): Promise<OfficeToPdfResult>;
}

export function officePreviewExtension(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return OFFICE_EXTENSIONS.has(ext) ? ext : undefined;
}

export function createSofficeOfficeToPdfProvider(options?: {
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxInputBytes?: number;
}): OfficeToPdfProvider {
  const command = options?.command ?? "soffice";
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const maxInputBytes = options?.maxInputBytes ?? 50 * 1024 * 1024;
  return {
    async convert(request) {
      if (request.signal?.aborted) {
        throw new OfficeToPdfError("failed", "aborted");
      }
      const ext = officePreviewExtension(request.path);
      if (!ext) {
        throw new OfficeToPdfError(
          "unsupported-format",
          path.extname(request.path) || "unknown",
        );
      }
      const info = await stat(request.path);
      if (!info.isFile()) throw new OfficeToPdfError("failed", "not a file");
      if (info.size > maxInputBytes) {
        throw new OfficeToPdfError("input-too-large", String(info.size));
      }
      const dir = await mkdtemp(path.join(tmpdir(), "xrk-office-pdf-"));
      try {
        await runSoffice(command, request.path, dir, timeoutMs, request.signal);
        const pdfPath = path.join(
          dir,
          `${path.basename(request.path, ext)}.pdf`,
        );
        const pdf = await readFile(pdfPath);
        if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
          throw new OfficeToPdfError("failed", "converter did not write a PDF");
        }
        return { pdf: new Uint8Array(pdf), missingFonts: [] };
      } catch (err) {
        if (err instanceof OfficeToPdfError) throw err;
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new OfficeToPdfError("unavailable", `${command} is not installed`);
        }
        throw new OfficeToPdfError(
          "failed",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function runSoffice(
  command: string,
  file: string,
  outDir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      ["--headless", "--convert-to", "pdf", "--outdir", outDir, file],
      { windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new OfficeToPdfError("timeout", "soffice timed out"));
    }, timeoutMs);
    const onAbort = () => {
      child.kill();
      reject(new OfficeToPdfError("failed", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (err?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    child.on("error", (err) => finish(err));
    child.on("exit", (code) => {
      if (code === 0) finish();
      else finish(new OfficeToPdfError("failed", `soffice exit ${code}`));
    });
  });
}
