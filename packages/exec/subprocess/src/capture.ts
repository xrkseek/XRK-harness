import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Retained stdout/stderr for ordinary piped spawns. Full capture of a
 * CPU-bound flood (OCR logs, etc.) would copy gigabytes on the Host event
 * loop and stall every other session's LLM stream.
 */
export const SUBPROCESS_CAPTURE_MAX_BYTES = 256 * 1024;

/**
 * Whole-stream spill cap (DSH OutputCollector). Beyond this the spill file is
 * discarded and only the in-memory tail remains.
 */
export const SUBPROCESS_SPILL_MAX_BYTES = 20_000_000;

const TRUNCATED_MARK = "\n[output truncated]\n";

/**
 * Append `chunk` keeping only a UTF-8 tail of `maxBytes` (leading truncation
 * marker). Hot path avoids `Array.from` over the whole string.
 */
export function appendUtf8TailCap(
  current: string,
  chunk: string,
  maxBytes: number = SUBPROCESS_CAPTURE_MAX_BYTES,
): string {
  if (!chunk) return current;
  if (maxBytes <= 0) return "";
  const have = Buffer.byteLength(current);
  const add = Buffer.byteLength(chunk);
  if (have + add <= maxBytes) return current + chunk;
  const mark = Buffer.from(TRUNCATED_MARK, "utf8");
  const keep = Math.max(0, maxBytes - mark.byteLength);
  const buf = Buffer.concat([
    Buffer.from(current, "utf8"),
    Buffer.from(chunk, "utf8"),
  ]);
  if (buf.byteLength <= keep) {
    return buf.toString("utf8");
  }
  let start = buf.byteLength - keep;
  while (start < buf.byteLength && (buf[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  return mark.toString("utf8") + buf.subarray(start).toString("utf8");
}

export type SpillFailureReporter = (error: unknown, label: string) => void;

export interface SpillOptions {
  readonly maxBytes: number;
  readonly dir: string;
  readonly onFailure: SpillFailureReporter;
}

export interface CollectedOutput {
  readonly text: string;
  readonly truncated: boolean;
  readonly spillPath?: string;
  readonly totalBytes: number;
}

let spillCounter = 0;
let defaultSpillDir: string | undefined;

/** Private per-process spill directory (0700) under OS tmpdir — DSH shape. */
export function privateSpillDir(): string {
  defaultSpillDir ??= mkdtempSync(join(tmpdir(), "xrk-subprocess-"));
  return defaultSpillDir;
}

process.once("exit", () => {
  if (defaultSpillDir === undefined) return;
  try {
    rmdirSync(defaultSpillDir);
  } catch {
    // best-effort: ENOENT / ENOTEMPTY / EBUSY must not change exit code
  }
});

function reportSpillFailureToStderr(error: unknown, label: string): void {
  process.stderr.write(
    `xrk-exec-subprocess: ${label} spill failed; only the in-memory tail is retained: ${String(error)}\n`,
  );
}

/**
 * Spill binding for background jobs. Prefer Host `{XRK_HOME}/spill` (in
 * `hostReadableRoots`) so `job_output` paths are readable via `read_file`.
 * Falls back to a private OS-tmpdir directory when no dir is supplied.
 */
export function prepareSpillBinding(
  internals: {
    readonly spillDir?: string;
    readonly onSpillFailure?: SpillFailureReporter;
    readonly maxBytes?: number;
  } = {},
): SpillOptions {
  const dir = internals.spillDir ?? privateSpillDir();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // openSync('wx') will fail later and degrade to in-memory tail
  }
  return {
    maxBytes: internals.maxBytes ?? SUBPROCESS_SPILL_MAX_BYTES,
    dir,
    onFailure: internals.onSpillFailure ?? reportSpillFailureToStderr,
  };
}

/**
 * Bounded in-memory UTF-8 tail with optional spill file (DSH OutputCollector).
 * On overflow, every chunk (including prior ones) is appended to a private
 * spill file while the retained window slides to the last `maxBytes`.
 */
export class StreamTailCollector {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private dropped = false;
  private spillFd: number | undefined;
  private spillFile: string | undefined;
  private spillDisabled: boolean;
  private total = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly label: string,
    private readonly spill: SpillOptions | undefined,
  ) {
    this.spillDisabled = spill === undefined;
  }

  push(chunk: string | Buffer): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (buf.byteLength === 0) return;
    this.total += buf.byteLength;
    const overflows = this.bytes + buf.byteLength > this.maxBytes;
    const spill = this.spill;
    if (
      spill !== undefined &&
      !this.spillDisabled &&
      (overflows || this.spillFd !== undefined)
    ) {
      this.spillAll(spill, buf);
    }
    this.chunks.push(buf);
    this.bytes += buf.byteLength;
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0]!;
      const excess = this.bytes - this.maxBytes;
      if (head.byteLength <= excess) {
        this.chunks.shift();
        this.bytes -= head.byteLength;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.bytes -= excess;
      }
      this.dropped = true;
    }
  }

  private spillAll(spill: SpillOptions, chunk: Buffer): void {
    if (this.total > spill.maxBytes) {
      this.discardSpill();
      return;
    }
    try {
      if (this.spillFd === undefined) {
        const file = join(
          spill.dir,
          `xrk-subprocess-${process.pid}-${++spillCounter}-${randomBytes(6).toString("hex")}-${this.label}.log`,
        );
        const fd = openSync(file, "wx", 0o600);
        this.spillFile = file;
        this.spillFd = fd;
        for (const prior of this.chunks) writeSync(fd, prior);
      }
      writeSync(this.spillFd, chunk);
    } catch (error) {
      this.discardSpill();
      try {
        spill.onFailure(error, this.label);
      } catch (reporterFailure) {
        process.stderr.write(
          `xrk-exec-subprocess: spill failure reporter threw: ${String(reporterFailure)}\n`,
        );
      }
    }
  }

  private discardSpill(): void {
    const fd = this.spillFd;
    const file = this.spillFile;
    this.spillFd = undefined;
    this.spillFile = undefined;
    this.spillDisabled = true;
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        this.spillFd = fd;
      }
    }
    if (file !== undefined) {
      try {
        unlinkSync(file);
      } catch {
        // leave at most maxSpillBytes behind
      }
    }
  }

  /** Live spill path while open (undefined when not spilling / discarded). */
  currentSpillPath(): string | undefined {
    return this.spillFile;
  }

  seal(): void {
    if (this.spillFd === undefined) return;
    try {
      closeSync(this.spillFd);
    } catch {
      this.spillFile = undefined;
    }
    this.spillFd = undefined;
  }

  /**
   * Seal spill and return the model-facing tail. When truncated, prefix the
   * same `[output truncated]` marker as {@link appendUtf8TailCap}.
   */
  finalize(): CollectedOutput {
    this.seal();
    const raw = Buffer.concat(this.chunks);
    let text = raw.toString("utf8");
    if (this.dropped) {
      const mark = Buffer.from(TRUNCATED_MARK, "utf8");
      const keep = Math.max(0, this.maxBytes - mark.byteLength);
      if (raw.byteLength > keep) {
        let start = raw.byteLength - keep;
        while (start < raw.byteLength && (raw[start]! & 0xc0) === 0x80) {
          start += 1;
        }
        text = mark.toString("utf8") + raw.subarray(start).toString("utf8");
      } else {
        text = mark.toString("utf8") + text;
      }
    }
    return {
      text,
      truncated: this.dropped,
      totalBytes: this.total,
      ...(this.spillFile !== undefined ? { spillPath: this.spillFile } : {}),
    };
  }

  /** Best-effort remove a sealed spill file (job prune / dispose). */
  static unlinkSpill(path: string | undefined): void {
    if (path === undefined) return;
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
