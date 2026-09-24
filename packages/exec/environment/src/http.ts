/**
 * HTTP / serverless ExecEnvironment sample (Modal / e2b-style stub).
 *
 * Integrator-owned sidecar 鈥?not a real Modal SDK:
 * - `GET  /health` 鈫?`{ ok: true }`
 * - `POST /v1/exec` 鈫?`{ argv, cwd?, env?, timeoutMs? }` 鈫?subprocess result
 * - `POST /v1/fs` 鈫?`{ op, path, ... }` 鈫?fs op result
 *
 * Fail closed when the sidecar is unreachable at `isAvailable` / first create.
 */

import type {
  FsEditOptions,
  FsGlobOptions,
  FsGrepHit,
  FsGrepOptions,
  FsIntentHandler,
  FsService,
  FsStatResult,
} from "@xrkseek/exec-fs";
import type {
  SpawnOptions,
  SubprocessHandle,
  SubprocessResult,
  SubprocessService,
} from "@xrkseek/exec-subprocess";
import type { ExecEnvironmentProvider, ExecWorld } from "./types.js";

export interface HttpExecEnvironmentOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /**
   * Logical workspace root advertised to tools (sidecar may remap).
   * Default `/workspace`.
   */
  readonly remoteWorkspaceRoot?: string;
}

export class HttpExecEnvironmentError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = "EXEC_HTTP", status?: number) {
    super(message);
    this.name = "HttpExecEnvironmentError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function createHttpClient(options: HttpExecEnvironmentOptions) {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new HttpExecEnvironmentError(
      "http exec environment needs a non-empty baseUrl",
      "EXEC_HTTP_CONFIG",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (options.token?.trim()) {
    headers.Authorization = `Bearer ${options.token.trim()}`;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onOuter = () => ac.abort();
    signal?.addEventListener("abort", onOuter, { once: true });
    try {
      const res = await fetchImpl(joinUrl(baseUrl, path), {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: ac.signal,
      });
      const text = await res.text().catch(() => "");
      let json: unknown = undefined;
      if (text.trim()) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new HttpExecEnvironmentError(
          `exec-environment HTTP ${res.status}: ${text.slice(0, 200)}`,
          "EXEC_HTTP_BACKEND",
          res.status,
        );
      }
      return json;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuter);
    }
  }

  return { baseUrl, request };
}

function createHttpSubprocess(
  request: (
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>,
): SubprocessService {
  async function run(
    argv: readonly string[],
    opts?: SpawnOptions,
  ): Promise<SubprocessResult> {
    if (!argv.length) {
      return {
        stdout: "",
        stderr: "empty argv",
        exitCode: 1,
        signal: null,
        killed: false,
      };
    }
    const json = (await request(
      "POST",
      "/v1/exec",
      {
        argv: [...argv],
        ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts?.env !== undefined ? { env: opts.env } : {}),
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      },
      opts?.signal,
    )) as Partial<SubprocessResult>;
    return {
      stdout: String(json.stdout ?? ""),
      stderr: String(json.stderr ?? ""),
      exitCode:
        typeof json.exitCode === "number" || json.exitCode === null
          ? json.exitCode
          : 1,
      signal: (json.signal) ?? null,
      killed: Boolean(json.killed),
    };
  }

  return {
    spawn: run,
    start(argv, opts) {
      let settled: Promise<SubprocessResult> | undefined;
      const handle: SubprocessHandle = {
        kill() {
          /* sidecar may ignore; best-effort */
        },
        result() {
          settled ??= run(argv, opts);
          return settled;
        },
      };
      return handle;
    },
  };
}

function createHttpFs(
  request: (
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>,
  root: string,
): FsService {
  const intentHandlers = new Set<FsIntentHandler>();
  const emit = (
    kind: "fs/read-intent" | "fs/write-intent",
    userPath: string,
  ) => {
    for (const h of intentHandlers) h(kind, userPath);
  };

  async function fsOp(body: Record<string, unknown>): Promise<unknown> {
    return request("POST", "/v1/fs", body);
  }

  return {
    root,
    resolvePath(userPath) {
      return userPath.startsWith("/")
        ? userPath
        : `${root.replace(/\/+$/, "")}/${userPath.replace(/^\/+/, "")}`;
    },
    async read(userPath, maxBytes) {
      emit("fs/read-intent", userPath);
      const json = (await fsOp({
        op: "read",
        path: userPath,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      })) as { content?: unknown; text?: unknown; truncated?: unknown };
      const content = String(json.content ?? json.text ?? "");
      return {
        content,
        ...(json.truncated ? { truncated: true } : {}),
      };
    },
    async readBytes(userPath, maxBytes) {
      emit("fs/read-intent", userPath);
      const json = (await fsOp({
        op: "readBytes",
        path: userPath,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      })) as { base64?: string };
      const b64 = String(json.base64 ?? "");
      return Uint8Array.from(Buffer.from(b64, "base64"));
    },
    async write(userPath, content) {
      emit("fs/write-intent", userPath);
      await fsOp({ op: "write", path: userPath, content });
    },
    async edit(userPath, oldContent, newContent, options?: FsEditOptions) {
      emit("fs/write-intent", userPath);
      await fsOp({
        op: "edit",
        path: userPath,
        oldContent,
        newContent,
        ...(options ? { options } : {}),
      });
    },
    async remove(userPath) {
      emit("fs/write-intent", userPath);
      await fsOp({ op: "remove", path: userPath });
    },
    async stat(userPath) {
      const json = (await fsOp({ op: "stat", path: userPath })) as FsStatResult;
      return {
        isFile: Boolean(json.isFile),
        isDirectory: Boolean(json.isDirectory),
        size: Number(json.size ?? 0),
      };
    },
    async mkdir(userPath) {
      emit("fs/write-intent", userPath);
      await fsOp({ op: "mkdir", path: userPath });
    },
    async glob(pattern, options?: FsGlobOptions) {
      const json = (await fsOp({
        op: "glob",
        pattern,
        ...(options ? { options } : {}),
      })) as { paths?: unknown };
      return Array.isArray(json.paths)
        ? json.paths.map((p) => String(p))
        : [];
    },
    async grep(pattern, options?: FsGrepOptions) {
      const json = (await fsOp({
        op: "grep",
        pattern,
        ...(options ? { options } : {}),
      })) as { hits?: unknown };
      if (!Array.isArray(json.hits)) return [];
      return json.hits as FsGrepHit[];
    },
    onIntent(handler) {
      intentHandlers.add(handler);
      return () => {
        intentHandlers.delete(handler);
      };
    },
  };
}

/**
 * Build an {@link ExecEnvironmentProvider} over an HTTP serverless sidecar.
 */
export function createHttpExecEnvironment(
  options: HttpExecEnvironmentOptions,
): ExecEnvironmentProvider {
  const client = createHttpClient(options);
  const remoteRoot = options.remoteWorkspaceRoot?.trim() || "/workspace";

  return {
    providerName: "http",
    async isAvailable() {
      try {
        const json = (await client.request("GET", "/health")) as {
          ok?: unknown;
        };
        return json?.ok === true || json?.ok === "true";
      } catch {
        return false;
      }
    },
    async createWorld({ workspaceRoot, signal }) {
      // Touch health under the caller's abort before minting handles.
      const json = (await client.request(
        "GET",
        "/health",
        undefined,
        signal,
      )) as { ok?: unknown };
      if (json?.ok !== true && json?.ok !== "true") {
        throw new HttpExecEnvironmentError(
          "exec-environment sidecar /health did not return ok",
          "EXEC_HTTP_UNAVAILABLE",
        );
      }
      const root = workspaceRoot.trim() || remoteRoot;
      const world: ExecWorld = {
        workspaceRoot: root,
        fs: createHttpFs(client.request, root),
        subprocess: createHttpSubprocess(client.request),
        dispose() {
          /* HTTP world is sessionless; sidecar owns lifecycle */
        },
      };
      return world;
    },
  };
}

/** Probe `/health` without minting a world. */
export async function probeHttpExecEnvironment(
  options: Pick<
    HttpExecEnvironmentOptions,
    "baseUrl" | "token" | "fetchImpl" | "timeoutMs"
  >,
): Promise<boolean> {
  try {
    return await createHttpExecEnvironment(options).isAvailable();
  } catch {
    return false;
  }
}
