export interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string
}

export interface AssembledPrompt {
  readonly sections: readonly PromptSection[]
  readonly text: string
  readonly variables?: Record<string, string>
}

export interface AssembleContext {
  readonly signal?: AbortSignal
}

export interface Config {
  readonly persona?: string
}

export function renderPrompt(prompt: AssembledPrompt | string): string

export class SystemPromptService {
  constructor(ctx: unknown, config?: Config)
  section(input: {
    readonly name: string
    readonly order?: number
    readonly text: string | (() => string | Promise<string>)
  }): () => void
  assemble(): Promise<AssembledPrompt>
}

export default SystemPromptService

declare module '@xrkseek/cordis' {
  interface Context {
    systemPrompt: SystemPromptService
  }
  interface Events {
    'system-prompt/assemble'(
      assembly: unknown,
      context: AssembleContext,
      next: () => Promise<AssembledPrompt>,
    ): Promise<AssembledPrompt>
  }
}
