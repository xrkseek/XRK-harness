/**
 * `xrkh acp` — stdio ACP server so editors can drive this process.
 * Stdout is JSON-RPC only; diagnostics go to stderr.
 */
import { createHarnessComposition } from "@xrkseek/preset-harness";
import { createMemorySessionStore } from "@xrkseek/core-session";
import type { ParsedArgs } from "../parse-args.js";
import { readCliVersion } from "../product-paths.js";
import { createAcpServer } from "../acp-server.js";

interface TurnAgent {
  continueTurn(input: {
    text: string;
    signal?: AbortSignal;
  }): Promise<{ text: string }>;
}

export async function runAcp(args: ParsedArgs): Promise<number> {
  const store = createMemorySessionStore();
  const agents = new Map<string, TurnAgent>();

  const server = createAcpServer({
    agentVersion: readCliVersion(),
    runner: async ({ sessionId, cwd, text, signal }) => {
      let agent = agents.get(sessionId);
      if (!agent) {
        const composition = createHarnessComposition({
          workspaceRoot: cwd || args.workspace,
          sessionStore: store,
          assemble: false,
          webTools: false,
          lspTools: false,
          ptyTools: false,
          computerUseTools: false,
        });
        agent = await composition.createAgent();
        agents.set(sessionId, agent);
      }
      const result = await agent.continueTurn({
        text,
        ...(signal ? { signal } : {}),
      });
      return { text: result.text };
    },
  });

  process.stderr.write(
    `xrkh acp  stdio JSON-RPC (protocol v1)  cwd=${args.workspace}\n`,
  );
  await server.start();
  return 0;
}
