import type { AgentHandle } from "@xrkseek/core-agent";
import type { LlmAdapter } from "@xrkseek/llm";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  createHarnessComposition,
  type HarnessComposition,
  type PresentationMode,
} from "@xrkseek/preset-harness";
import {
  createMinimalComposition,
  type MinimalComposition,
} from "@xrkseek/preset-minimal";

export type HarnessPresetId = "minimal" | "harness";

export interface MakeHarnessOptions {
  readonly preset?: HarnessPresetId;
  readonly workspaceRoot?: string;
  readonly llm?: LlmAdapter;
  readonly presentation?: PresentationMode;
  readonly system?: string;
}

export interface TestHarness {
  readonly preset: HarnessPresetId;
  readonly composition: MinimalComposition | HarnessComposition;
  createAgent(): Promise<AgentHandle>;
  run(text: string): Promise<{ text: string; turnId: string; steps: number }>;
}

/** Integration fixture: one-liner harness for tests / examples. */
export function makeHarness(options: MakeHarnessOptions = {}): TestHarness {
  const preset = options.preset ?? "minimal";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const llm =
    options.llm ??
    createReplayAdapter([{ content: `replay:${preset}` }]);

  const composition =
    preset === "harness"
      ? createHarnessComposition({
          workspaceRoot,
          llm,
          ...(options.system !== undefined ? { system: options.system } : {}),
          ...(options.presentation
            ? { presentation: options.presentation }
            : {}),
        })
      : createMinimalComposition({
          workspaceRoot,
          llm,
          ...(options.system !== undefined ? { system: options.system } : {}),
        });

  return {
    preset,
    composition,
    createAgent: () => composition.createAgent(),
    async run(text) {
      const agent = await composition.createAgent();
      return agent.run({ text });
    },
  };
}
