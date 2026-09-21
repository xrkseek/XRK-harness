import { posix } from "node:path";
import {
  applyLiteralEdit,
  detectLineEndings,
  EditAmbiguousError,
  EditMismatchError,
  EditWithoutOldError,
  matchGlob,
  normalizeLineEndings,
  DOCUMENT_EXTRACT_MAX_BYTES,
  isDocumentExtractPath,
  textFromReadBuffer,
  restoreLineEndings,
  type FsEditOptions,
  type FsGlobOptions,
  type FsGrepHit,
  type FsGrepOptions,
  type FsIntentHandler,
  type FsService,
  type FsStatResult,
} from "@xrkseek/exec-fs";
import { normalizeRemoteAbs, resolveWithinRemoteRoot } from "./paths.js";
import { shQuote } from "./quote.js";
import type { SshSession } from "./session.js";

export interface FsSshOptions {
  readonly session: SshSession;
  /** Absolute remote workspace root (defaults to session config.workspace). */
  readonly root?: string;
  readonly defaultMaxBytes?: number;
}

async function requireOk(
  session: SshSession,
  command: string,
  label: string,
): Promise<{ stdout: string; stderr: string }> {
  const r = await session.exec(command);
  if (r.exitCode !== 0) {
    const detail = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim();
    throw new Error(`ssh ${label}: ${detail}`);
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

/** Provider — remote POSIX disk bound to workspace root (Hermes shell file ops). */
export function createFsSshProvider(options: FsSshOptions): FsService {
  const session = options.session;
  const root = normalizeRemoteAbs(options.root ?? session.config.workspace);
  const defaultMaxBytes = options.defaultMaxBytes ?? 512_000;
  const intentHandlers = new Set<FsIntentHandler>();
  const emit = (
    kind: "fs/read-intent" | "fs/write-intent",
    userPath: string,
  ) => {
    for (const h of intentHandlers) h(kind, userPath);
  };

  const readUtf8 = async (
    userPath: string,
    maxBytes = defaultMaxBytes,
  ): Promise<{ content: string; truncated?: boolean }> => {
    emit("fs/read-intent", userPath);
    const abs = resolveWithinRemoteRoot(root, userPath);
    const fetchCap = isDocumentExtractPath(userPath)
      ? DOCUMENT_EXTRACT_MAX_BYTES
      : maxBytes;
    const { stdout } = await requireOk(
      session,
      `python3 -c ${shQuote(
        [
          "import sys,base64",
          `p=${JSON.stringify(abs)}`,
          `m=${fetchCap}`,
          "d=open(p,'rb').read()",
          "t=len(d)>m",
          "d=d[:m]",
          "sys.stdout.write(('1' if t else '0')+base64.b64encode(d).decode())",
        ].join(";"),
      )}`,
      "read",
    );
    const truncated = stdout[0] === "1";
    const buf = Buffer.from(stdout.slice(1), "base64");
    if (isDocumentExtractPath(userPath)) {
      if (truncated) {
        return {
          content: `Document too large to convert (limit is ${DOCUMENT_EXTRACT_MAX_BYTES} bytes)`,
          truncated: true,
        };
      }
      return textFromReadBuffer(buf, userPath, maxBytes);
    }
    return {
      content: buf.toString("utf8"),
      ...(truncated ? { truncated: true as const } : {}),
    };
  };

  const writeUtf8 = async (userPath: string, content: string): Promise<void> => {
    emit("fs/write-intent", userPath);
    const abs = resolveWithinRemoteRoot(root, userPath);
    const b64 = Buffer.from(content, "utf8").toString("base64");
    await requireOk(
      session,
      [
        `mkdir -p ${shQuote(posix.dirname(abs))}`,
        `printf '%s' ${shQuote(b64)} | base64 -d > ${shQuote(abs)}`,
      ].join(" && "),
      "write",
    );
  };

  return {
    root,
    resolvePath(userPath) {
      return resolveWithinRemoteRoot(root, userPath);
    },
    read(userPath, maxBytes) {
      return readUtf8(userPath, maxBytes);
    },
    async readBytes(userPath, maxBytes = defaultMaxBytes) {
      emit("fs/read-intent", userPath);
      const abs = resolveWithinRemoteRoot(root, userPath);
      const r = await session.exec(
        `python3 -c ${shQuote(
          [
            "import sys,base64",
            `p=${JSON.stringify(abs)}`,
            `m=${maxBytes}`,
            "d=open(p,'rb').read()",
            "sys.exit(2) if len(d)>m else None",
            "sys.stdout.buffer.write(base64.b64encode(d))",
          ].join(";"),
        )}`,
      );
      if (r.exitCode === 2) {
        throw new Error(`file exceeds read byte limit`);
      }
      if (r.exitCode !== 0) {
        throw new Error(
          `ssh readBytes: ${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim()}`,
        );
      }
      return new Uint8Array(Buffer.from(r.stdout.trim(), "base64"));
    },
    write(userPath, content) {
      return writeUtf8(userPath, content);
    },
    async edit(userPath, oldContent, newContent, editOpts?: FsEditOptions) {
      if (oldContent === undefined || oldContent === null) {
        throw new EditWithoutOldError("edit requires oldContent");
      }
      // Match local provider: edit emits write-intent only (no read-intent).
      const abs = resolveWithinRemoteRoot(root, userPath);
      const { stdout } = await requireOk(
        session,
        `python3 -c ${shQuote(
          [
            "import sys,base64",
            `p=${JSON.stringify(abs)}`,
            "sys.stdout.write(base64.b64encode(open(p,'rb').read()).decode())",
          ].join(";"),
        )}`,
        "edit-read",
      );
      const raw = Buffer.from(stdout.trim(), "base64").toString("utf8");
      const endings = detectLineEndings(raw);
      const currentLf = normalizeLineEndings(raw);
      try {
        const { content } = applyLiteralEdit(
          currentLf,
          String(oldContent),
          String(newContent ?? ""),
          editOpts?.replaceAll === true,
          userPath,
        );
        await writeUtf8(userPath, restoreLineEndings(content, endings));
      } catch (err) {
        if (err instanceof EditAmbiguousError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("edit mismatch") || message.includes("not found")) {
          throw new EditMismatchError(message);
        }
        throw err;
      }
    },
    async stat(userPath): Promise<FsStatResult> {
      const abs = resolveWithinRemoteRoot(root, userPath);
      const { stdout } = await requireOk(
        session,
        `python3 -c ${shQuote(
          [
            "import os,stat,sys,json",
            `p=${JSON.stringify(abs)}`,
            "st=os.stat(p)",
            "print(json.dumps({'size':st.st_size,'isFile':stat.S_ISREG(st.st_mode),'isDirectory':stat.S_ISDIR(st.st_mode)}))",
          ].join(";"),
        )}`,
        "stat",
      );
      return JSON.parse(stdout.trim()) as FsStatResult;
    },
    async mkdir(userPath) {
      emit("fs/write-intent", userPath);
      const abs = resolveWithinRemoteRoot(root, userPath);
      await requireOk(session, `mkdir -p ${shQuote(abs)}`, "mkdir");
    },
    async glob(pattern, globOpts?: FsGlobOptions) {
      const maxResults = globOpts?.maxResults ?? 200;
      const { stdout } = await requireOk(
        session,
        `python3 -c ${shQuote(
          [
            "import os,json",
            `root=${JSON.stringify(root)}`,
            "out=[]",
            "for dp, dns, fns in os.walk(root):",
            "  dns[:] = [d for d in dns if d not in ('.git','node_modules')]",
            "  for fn in fns:",
            "    abs=os.path.join(dp,fn)",
            "    rel=os.path.relpath(abs, root).replace(os.sep,'/')",
            "    out.append(rel)",
            "print(json.dumps(out))",
          ].join("\n"),
        )}`,
        "glob",
      );
      const all = JSON.parse(stdout.trim()) as string[];
      const hits: string[] = [];
      for (const rel of all) {
        if (matchGlob(rel, pattern)) {
          hits.push(rel);
          if (hits.length >= maxResults) break;
        }
      }
      return hits;
    },
    async grep(
      pattern,
      grepOpts?: FsGrepOptions,
    ): Promise<readonly FsGrepHit[]> {
      const maxResults = grepOpts?.maxResults ?? 100;
      const scope = resolveWithinRemoteRoot(root, grepOpts?.path ?? ".");
      const flags = grepOpts?.caseInsensitive ? "i" : "";
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch {
        throw new Error(`invalid grep pattern: ${pattern}`);
      }
      const { stdout } = await requireOk(
        session,
        `python3 -c ${shQuote(
          [
            "import os,json",
            `root=${JSON.stringify(root)}`,
            `scope=${JSON.stringify(scope)}`,
            "rows=[]",
            "def walk(base):",
            "  if os.path.isfile(base):",
            "    yield base; return",
            "  for dp, dns, fns in os.walk(base):",
            "    dns[:] = [d for d in dns if d not in ('.git','node_modules')]",
            "    for fn in fns: yield os.path.join(dp,fn)",
            "for abs in walk(scope):",
            "  try:",
            "    text=open(abs,'r',encoding='utf-8',errors='replace').read()",
            "  except Exception: continue",
            "  rel=os.path.relpath(abs, root).replace(os.sep,'/')",
            "  for i,line in enumerate(text.splitlines(),1):",
            "    rows.append({'path':rel,'line':i,'text':line})",
            "print(json.dumps(rows))",
          ].join("\n"),
        )}`,
        "grep",
      );
      const rows = JSON.parse(stdout.trim()) as FsGrepHit[];
      const hits: FsGrepHit[] = [];
      const fileGlob = grepOpts?.glob;
      for (const row of rows) {
        if (fileGlob && !matchGlob(row.path, fileGlob)) continue;
        if (!re.test(row.text)) continue;
        hits.push(row);
        if (hits.length >= maxResults) break;
      }
      return hits;
    },
    onIntent(handler) {
      intentHandlers.add(handler);
      return () => {
        intentHandlers.delete(handler);
      };
    },
  };
}
