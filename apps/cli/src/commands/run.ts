import {
  toJSONL,
  createMemorySessionStore,
  readSessionEvents,
} from "@xrkseek/core-session";
import { resolveLlmFromEnv } from "@xrkseek/llm-registry";
import { createHarnessComposition } from "@xrkseek/preset-harness";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import {
  createFaceRuntime,
  resolveLlmForSession,
} from "@xrkseek/server-face";
import type { ParsedArgs } from "../parse-args.js";

function noopDrain() {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function resolveWorkspaceLlm(workspaceRoot: string) {
  const store = createMemorySessionStore();
  const sessionId = store.create().id;
  const runtime = createFaceRuntime({
    store,
    workspaceRoot,
    drain: noopDrain(),
    resolveAgent: async () => {
      throw new Error("run: resolveAgent unused");
    },
  });
  return (
    resolveLlmForSession(runtime, sessionId)?.adapter ??
    resolveLlmFromEnv(process.env)?.adapter
  );
}

async function resolvePrompt(args: ParsedArgs): Promise<string> {
  if (args.promptExplicit) return args.prompt;
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) return text;
  }
  return args.prompt;
}

export async function runCommand(args: ParsedArgs): Promise<number> {
  const prompt = await resolvePrompt(args);
  const llm = resolveWorkspaceLlm(args.workspace);
  const composition =
    args.preset === "harness" || args.preset === "server"
      ? createHarnessComposition({
          workspaceRoot: args.workspace,
          presentation: args.presentation,
          ...(llm ? { llm } : {}),
        })
      : args.preset === "minimal"
        ? createMinimalComposition({
            workspaceRoot: args.workspace,
            ...(llm ? { llm } : {}),
          })
        : null;
  if (!composition) {
    throw new Error(
      `unsupported preset: ${args.preset} (use minimal|harness|server)`,
    );
  }

  const agent = await composition.createAgent();
  const result = await agent.run({ text: prompt });

  process.stdout.write(`${result.text}\n`);
  if (process.env.XRK_DUMP_SESSION === "1") {
    const events = readSessionEvents(
      composition.store,
      composition.sessionId,
    );
    process.stderr.write(toJSONL(events));
  }
  return 0;
}
