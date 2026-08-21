import type { AgentHandle } from "@xrkseek/core-agent";
import type { SessionStore } from "@xrkseek/core-session";
import type { LlmAdapter } from "@xrkseek/llm";
import { resolveLlmFromEnv } from "@xrkseek/llm-registry";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import type { PolicyEngine } from "@xrkseek/policy";
import { createHarnessComposition } from "@xrkseek/preset-harness";
import type { AgentFactory } from "@xrkseek/server-host";

export const presetId = "server" as const;

export interface ServerCompositionOptions {
  readonly workspaceRoot: string;
  readonly llm?: LlmAdapter;
  /** Optional policy wired into harness pipeline. */
  readonly policy?: PolicyEngine;
  /** Env for `XRK_LLM_PRESET` (default `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Host-plane composition: returns an AgentFactory for server/host spawn.
 * Preset wires plugins from the host factory input into harness tools.
 * When `llm` omitted: `resolveLlmFromEnv` if `XRK_LLM_PRESET` set, else replay.
 */
export function createServerAgentFactory(
  options: ServerCompositionOptions,
): AgentFactory {
  const fallbackLlm =
    options.llm ??
    resolveLlmFromEnv(options.env ?? process.env)?.adapter ??
    createReplayAdapter([
      {
        content: "hello from server preset (replay).",
      },
    ]);

  return async ({
    sessionId,
    store,
    workspaceRoot,
    plugins,
    resolveImage,
    ptyService,
    shellJobs,
    resolveLlm,
    maxParallelToolCalls,
    maxSteps,
    toolOrder,
    toolSettle,
    llmRetryMaxRetries,
    bashLimits,
    webSearch,
  }) => {
    const llm =
      resolveLlm?.(sessionId) ??
      options.llm ??
      resolveLlmFromEnv(options.env ?? process.env)?.adapter ??
      fallbackLlm;

    const composition = createHarnessComposition({
      workspaceRoot: workspaceRoot || options.workspaceRoot,
      sessionStore: store,
      sessionId,
      llm,
      assemble: true,
      plugins,
      ...(options.policy ? { policy: options.policy } : {}),
      ...(resolveImage ? { resolveImage } : {}),
      ...(ptyService ? { ptyTools: ptyService } : {}),
      ...(shellJobs ? { shell: shellJobs } : {}),
      ...(maxParallelToolCalls !== undefined ? { maxParallelToolCalls } : {}),
      ...(maxSteps !== undefined ? { maxSteps } : {}),
      ...(toolOrder !== undefined ? { toolOrder } : {}),
      ...(toolSettle !== undefined ? { toolSettle } : {}),
      ...(llmRetryMaxRetries !== undefined ? { llmRetryMaxRetries } : {}),
      ...(bashLimits ? { bashLimits } : {}),
      ...(webSearch ? { webSearch } : {}),
    });
    return composition.createAgent();
  };
}

export function createServerComposition(options: ServerCompositionOptions) {
  return {
    id: presetId,
    description: "Server host plane: harness tools + agent factory",
    workspaceRoot: options.workspaceRoot,
    createAgentFactory: () => createServerAgentFactory(options),
    dumpConfig(patch: Record<string, unknown> = {}) {
      return {
        preset: presetId,
        workspaceRoot: options.workspaceRoot,
        plane: "host",
        policy: Boolean(options.policy),
        ...patch,
      };
    },
  };
}

export const preset = {
  id: presetId,
  description: "HTTP host composition (harness tools + factory)",
  create: createServerComposition,
  createAgentFactory: createServerAgentFactory,
};

export type { AgentHandle, SessionStore };
