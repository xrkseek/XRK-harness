/**
 * `xrkh tui` — thin Face TUI (stream + tool rail + dsh-tui-style slash cmds).
 * Attaches to a running Host; not a second agent runtime / not Ink.
 */

import * as readline from "node:readline";
import {
  formatSessionStatusText,
  type SessionStatusSnapshot,
} from "@xrkseek/server-face";
import { newestLiveHostLock } from "../host-lock.js";
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
  formatDetails,
  formatModelCatalog,
  formatSessionList,
  parseTuiSlash,
  resolveModelArg,
  type FaceModelsValue,
  type ListedSession,
} from "../tui-commands.js";
import {
  createTuiRenderState,
  formatToolRailSummary,
  handleMuxPayload,
  type TuiRenderState,
} from "../tui-render.js";
import {
  createTuiPalette,
  formatBusyPrompt,
  type TuiPalette,
} from "../tui-style.js";

const HELP = `xrkh tui — Face terminal (stream + tool rail; dsh-tui-style commands)

Commands:
  /status              Session Status (Face slash / Overview facts)
  /details             Session, model, tools, pending approval
  /model [p/m] [effort] List or select model (Face session.models)
  /resume [sessionId]  List recent sessions or switch (session.create)
  /approve|/deny|/whitelist   Answer pending tool approval
  /compact · /plan …   Forwarded as Face slash via session.prompt
  /thinking on|off     Show or hide reasoning chunks
  /cancel              Abort the in-flight turn
  /help                This help
  /quit                Leave (also: /exit, Ctrl+D)

Plain lines → session.prompt (queue when idle, steer when busy).
Host: newest ~/.xrk/run lock, or http://127.0.0.1:8787.
`;

function outWrite(text: string): void {
  process.stdout.write(text);
}

function notice(palette: TuiPalette, text: string): void {
  outWrite(`  ${palette.dim(text)}\n`);
}

function fail(palette: TuiPalette, text: string): void {
  outWrite(`  ${palette.error(text)}\n`);
}

async function printStatus(
  client: FaceClientOptions,
  sessionId: string,
  palette: TuiPalette,
): Promise<void> {
  const res = await faceCall<SessionStatusSnapshot>(client, "session.status", {
    sessionId,
  });
  if (!res.ok) {
    fail(palette, `status failed: ${res.message}`);
    return;
  }
  outWrite(`${formatSessionStatusText(res.value)}\n`);
}

async function loadModels(
  client: FaceClientOptions,
  sessionId: string,
  palette: TuiPalette,
): Promise<FaceModelsValue | null> {
  const res = await faceCall<FaceModelsValue>(client, "session.models", {
    sessionId,
  });
  if (!res.ok) {
    fail(palette, `models failed: ${res.message}`);
    return null;
  }
  return res.value;
}

function modelLabel(value: FaceModelsValue | null | undefined): string | undefined {
  const cur = value?.current;
  if (!cur) return undefined;
  return cur.reasoningEffort
    ? `${cur.provider}/${cur.model} · ${cur.reasoningEffort}`
    : `${cur.provider}/${cur.model}`;
}

function parseThinkingArg(arg: string): boolean | undefined {
  if (arg === "on" || arg === "1" || arg === "true") return true;
  if (arg === "off" || arg === "0" || arg === "false") return false;
  return undefined;
}

export async function runTui(args: ParsedArgs): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "xrkh tui requires an interactive TTY (stdin + stdout)\n",
    );
    return 1;
  }

  const palette = createTuiPalette();
  const attached = args.port === undefined ? newestLiveHostLock() : null;
  const baseUrl = resolveFaceBaseUrl(args.host, args.port ?? attached?.port);
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
  let sessionId = created.value.sessionId;
  const badge = created.value.agentPreset ?? args.preset;

  const render: TuiRenderState = createTuiRenderState(palette);
  let busy = false;
  let modelsCache: FaceModelsValue | null = null;

  const mux = openFaceMux(client, (env: MuxEnvelope) => {
    const result = handleMuxPayload(
      sessionId,
      env.payload,
      { write: outWrite },
      render,
    );
    if (result.turnIdle) busy = false;
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

  const banner = [
    palette.bold(palette.accent("xrkh tui")),
    palette.dim(baseUrl),
    palette.dim(sessionId),
    ...(badge ? [palette.dim(String(badge))] : []),
  ].join(palette.dim(" · "));
  outWrite(`${banner}\n`);
  outWrite(
    `${palette.dim(" /help · /model · /resume · /status · busy lines steer")}\n`,
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

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
        outWrite(`\n`);
        notice(palette, "cancel requested");
      });
      return;
    }
    running = false;
    rl.close();
  };
  process.on("SIGINT", onSigInt);

  const respondApproval = async (
    decision: "allow" | "deny" | "whitelist",
  ): Promise<void> => {
    const pending = render.pendingApproval;
    if (!pending) {
      notice(palette, "no pending approval");
      return;
    }
    const res = await faceCall(client, "session.respondApproval", {
      sessionId,
      approvalId: pending.approvalId,
      decision,
    });
    if (!res.ok) {
      fail(palette, `approval failed: ${res.message}`);
      return;
    }
    render.pendingApproval = undefined;
    notice(palette, `approval ${decision}`);
  };

  try {
    while (running) {
      const line = await ask(
        formatBusyPrompt(busy, formatToolRailSummary(render), palette),
      );
      if (line === null) break;
      const text = line.trim();
      if (text.length === 0) continue;

      const slash = parseTuiSlash(text);
      if (slash) {
        if (slash.name === "quit" || slash.name === "exit" || slash.name === "q") {
          break;
        }
        if (slash.name === "help" || slash.name === "?") {
          outWrite(HELP);
          continue;
        }
        if (slash.name === "status") {
          await printStatus(client, sessionId, palette);
          continue;
        }
        if (slash.name === "details") {
          if (!modelsCache) {
            modelsCache = await loadModels(client, sessionId, palette);
          }
          outWrite(
            formatDetails({
              sessionId,
              baseUrl,
              busy,
              toolSummary: formatToolRailSummary(render),
              pending: render.pendingApproval,
              modelLabel: modelLabel(modelsCache),
            }),
          );
          continue;
        }
        if (slash.name === "thinking" || slash.name === "reason") {
          const next = parseThinkingArg(slash.arg);
          if (next === undefined) {
            notice(
              palette,
              `thinking ${render.showReasoning ? "on" : "off"}  (usage: /thinking on|off)`,
            );
          } else {
            render.showReasoning = next;
            notice(palette, `thinking ${next ? "on" : "off"}`);
          }
          continue;
        }
        if (slash.name === "cancel") {
          const c = await faceCall(client, "session.cancel", { sessionId });
          if (c.ok) notice(palette, "cancel accepted");
          else fail(palette, `cancel failed: ${c.message}`);
          busy = false;
          continue;
        }
        if (
          slash.name === "approve" ||
          slash.name === "allow" ||
          slash.name === "deny" ||
          slash.name === "whitelist"
        ) {
          const decision =
            slash.name === "deny"
              ? "deny"
              : slash.name === "whitelist"
                ? "whitelist"
                : "allow";
          await respondApproval(decision);
          continue;
        }
        if (slash.name === "model") {
          const catalog = await loadModels(client, sessionId, palette);
          if (!catalog) continue;
          modelsCache = catalog;
          const resolved = resolveModelArg(slash.arg, catalog);
          if (resolved.kind === "list") {
            outWrite(formatModelCatalog(catalog));
            continue;
          }
          if (resolved.kind === "error") {
            fail(palette, resolved.message);
            continue;
          }
          const sel = await faceCall(client, "session.selectModel", {
            sessionId,
            provider: resolved.provider,
            model: resolved.model,
            ...(resolved.reasoningEffort
              ? { reasoningEffort: resolved.reasoningEffort }
              : {}),
          });
          if (!sel.ok) {
            fail(palette, `selectModel failed: ${sel.message}`);
            continue;
          }
          modelsCache = await loadModels(client, sessionId, palette);
          const effort = resolved.reasoningEffort
            ? ` · effort ${resolved.reasoningEffort}`
            : "";
          notice(
            palette,
            `model ${resolved.provider}/${resolved.model}${effort}  (next turns)`,
          );
          continue;
        }
        if (slash.name === "resume") {
          if (!slash.arg) {
            const listed = await faceCall<{ items: ListedSession[] }>(
              client,
              "session.list",
              {},
            );
            if (!listed.ok) {
              fail(palette, `list failed: ${listed.message}`);
              continue;
            }
            outWrite(formatSessionList(listed.value.items ?? [], sessionId));
            continue;
          }
          if (busy) {
            fail(palette, "finish or /cancel the current turn before /resume");
            continue;
          }
          const next = await faceCall<{ sessionId: string }>(
            client,
            "session.create",
            { sessionId: slash.arg, cwd: args.workspace },
          );
          if (!next.ok) {
            fail(palette, `resume failed: ${next.message}`);
            continue;
          }
          sessionId = next.value.sessionId;
          render.tools.clear();
          render.pendingApproval = undefined;
          modelsCache = null;
          notice(palette, `attached session ${sessionId}`);
          continue;
        }
        // Other slashes (/compact, /plan, …) fall through to session.prompt.
      }

      const mode = busy ? "steer" : "queue";
      if (!busy) busy = true;
      const promptRes = await faceCall(client, "session.prompt", {
        sessionId,
        mode,
        content: [{ type: "text", text }],
      });
      if (!promptRes.ok) {
        if (mode === "queue") busy = false;
        fail(palette, `prompt failed: ${promptRes.message}`);
      }
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
