import {
  clampCodeTimeout,
  DEFAULT_CODE_MAX_OLD_GENERATION_SIZE_MB,
  DEFAULT_CODE_MAX_OUTPUT_BYTES,
  DEFAULT_CODE_MAX_TIMEOUT_MS,
  DEFAULT_CODE_TIMEOUT_MS,
  type CodeRunOptions,
  type CodeRunResult,
  type CodeRuntime,
  type CodeRuntimeOptions,
} from "@xrkseek/code-runtime";
import { shQuote } from "./quote.js";
import type { SshSession } from "./session.js";

/**
 * `run_code` over SSH: temp `.mjs` on the remote + Node (Hermes-style backend).
 * Not a local worker_threads sandbox — isolation is the remote process only.
 */
export function createSshCodeRuntime(
  session: SshSession,
  options: CodeRuntimeOptions = {},
): CodeRuntime {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
  const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_CODE_MAX_TIMEOUT_MS;
  const maxOutputBytes =
    options.maxOutputBytes ?? DEFAULT_CODE_MAX_OUTPUT_BYTES;
  const node = session.config.nodeExecutable ?? "node";
  const heapMb =
    options.maxOldGenerationSizeMb ?? DEFAULT_CODE_MAX_OLD_GENERATION_SIZE_MB;

  return {
    timeout: { defaultMs: timeoutMs, maxMs: maxTimeoutMs },
    maxOutputBytes,
    async run(
      source: string,
      signal?: AbortSignal,
      opts?: CodeRunOptions,
    ): Promise<CodeRunResult> {
      const budget = clampCodeTimeout(opts?.timeoutMs, timeoutMs, maxTimeoutMs);
      const b64 = Buffer.from(source, "utf8").toString("base64");
      const packPy = [
        "import sys,base64,os",
        `m=${maxOutputBytes}`,
        "out=open(os.environ['O'],'rb').read() if os.path.exists(os.environ['O']) else b''",
        "err=open(os.environ['E'],'rb').read() if os.path.exists(os.environ['E']) else b''",
        "trunc=1 if len(out)+len(err)>m else 0",
        "out=out[:m]; err=err[:max(0,m-len(out))]",
        "sys.stdout.write(str(trunc)+'\\n'+base64.b64encode(out).decode()+'\\n'+base64.b64encode(err).decode())",
      ].join(";");

      const wrapped = [
        "tmp=$(mktemp /tmp/xrk-run-code-XXXXXX.mjs)",
        `printf '%s' ${shQuote(b64)} | base64 -d > "$tmp"`,
        'outf="$tmp.out"; errf="$tmp.err"',
        "set +e",
        `${shQuote(node)} --max-old-space-size=${heapMb} "$tmp" >"$outf" 2>"$errf"`,
        "ec=$?",
        `O="$outf" E="$errf" python3 -c ${shQuote(packPy)}`,
        'rm -f "$tmp" "$outf" "$errf"',
        "exit $ec",
      ].join("; ");

      const r = await session.exec(wrapped, {
        ...(signal ? { signal } : {}),
        timeoutMs: budget + 5_000,
      });

      const lines = r.stdout.split("\n");
      const truncFlag = lines[0]?.trim() === "1";
      const stdout = Buffer.from(lines[1] ?? "", "base64").toString("utf8");
      const stderr = Buffer.from(lines[2] ?? "", "base64").toString("utf8");

      if (r.killed || signal?.aborted) {
        return { stdout, stderr, error: "aborted" };
      }
      if (r.exitCode !== 0 && r.exitCode !== null) {
        return {
          stdout,
          stderr,
          error:
            stderr.trim() || `remote node exited with code ${r.exitCode}`,
          ...(truncFlag ? { truncated: true } : {}),
        };
      }
      return {
        stdout,
        stderr,
        ...(truncFlag ? { truncated: true } : {}),
      };
    },
  };
}
