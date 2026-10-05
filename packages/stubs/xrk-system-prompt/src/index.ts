/**
 * System-prompt registry: the `ctx.systemPrompt` service packages contribute
 * model guidance to.
 *
 * A contributor registers a named section from the apply of its own fiber;
 * `assemble()` resolves the sections in `order`, drops the ones that say
 * nothing for this turn, and joins the rest. A section whose body is a
 * provider is resolved at assembly time, so it can follow per-turn state.
 *
 * This is the workspace stand-in for the published
 * `@xrkseek/xrk-system-prompt`: it carries the contract the workspace's
 * consumers and specs are written against, so their behavior is specified
 * against a service rather than a deployment. Replace it with the real package
 * (or remap it) once that lands.
 */

import { Context, Service } from '@xrkseek/cordis'

/** One section as a package registers it. */
export interface PromptSectionInput {
  /** Stable identifier, namespaced by the contributing package. */
  readonly name: string
  /** Assembly position; lower runs first. Defaults to `0`. */
  readonly order?: number
  /**
   * Section body, or a provider resolved at assembly time. A body that
   * resolves empty (or whitespace-only) leaves no section behind.
   */
  readonly text: string | (() => string | Promise<string>)
}

/** One section as it stands inside an assembled prompt. */
export interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string
}

/** An assembled prompt. */
export interface AssembledPrompt {
  /** Sections in assembly order. */
  readonly sections: readonly PromptSection[]
  /** `sections` joined with a blank line — the text handed to the model. */
  readonly text: string
  /** Optional route variables filled by model-selection. */
  readonly variables?: Record<string, string>
}

/** Context passed through `system-prompt/assemble`. */
export interface AssembleContext {
  readonly signal?: AbortSignal
}

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

/** Plugin config. */
export interface Config {
  /** Base persona; an empty persona contributes nothing. */
  readonly persona?: string
}

/** Section name carrying the configured persona. */
const PERSONA_SECTION = 'persona'

/**
 * Render an assembled prompt as text.
 * @param prompt - an assembled prompt, or text passed through unchanged.
 * @returns the prompt text.
 */
export function renderPrompt(prompt: AssembledPrompt | string): string {
  return typeof prompt === 'string' ? prompt : prompt.text
}

/** The `ctx.systemPrompt` registry. */
export class SystemPromptService extends Service {
  private readonly sections = new Map<string, PromptSectionInput>()
  private readonly persona: string

  /**
   * @param ctx - the context this service registers in.
   * @param config - plugin config; `persona` is the base prompt body.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'systemPrompt')
    this.persona = typeof config.persona === 'string' ? config.persona : ''
  }

  /**
   * Contribute one prompt section for as long as this service's fiber lives.
   * @param input - the section to register.
   * @returns a disposer removing the section again.
   * @throws when the name is already registered.
   */
  section(input: PromptSectionInput): () => void {
    const { name } = input
    if (this.sections.has(name)) {
      throw new Error(`prompt section already registered: ${name}`)
    }
    const sections = this.sections
    // Service method tracing binds `this.ctx` to the caller, so the section
    // unloads together with the fiber that contributed it.
    void this.ctx.effect(() => {
      sections.set(name, input)
      return () => {
        sections.delete(name)
      }
    }, `systemPrompt.section(${JSON.stringify(name)})`)
    return () => {
      sections.delete(name)
    }
  }

  /**
   * Resolve every registered section, in `order`.
   * @returns the assembled prompt: its sections and their joined text.
   */
  async assemble(): Promise<AssembledPrompt> {
    const sections: PromptSection[] = []
    if (this.persona.trim()) {
      sections.push({ name: PERSONA_SECTION, order: -1, text: this.persona })
    }
    const registered = [...this.sections.values()]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    for (const input of registered) {
      const text = typeof input.text === 'function' ? await input.text() : input.text
      if (!text.trim()) continue
      sections.push({ name: input.name, order: input.order ?? 0, text })
    }
    return { sections, text: sections.map(entry => entry.text).join('\n\n') }
  }
}

export default SystemPromptService
