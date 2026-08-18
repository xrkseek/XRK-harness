import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { encodeMessage, MessageDecoder } from "./framing.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface LspConnectionOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxMessageBytes: number;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export class LspConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly decoder: MessageDecoder;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closeReason: Error | undefined;
  readonly closed: Promise<void>;

  constructor(
    options: LspConnectionOptions,
    private readonly onServerRequest: (
      method: string,
      params: unknown,
    ) => Promise<unknown>,
  ) {
    this.decoder = new MessageDecoder(options.maxMessageBytes);
    this.child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.closed = new Promise<void>((resolve) => {
      const close = (): void => {
        const reason = this.closeReason ?? new Error(this.exitMessage());
        this.closeReason = reason;
        this.failAll(reason);
        resolve();
      };
      this.child.on("error", (error) => {
        this.fail(asError(error));
        close();
      });
      this.child.on("close", () => close());
    });
    this.child.stdin.on("error", (error) => {
      this.fail(asError(error));
    });
    this.child.stdout.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      try {
        for (const message of this.decoder.push(buf)) {
          this.onMessage(message);
        }
      } catch (error) {
        this.fail(asError(error));
      }
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get failed(): boolean {
    return this.closeReason !== undefined;
  }

  peekNextId(): number {
    return this.nextId;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closeReason) {
      return Promise.reject(this.closeReason);
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.pending.delete(id);
        reject(asError(error));
      });
    });
  }

  notify(method: string, params: unknown): Promise<void> {
    if (this.closeReason) {
      return Promise.reject(this.closeReason);
    }
    return this.write({ jsonrpc: "2.0", method, params });
  }

  cancel(id: number): void {
    void this.notify("$/cancelRequest", { id }).catch(() => {});
  }

  kill(): void {
    try {
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  private write(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(encodeMessage(message), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private onMessage(message: unknown): void {
    if (message === null || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    if (typeof record.method === "string" && record.id !== undefined) {
      void this.answer(record.method, record.params, record.id);
      return;
    }
    if (typeof record.method === "string") return;
    if (record.id === undefined) return;
    const pending = this.pending.get(record.id as number);
    if (!pending) return;
    this.pending.delete(record.id as number);
    if (record.error !== undefined) {
      pending.reject(new Error(formatRpcError(record.error)));
      return;
    }
    pending.resolve(record.result);
  }

  private async answer(
    method: string,
    params: unknown,
    id: unknown,
  ): Promise<void> {
    try {
      const result = await this.onServerRequest(method, params);
      await this.write({ jsonrpc: "2.0", id, result });
    } catch (error) {
      await this.write({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => {});
    }
  }

  private fail(error: Error): void {
    if (this.closeReason) return;
    this.closeReason = error;
    this.failAll(error);
    this.kill();
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private exitMessage(): string {
    const code = this.child.exitCode;
    const signal = this.child.signalCode;
    if (signal) return `language server exited from signal ${signal}`;
    return `language server exited with code ${code ?? "unknown"}`;
  }
}

function formatRpcError(error: unknown): string {
  if (error === null || typeof error !== "object") return String(error);
  const record = error as { message?: unknown; code?: unknown };
  const message =
    typeof record.message === "string" ? record.message : "LSP request failed";
  return record.code !== undefined ? `${message} (${String(record.code)})` : message;
}
