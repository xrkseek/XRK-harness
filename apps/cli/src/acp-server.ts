/**
 * Stdio ACP (Agent Client Protocol) host — newline-delimited JSON-RPC.
 * Editors spawn `xrkh acp` and treat this process as the ACP server.
 * Logs must stay on stderr; stdout is the wire.
 */
import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpPromptInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly text: string;
  readonly signal?: AbortSignal;
  readonly notify?: (text: string) => void;
}

export interface AcpPromptResult {
  readonly text: string;
}

export type AcpPromptRunner = (
  input: AcpPromptInput,
) => Promise<AcpPromptResult>;

export interface AcpServerOptions {
  readonly runner: AcpPromptRunner;
  readonly agentName?: string;
  readonly agentVersion?: string;
  readonly input?: Readable;
  readonly output?: Writable;
}

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
}

interface SessionState {
  readonly id: string;
  readonly cwd: string;
  abort?: AbortController;
}

function textFromPrompt(prompt: unknown): string {
  if (typeof prompt === "string") return prompt;
  if (!Array.isArray(prompt)) return "";
  const parts: string[] = [];
  for (const block of prompt) {
    if (!block || typeof block !== "object") continue;
    const rec = block as { type?: string; text?: string };
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("\n").trim();
}

export function createAcpServer(options: AcpServerOptions): {
  start(): Promise<void>;
} {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const agentName = options.agentName ?? "xrk-harness";
  const agentVersion = options.agentVersion ?? "0.0.0";
  const sessions = new Map<string, SessionState>();

  const write = (frame: Record<string, unknown>): void => {
    output.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
  };

  const respond = (id: number | string, result: unknown): void => {
    write({ id, result });
  };

  const respondError = (
    id: number | string,
    code: number,
    message: string,
  ): void => {
    write({ id, error: { code, message } });
  };

  const notifyUpdate = (sessionId: string, text: string): void => {
    write({
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    });
  };

  const handle = async (msg: JsonRpcRequest): Promise<void> => {
    const method = String(msg.method ?? "");
    const id = msg.id;
    const params =
      msg.params && typeof msg.params === "object"
        ? (msg.params as Record<string, unknown>)
        : {};

    if (id === undefined || id === null) {
      if (method === "session/cancel") {
        const sid = String(params.sessionId ?? "");
        sessions.get(sid)?.abort?.abort();
      }
      return;
    }

    if (method === "initialize") {
      respond(id, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentInfo: { name: agentName, version: agentVersion },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false, embeddedContext: true },
        },
      });
      return;
    }

    if (method === "authenticate") {
      respond(id, {});
      return;
    }

    if (method === "session/new") {
      const cwd = String(params.cwd ?? process.cwd());
      const session: SessionState = {
        id: `acp_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        cwd,
      };
      sessions.set(session.id, session);
      respond(id, { sessionId: session.id });
      return;
    }

    if (method === "session/prompt") {
      const sessionId = String(params.sessionId ?? "");
      const session = sessions.get(sessionId);
      if (!session) {
        respondError(id, -32002, `unknown session: ${sessionId}`);
        return;
      }
      const text = textFromPrompt(params.prompt);
      if (!text) {
        respondError(id, -32602, "prompt text is empty");
        return;
      }
      const abort = new AbortController();
      session.abort = abort;
      try {
        const result = await options.runner({
          sessionId,
          cwd: session.cwd,
          text,
          signal: abort.signal,
          notify: (chunk) => notifyUpdate(sessionId, chunk),
        });
        if (!abort.signal.aborted) {
          notifyUpdate(sessionId, result.text);
        }
        respond(id, {
          stopReason: abort.signal.aborted ? "cancelled" : "end_turn",
        });
      } catch (err) {
        if (abort.signal.aborted) {
          respond(id, { stopReason: "cancelled" });
          return;
        }
        respondError(
          id,
          -32603,
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        delete session.abort;
      }
      return;
    }

    respondError(id, -32601, `method not found: ${method}`);
  };

  return {
    start() {
      return new Promise((resolve) => {
        const rl: Interface = createInterface({ input, crlfDelay: Infinity });
        rl.on("line", (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let msg: JsonRpcRequest;
          try {
            msg = JSON.parse(trimmed) as JsonRpcRequest;
          } catch {
            return;
          }
          void handle(msg).catch((err) => {
            if (msg.id !== undefined && msg.id !== null) {
              respondError(
                msg.id,
                -32603,
                err instanceof Error ? err.message : String(err),
              );
            }
          });
        });
        rl.on("close", () => resolve());
      });
    },
  };
}
