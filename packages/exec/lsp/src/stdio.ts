import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LspConnection } from "./connection.js";
import {
  negotiatePositionEncoding,
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
  type WireInitializeResult,
  type WireServerCapabilities,
} from "./translate.js";
import {
  LspError,
  type DisposableLspService,
  type LspOperation,
  type LspQueryRequest,
  type LspQueryResult,
} from "./types.js";

export const DEFAULT_MAX_DOCUMENT_BYTES = 1_048_576;
export const DEFAULT_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

export const DEFAULT_EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ["utf-16"] },
  workspace: { workspaceFolders: true, configuration: true },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    hover: { contentFormat: ["markdown", "plaintext"] },
    definition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
  },
} as const;

export interface StdioLspOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly extensionToLanguage?: Readonly<Record<string, string>>;
  readonly maxDocumentBytes?: number;
  readonly maxMessageBytes?: number;
}

interface HostSource {
  readonly fileUrl: string;
  readonly text: string;
  readonly languageId: string;
  readonly workspaceUri: string;
}

class LspSession {
  private readonly connection: LspConnection;
  private capabilities: WireServerCapabilities | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly ready: Promise<void>;

  constructor(
    workspaceRoot: string,
    private readonly workspaceUri: string,
    options: StdioLspOptions,
    maxMessageBytes: number,
  ) {
    this.connection = new LspConnection(
      {
        command: options.command,
        args: options.args ?? [],
        cwd: workspaceRoot,
        ...(options.env ? { env: options.env } : {}),
        maxMessageBytes,
      },
      (method, params) => this.answerServerRequest(method, params),
    );
    this.ready = this.initialize();
    this.ready.catch(() => {});
  }

  get dead(): boolean {
    return this.disposed || this.connection.failed;
  }

  query(
    request: LspQueryRequest,
    source: HostSource,
    signal?: AbortSignal,
  ): Promise<LspQueryResult> {
    const run = this.queue.then(() => this.runQuery(request, source, signal));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    try {
      await this.connection.request("shutdown", null);
      await this.connection.notify("exit", null);
    } catch {
      // ignore
    }
    this.connection.kill();
    await this.connection.closed.catch(() => {});
  }

  private async initialize(): Promise<void> {
    const initializeResult = (await this.connection.request("initialize", {
      processId: null,
      rootUri: this.workspaceUri,
      workspaceFolders: [{ uri: this.workspaceUri, name: "workspace" }],
      capabilities: CLIENT_CAPABILITIES,
    })) as WireInitializeResult;
    const capabilities = initializeResult.capabilities;
    negotiatePositionEncoding(capabilities.positionEncoding);
    this.capabilities = capabilities;
    await this.connection.notify("initialized", {});
  }

  private async runQuery(
    request: LspQueryRequest,
    source: HostSource,
    signal?: AbortSignal,
  ): Promise<LspQueryResult> {
    if (this.disposed) {
      throw new LspError("LSP instance was disposed", "LSP_DISPOSED");
    }
    throwIfAborted(signal);
    await this.ready;
    const capabilities = this.capabilities;
    if (capabilities === undefined) {
      throw new Error("LSP instance is not initialized");
    }
    if (!supportsOperation(capabilities, request.operation)) {
      throw new LspError(
        `server does not support ${request.operation}`,
        "LSP_UNSUPPORTED_OPERATION",
      );
    }
    if (!supportsTransientOpen(capabilities.textDocumentSync)) {
      throw new LspError(
        "server does not support the transient textDocument/didOpen this host requires",
        "LSP_UNSUPPORTED_OPERATION",
      );
    }
    const uri = source.fileUrl;
    let opened = false;
    try {
      throwIfAborted(signal);
      await this.connection.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: source.languageId,
          version: 1,
          text: source.text,
        },
      });
      opened = true;
      const requestId = this.connection.peekNextId();
      const payload = await raceAbort(
        this.sendRequest(request.operation, uri, request.position),
        requestId,
        this.connection,
        signal,
      );
      return this.normalize(request.operation, payload);
    } finally {
      if (opened && !this.disposed && !this.connection.failed) {
        try {
          await this.connection.notify("textDocument/didClose", {
            textDocument: { uri },
          });
        } catch {
          this.connection.kill();
        }
      }
    }
  }

  private sendRequest(
    operation: LspOperation,
    uri: string,
    position: LspQueryRequest["position"],
  ): Promise<unknown> {
    const params = {
      textDocument: { uri },
      position: { line: position.line, character: position.character },
      ...(operation === "findReferences"
        ? { context: { includeDeclaration: true } }
        : {}),
    };
    return this.connection.request(requestMethod(operation), params);
  }

  private normalize(
    operation: LspOperation,
    payload: unknown,
  ): LspQueryResult {
    if (operation === "hover") {
      return { kind: "hover", hover: normalizeHover(payload) };
    }
    return {
      kind: "locations",
      locations: normalizeLocations(payload),
      resolvedWorkspaceUri: this.workspaceUri,
    };
  }

  private answerServerRequest(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    if (method === "workspace/configuration") {
      const record = params as { items?: unknown[] } | null;
      const items = Array.isArray(record?.items) ? record.items : [];
      return Promise.resolve(items.map(() => null));
    }
    if (
      method === "client/registerCapability" ||
      method === "client/unregisterCapability" ||
      method === "workspace/workspaceFolders"
    ) {
      return Promise.resolve(null);
    }
    if (method === "workspace/applyEdit") {
      return Promise.reject(
        new Error("workspace/applyEdit is not permitted by this host"),
      );
    }
    return Promise.reject(new Error(`unsupported server request: ${method}`));
  }
}

export function createStdioLspService(
  options: StdioLspOptions,
): DisposableLspService {
  const maxDocumentBytes =
    options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const extensionToLanguage = {
    ...DEFAULT_EXTENSION_TO_LANGUAGE,
    ...options.extensionToLanguage,
  };
  const sessions = new Map<string, LspSession>();

  const getSession = (workspaceRoot: string): LspSession => {
    const key = path.resolve(workspaceRoot);
    const existing = sessions.get(key);
    if (existing && !existing.dead) return existing;
    const session = new LspSession(
      key,
      pathToFileURL(key).href,
      options,
      maxMessageBytes,
    );
    sessions.set(key, session);
    return session;
  };

  return {
    async query(request, signal) {
      const source = await readHostSource(
        request,
        extensionToLanguage,
        maxDocumentBytes,
      );
      return getSession(path.resolve(request.workspaceRoot)).query(
        request,
        source,
        signal,
      );
    },
    async dispose() {
      const all = [...sessions.values()];
      sessions.clear();
      await Promise.all(all.map((session) => session.dispose()));
    },
  };
}

async function readHostSource(
  request: LspQueryRequest,
  extensionToLanguage: Readonly<Record<string, string>>,
  maxDocumentBytes: number,
): Promise<HostSource> {
  const rootAbs = path.resolve(request.workspaceRoot);
  let rootStat;
  try {
    rootStat = await stat(rootAbs);
  } catch (error) {
    throw new LspError(
      `workspace root "${request.workspaceRoot}" cannot be resolved: ${messageOf(error)}`,
      "LSP_IO",
    );
  }
  if (!rootStat.isDirectory()) {
    throw new LspError(
      `workspace root "${request.workspaceRoot}" is not a directory`,
      "LSP_PATH",
    );
  }
  const targetAbs = resolveWithinRoot(rootAbs, request.filePath);
  const ext = path.extname(targetAbs).toLowerCase();
  const languageId = extensionToLanguage[ext];
  if (!languageId) {
    throw new LspError(
      `no language server registered for extension ${ext || "(none)"}`,
      "LSP_UNAVAILABLE",
    );
  }
  let text: string;
  try {
    const buf = await readFile(targetAbs);
    if (buf.byteLength > maxDocumentBytes) {
      throw new LspError(
        `source "${request.filePath}" exceeds the ${maxDocumentBytes}-byte limit`,
        "LSP_IO",
      );
    }
    text = buf.toString("utf8");
  } catch (error) {
    if (error instanceof LspError) throw error;
    throw new LspError(
      `source "${request.filePath}" could not be read: ${messageOf(error)}`,
      "LSP_IO",
    );
  }
  return {
    fileUrl: pathToFileURL(targetAbs).href,
    text,
    languageId,
    workspaceUri: pathToFileURL(rootAbs).href,
  };
}

function resolveWithinRoot(rootAbs: string, userPath: string): string {
  const targetAbs = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(rootAbs, userPath);
  const rel = path.relative(rootAbs, targetAbs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new LspError(
      `source "${userPath}" resolves outside the workspace`,
      "LSP_PATH",
    );
  }
  return targetAbs;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  }
}

async function raceAbort(
  send: Promise<unknown>,
  requestId: number,
  connection: LspConnection,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!signal) return send;
  if (signal.aborted) {
    connection.cancel(requestId);
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      connection.cancel(requestId);
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    send.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
