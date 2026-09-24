/**
 * `xrkh tui` — thin product TUI: Face HTTP unary + mux stream, tool rail, /status.
 * Attaches to a running Host (`xrkh web` / `serve`); not a second agent runtime.
 */

import * as readline from "node:readline";
import {
  formatSessionStatusText,
  type SessionStatusSnapshot,
} from "@xrkseek/server-face";
import type { ParsedArgs } from "../parse-args.js";
import {
  faceCall,
  openFaceMux,
  resolveFaceApiKey,
  resolveFaceBaseUrl,
  type FaceClientOptions,
  type MuxEnvelope,
} from "../face-client.js";
import {
  createTuiRenderState,
  handleMuxPayload,
  type TuiRenderState,
} from "../tui-render.js";

const HELP = `xrkh tui — thin Face terminal (stream + tool rail + /status)

Commands:
  /status     Session Status (same facts as Face slash / Overview)
  /cancel     Abort the in-flight turn
  /help       This help
  /quit       Leave the TUI (also: /exit, Ctrl+D)

Anything else is sent as session.prompt (mode=queue), including Face slash lines
like /plan. Requires a running Host (default http://127.0.0.1:8787).
`;

function outWrite(text: string): void {
  process.stdout.write(text);
}

async function printStatus(
  client: FaceClientOptions,
  sessionId: string,
): Promise<void> {
  const res = await faceCall<SessionStatusSnapshot>(client, "session.status", {
    sessionId,
  });
  if (!res.ok) {
    outWrite(`status failed: ${res.message}\n`);
    return;
  }
  outWrite(`${formatSessionStatusText(res.value)}\n`);
}

export async function runTui(args: ParsedArgs): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "xrkh tui requires an interactive TTY (stdin + stdout)\n",
    );
    return 1;
  }

  const baseUrl = resolveFaceBaseUrl(args.host, args.port);
  const apiKey = resolveFaceApiKey();
  const client: FaceClientOptions = {
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
  };

  const probe = await faceCall<{ version?: string }>(client, "host.describe", {});
  if (!probe.ok) {
    process.stderr.write(
      `xrkh tui: cannot reach Host at ${baseUrl} (${probe.message})\n` +
        `Start one with: xrkh web --port ${args.port ?? 8787}\n`,
    );
    return 1;
  }

  const createPayload: Record<string, unknown> = {
    cwd: args.workspace,
  };
  if (args.preset && args.preset !== "minimal") {
    createPayload.agentPreset = args.preset;
  }
  if (args.sessionId) {
    createPayload.sessionId = args.sessionId;
  }

  const created = await faceCall<{ sessionId: string; agentPreset?: string }>(
    client,
    "session.create",
    createPayload,
  );
  if (!created.ok) {
    process.stderr.write(`session.create failed: ${created.message}\n`);
    return 1;
  }
  const sessionId = created.value.sessionId;
  const badge = created.value.agentPreset ?? args.preset;

  const render: TuiRenderState = createTuiRenderState();
  let busy = false;
  let wakePrompt: (() => void) | undefined;

  const mux = openFaceMux(client, (env: MuxEnvelope) => {
    const result = handleMuxPayload(
      sessionId,
      env.payload,
      { write: outWrite },
      render,
    );
    if (result.turnIdle) {
      busy = false;
      wakePrompt?.();
      wakePrompt = undefined;
    }
  });

  try {
    await mux.ready;
  } catch (err) {
    process.stderr.write(
      `mux connect failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    mux.close();
    return 1;
  }

  outWrite(
    `xrkh tui · ${baseUrl} · session ${sessionId}` +
      (badge ? ` · ${badge}` : "") +
      "\n",
  );
  outWrite("Type /help · /status · /quit. Stream + tool rail reuse Face mux.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const waitIdle = (): Promise<void> => {
    if (!busy) return Promise.resolve();
    return new Promise((resolve) => {
      wakePrompt = resolve;
    });
  };

  const ask = (prompt: string): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question(prompt, (line) => {
        resolve(line);
      });
      rl.once("close", () => resolve(null));
    });

  let exitCode = 0;
  let running = true;

  const onSigInt = (): void => {
    if (busy) {
      void faceCall(client, "session.cancel", { sessionId }).then(() => {
        outWrite("\n  (cancel requested)\n");
      });
      return;
    }
    running = false;
    rl.close();
  };
  process.on("SIGINT", onSigInt);

  try {
    while (running) {
      await waitIdle();
      if (!running) break;
      const line = await ask("> ");
      if (line === null) break;
      const text = line.trim();
      if (text.length === 0) continue;

      const lower = text.toLowerCase();
      if (lower === "/quit" || lower === "/exit" || lower === "/q") {
        break;
      }
      if (lower === "/help" || lower === "/?") {
        outWrite(HELP);
        continue;
      }
      if (lower === "/status") {
        await printStatus(client, sessionId);
        continue;
      }
      if (lower === "/cancel") {
        const c = await faceCall(client, "session.cancel", { sessionId });
        outWrite(
          c.ok ? "  (cancel accepted)\n" : `  cancel failed: ${c.message}\n`,
        );
        busy = false;
        continue;
      }

      busy = true;
      const promptRes = await faceCall(client, "session.prompt", {
        sessionId,
        mode: "queue",
        content: [{ type: "text", text }],
      });
      if (!promptRes.ok) {
        busy = false;
        outWrite(`prompt failed: ${promptRes.message}\n`);
        continue;
      }
      // Slash handlers (e.g. /plan) may settle without a turn/end — wait briefly
      // then fall through if still busy (mux will clear on turnIdle).
      await waitIdle();
    }
  } catch (err) {
    exitCode = 1;
    process.stderr.write(
      `tui error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  } finally {
    process.off("SIGINT", onSigInt);
    rl.close();
    mux.close();
  }

  return exitCode;
}
