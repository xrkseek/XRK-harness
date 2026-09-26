/**
 * Service Definition for the workflow capability seam. Service Providers execute orchestration scripts;
 * observe-only lifecycle events never expose run control.
 * @module @xrkseek/xrk-workflow
 */

import { Context, Service } from '@xrkseek/cordis'
import { HarnessError } from '@xrkseek/xrk-llm'
import { SessionId } from '@xrkseek/xrk-session/types'
import {
  WorkflowRunId,
  type WorkflowAgentEndInfo,
  type WorkflowAgentInfo,
  type WorkflowResult,
  type WorkflowResultInfo,
  type WorkflowRunInfo,
} from './types.ts'
import type { WorkflowRun, WorkflowStartRequest } from './runtime-types.ts'

export { WorkflowRunId } from './types.ts'
export type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowAgentOutcome,
  WorkflowMeta,
  WorkflowPhase,
  WorkflowResult,
  WorkflowResultInfo,
  WorkflowRunInfo,
  WorkflowStopReason,
} from './types.ts'
export type { WorkflowRun, WorkflowStartRequest } from './runtime-types.ts'

/**
 * Nested `await tools.name(args)` bridge (Code Mode shape). Host mounts a
 * registry-backed bridge; Isolating posts RPC across the worker boundary.
 */
export interface WorkflowToolCallResult {
  readonly content: string
  readonly isError?: boolean
}

export interface WorkflowToolBridge {
  /** Names exposed on the `tools` Proxy (exclude recursive orchestrators). */
  readonly listNames: () => readonly string[]
  readonly call: (
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<WorkflowToolCallResult>
}

/** Build the script-facing `tools` Proxy (same contract as Code Mode). */
export function buildWorkflowToolsProxy(
  bridge: WorkflowToolBridge | undefined,
  signal?: AbortSignal,
): Record<string, (args?: unknown) => Promise<string>> {
  const listNames = (): readonly string[] => bridge?.listNames() ?? []
  const callTool = (name: string) => async (args?: unknown): Promise<string> => {
    if (!bridge) throw new Error('tools bridge not mounted')
    if (!listNames().includes(name)) throw new Error(`unknown tool: ${name}`)
    const out = await bridge.call(name, args ?? {}, signal)
    if (out.isError) throw new Error(`tools.${name} failed: ${out.content}`)
    return out.content
  }
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined
      return callTool(prop)
    },
    ownKeys() {
      return [...listNames()]
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && listNames().includes(prop)) {
        return {
          enumerable: true,
          configurable: true,
          writable: false,
          value: callTool(prop),
        }
      }
      return undefined
    },
  })
}

declare module '@xrkseek/cordis' {
  interface Context {
    workflowEngine: WorkflowEngine
  }

  interface Events {
    /**
     * A workflow run started — the script's meta block validated, the body
     * about to execute. Paired with {@link Events['workflow/end']}.
     * @param info - the run's identity snapshot (id + meta).
     * @mode emit
     */
    'workflow/start'(info: WorkflowRunInfo): void
    /**
     * The script entered a phase (a `phase(title)` call) — progress grouping
     * for observers; no execution semantics.
     * @param info - the run's identity snapshot.
     * @param title - the phase title, verbatim.
     * @mode emit
     */
    'workflow/phase'(info: WorkflowRunInfo, title: string): void
    /**
     * The script emitted a narration line (a `log(message)` call).
     * @param info - the run's identity snapshot.
     * @param message - the logged message, verbatim.
     * @mode emit
     */
    'workflow/log'(info: WorkflowRunInfo, message: string): void
    /**
     * One `agent()` call established a published child run. Paired with
     * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
     * receives a published run from the provider emits neither
     * event in this pair.
     * @param info - the run's identity snapshot.
     * @param agent - the call's sequence number, label, phase, and child id.
     * @mode emit
     */
    'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
    /**
     * One `agent()` call settled (clean result, child failure, or run
     * cancellation). Paired with {@link Events['workflow/agent-start']} by
     * `agent.seq`, exactly once per started call on every stop path — on an
     * engine termination path (a worker killed past its grace) the end is
     * engine-synthesized with outcome `'cancelled'`.
     * @param info - the run's identity snapshot.
     * @param agent - the call identity plus its outcome.
     * @mode emit
     */
    'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
    /**
     * A workflow run settled (any stop reason). Fired when
     * {@link WorkflowRun.result} resolves. Paired with
     * {@link Events['workflow/start']}.
     * @param info - the run's identity snapshot.
     * @param result - the outcome data (stop reason, error, agent count) —
     *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
     * @mode emit
     */
    'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
  }
}

/** The full set of `workflow/*` event names {@link WorkflowEngine.emitWorkflowEvent} dispatches. */
export type WorkflowEventName =
  | 'workflow/start'
  | 'workflow/phase'
  | 'workflow/log'
  | 'workflow/agent-start'
  | 'workflow/agent-end'
  | 'workflow/end'

/**
 * Machine-routable fatal workflow failures: parse/meta/argument/schema errors,
 * resource caps, subagent infrastructure failures, unserializable boundary
 * values, and cancellation. An ordinary child failure resolves its item to
 * `null` and is not one of these fatal codes.
 */
export type WorkflowErrorCode =
  | 'SCRIPT_PARSE'
  | 'META_INVALID'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_OPTION'
  | 'UNSUPPORTED_SCHEMA'
  | 'AGENT_CAP'
  | 'ITEM_CAP'
  | 'AGENT_START'
  | 'AGENT_RESULT'
  | 'RESULT_UNSERIALIZABLE'
  | 'CANCELLED'
  | 'WORKER_EXIT'

/**
 * Typed error for workflow-seam failures. Extends {@link HarnessError}, so the
 * `code` is machine-routable taxonomy. `fatal` drives the combinator
 * discipline: `parallel()`/`pipeline()` re-throw a fatal error (a typo'd
 * option or a tripped cap must kill the script loudly), and reserve the
 * per-item `null` for child-run failures and ordinary in-stage script errors.
 * Every {@link WorkflowErrorCode} is fatal; the flag exists so the
 * distinction is explicit at every catch site rather than implied.
 */
export class WorkflowError extends HarnessError {
  /** Whether combinators must propagate this error instead of nulling the item. */
  readonly fatal: boolean

  constructor(message: string, code: WorkflowErrorCode, options?: ErrorOptions & { fatal?: boolean }) {
    super(message, code, options)
    this.name = 'WorkflowError'
    this.fatal = options?.fatal ?? true
  }
}

/**
 * Whether combinators must re-throw `error` instead of mapping the item to `null`.
 * @param error - any thrown value; fatality is host `instanceof` (unforgeable from a script realm).
 * @returns true iff `error` is a {@link WorkflowError} whose `fatal` flag is set.
 */
export function isFatalWorkflowError(error: unknown): boolean {
  return error instanceof WorkflowError && error.fatal
}

/**
 * Workflow Service Definition contract. Invalid requests throw before publication; a live
 * run is holder-owned, its result never rejects, cancellation and disposal are
 * bounded, and disposal waits for child cleanup within that bound. Lifecycle
 * listener failures are contained, and `workflow/end` fires exactly once as the
 * result settles.
 */
export abstract class WorkflowEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workflowEngine')
  }

  /**
   * Parse and execute a workflow script.
   * @param request - the script, its `args`, the parent agent, and an
   *   optional cancel signal.
   * @returns the live run; its `result` resolves when the script settles.
   */
  abstract start(request: WorkflowStartRequest): WorkflowRun

  /**
   * Emit a lifecycle event while containing and logging each listener failure.
   * @param name - the `workflow/*` event to dispatch.
   * @param args - the event's payload, matching its declared signature.
   */
  protected emitWorkflowEvent(name: WorkflowEventName, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try {
        const returned: unknown = (callback as (...payload: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`workflow: ${name} listener rejected: ${renderListenerError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`workflow: ${name} listener threw: ${renderListenerError(error)}`)
      }
    }
  }
}

/**
 * Render any thrown value without violating listener containment.
 * @param error - any thrown value.
 * @returns `String(error)`, or a fixed label when even coercion throws.
 */
function renderListenerError(error: unknown): string {
  try {
    return String(error)
  } catch {
    // String coercion itself may throw.
    return '[unrenderable thrown value]'
  }
}

/**
 * In-process Provider: AsyncFunction body with `phase` / `log` / `agent`.
 * `agent()` returns `null` unless `createAgent` is supplied (Cordis compositions
 * that wire subagents). Product Face boot uses the Face-native `ralph` tool;
 * this Provider fills the abstract `ctx.workflowEngine` hole for Cordis mounts.
 */
export class InProcessWorkflowEngine extends WorkflowEngine {
  private readonly createAgent:
    | ((
        request: WorkflowStartRequest,
        call: { label: string; prompt: string; phase?: string },
      ) => Promise<unknown>)
    | undefined
  private readonly toolBridge: WorkflowToolBridge | undefined

  constructor(
    ctx: Context,
    options?: {
      readonly createAgent?: InProcessWorkflowEngine['createAgent']
      readonly toolBridge?: WorkflowToolBridge
    },
  ) {
    super(ctx)
    this.createAgent = options?.createAgent
    this.toolBridge = options?.toolBridge
  }

  start(request: WorkflowStartRequest): WorkflowRun {
    const meta = request.meta
    if (!meta || typeof meta !== 'object') {
      throw new WorkflowError('workflow meta must be an object', 'META_INVALID')
    }
    if (typeof meta.name !== 'string' || !meta.name.trim()) {
      throw new WorkflowError('workflow meta.name is required', 'META_INVALID')
    }
    if (typeof meta.description !== 'string' || !meta.description.trim()) {
      throw new WorkflowError('workflow meta.description is required', 'META_INVALID')
    }
    if (typeof request.script !== 'string' || !request.script.trim()) {
      throw new WorkflowError('workflow script must be a non-empty string', 'SCRIPT_PARSE')
    }
    const id = WorkflowRunId(`wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
    let cancelled = false
    let cancelReason = 'cancelled'
    let agentsStarted = 0
    let currentPhase: string | undefined
    const ac = new AbortController()
    const onAbort = () => {
      cancelled = true
      cancelReason = 'parent signal aborted'
      ac.abort()
    }
    if (request.signal) {
      if (request.signal.aborted) onAbort()
      else request.signal.addEventListener('abort', onAbort, { once: true })
    }

    const info = { id, meta: request.meta }
    this.emitWorkflowEvent('workflow/start', info)

    const result = (async (): Promise<WorkflowResult> => {
      try {
        if (cancelled) {
          return { value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }
        }
        const phase = (title: string) => {
          currentPhase = String(title ?? '')
          this.emitWorkflowEvent('workflow/phase', info, currentPhase)
        }
        const log = (message: string) => {
          this.emitWorkflowEvent('workflow/log', info, String(message ?? ''))
        }
        const agent = async (opts: {
          label?: string
          prompt?: string
          phase?: string
        } = {}) => {
          if (cancelled || ac.signal.aborted) {
            throw new WorkflowError(cancelReason, 'CANCELLED')
          }
          const cap = request.maxTotalAgents
          if (typeof cap === 'number' && agentsStarted >= cap) {
            throw new WorkflowError(`workflow maxTotalAgents ${cap} reached`, 'AGENT_CAP')
          }
          agentsStarted += 1
          const seq = agentsStarted
          const label = String(opts.label ?? opts.prompt ?? `agent-${seq}`).slice(0, 120)
          const phaseTitle = opts.phase ?? currentPhase
          const childId = SessionId(`wf-child-${String(id)}-${seq}`)
          this.emitWorkflowEvent('workflow/agent-start', info, {
            seq,
            label,
            ...(phaseTitle ? { phase: phaseTitle } : {}),
            childId,
          })
          let outcome: 'completed' | 'failed' | 'cancelled' = 'failed'
          let value: unknown = null
          try {
            if (this.createAgent) {
              value = await this.createAgent(request, {
                label,
                prompt: String(opts.prompt ?? ''),
                ...(phaseTitle ? { phase: phaseTitle } : {}),
              })
              outcome = cancelled ? 'cancelled' : 'completed'
            }
          } catch {
            outcome = cancelled ? 'cancelled' : 'failed'
            value = null
          }
          this.emitWorkflowEvent('workflow/agent-end', info, {
            seq,
            label,
            ...(phaseTitle ? { phase: phaseTitle } : {}),
            childId,
            outcome,
          })
          return value
        }

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
          ...args: string[]
        ) => (...args: unknown[]) => Promise<unknown>
        const tools = buildWorkflowToolsProxy(this.toolBridge, ac.signal)
        const fn = new AsyncFunction(
          'args',
          'phase',
          'log',
          'agent',
          'tools',
          `"use strict";\n${request.script}`,
        )
        const value = await fn(request.args, phase, log, agent, tools)
        if (cancelled || ac.signal.aborted) {
          return { value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }
        }
        return {
          value: value === undefined ? null : value,
          stopReason: 'completed',
          agentsStarted,
        }
      } catch (err) {
        if (cancelled || ac.signal.aborted) {
          return { value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }
        }
        return {
          value: null,
          stopReason: 'error',
          error: err instanceof Error ? err.message : String(err),
          agentsStarted,
        }
      }
    })().then((settled) => {
      this.emitWorkflowEvent('workflow/end', info, {
        stopReason: settled.stopReason,
        agentsStarted: settled.agentsStarted,
        ...(settled.error ? { error: settled.error } : {}),
      })
      return settled
    })

    return {
      id,
      meta: request.meta,
      result,
      cancel(reason?: string) {
        cancelled = true
        cancelReason = reason?.trim() || 'cancelled'
        ac.abort()
      },
      async dispose() {
        cancelled = true
        ac.abort()
        await result.catch(() => undefined)
      },
    }
  }
}

/**
 * Worker-thread Provider: script body runs in an isolated `worker_threads`
 * Worker (eval). `agent()` posts an RPC to the parent thread, which may run
 * an optional {@link IsolatingWorkflowEngine} `createAgent` bridge (same
 * contract as {@link InProcessWorkflowEngine}) and return a structured-cloneable
 * value. Without `createAgent`, `agent()` still settles `null`.
 * `await tools.name(args)` uses an optional {@link WorkflowToolBridge}
 * (Code Mode subset — nested Host tools via parentPort RPC). Full sandboxed
 * Node PTC process confinement is not claimed.
 */
export class IsolatingWorkflowEngine extends WorkflowEngine {
  private readonly createAgent:
    | ((
        request: WorkflowStartRequest,
        call: { label: string; prompt: string; phase?: string },
      ) => Promise<unknown>)
    | undefined
  private readonly toolBridge: WorkflowToolBridge | undefined

  constructor(
    ctx: Context,
    options?: {
      readonly createAgent?: IsolatingWorkflowEngine['createAgent']
      readonly toolBridge?: WorkflowToolBridge
    },
  ) {
    super(ctx)
    this.createAgent = options?.createAgent
    this.toolBridge = options?.toolBridge
  }

  start(request: WorkflowStartRequest): WorkflowRun {
    const meta = request.meta
    if (!meta || typeof meta !== 'object') {
      throw new WorkflowError('workflow meta must be an object', 'META_INVALID')
    }
    if (typeof meta.name !== 'string' || !meta.name.trim()) {
      throw new WorkflowError('workflow meta.name is required', 'META_INVALID')
    }
    if (typeof meta.description !== 'string' || !meta.description.trim()) {
      throw new WorkflowError('workflow meta.description is required', 'META_INVALID')
    }
    if (typeof request.script !== 'string' || !request.script.trim()) {
      throw new WorkflowError('workflow script must be a non-empty string', 'SCRIPT_PARSE')
    }
    const id = WorkflowRunId(`wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
    let cancelled = false
    let cancelReason = 'cancelled'
    let agentsStarted = 0
    const ac = new AbortController()
    const onAbort = () => {
      cancelled = true
      cancelReason = 'parent signal aborted'
      ac.abort()
    }
    if (request.signal) {
      if (request.signal.aborted) onAbort()
      else request.signal.addEventListener('abort', onAbort, { once: true })
    }

    const info = { id, meta: request.meta }
    this.emitWorkflowEvent('workflow/start', info)

    const result = (async (): Promise<WorkflowResult> => {
      if (cancelled) {
        return { value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }
      }
      try {
        const settled = await runIsolatingWorkerScript({
          script: request.script,
          args: request.args,
          signal: ac.signal,
          onPhase: (title) => {
            this.emitWorkflowEvent('workflow/phase', info, title)
          },
          onLog: (message) => {
            this.emitWorkflowEvent('workflow/log', info, message)
          },
          onAgentStart: (agent) => {
            agentsStarted += 1
            this.emitWorkflowEvent('workflow/agent-start', info, agent)
          },
          onAgentEnd: (agent) => {
            this.emitWorkflowEvent('workflow/agent-end', info, agent)
          },
          runId: String(id),
          toolNames: this.toolBridge?.listNames() ?? [],
          ...(typeof request.maxTotalAgents === 'number'
            ? { maxTotalAgents: request.maxTotalAgents }
            : {}),
          ...(this.createAgent
            ? {
                createAgent: async (call: {
                  label: string
                  prompt: string
                  phase?: string
                }) => {
                  if (cancelled || ac.signal.aborted) {
                    throw new WorkflowError(cancelReason, 'CANCELLED')
                  }
                  return this.createAgent!(request, call)
                },
              }
            : {}),
          ...(this.toolBridge ? { toolBridge: this.toolBridge } : {}),
        })
        if (cancelled || ac.signal.aborted) {
          return { value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }
        }
        agentsStarted = Math.max(agentsStarted, settled.agentsStarted)
        return settled
      } catch (err) {
        if (cancelled || ac.signal.aborted) {
          return { value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }
        }
        return {
          value: null,
          stopReason: 'error',
          error: err instanceof Error ? err.message : String(err),
          agentsStarted,
        }
      }
    })().then((settled) => {
      this.emitWorkflowEvent('workflow/end', info, {
        stopReason: settled.stopReason,
        agentsStarted: settled.agentsStarted,
        ...(settled.error ? { error: settled.error } : {}),
      })
      return settled
    })

    return {
      id,
      meta: request.meta,
      result,
      cancel(reason?: string) {
        cancelled = true
        cancelReason = reason?.trim() || 'cancelled'
        ac.abort()
      },
      async dispose() {
        cancelled = true
        ac.abort()
        await result.catch(() => undefined)
      },
    }
  }
}

/** Best-effort clone so worker_threads can postMessage the agent result. */
function cloneForWorker(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as unknown
    } catch {
      return null
    }
  }
}

async function runIsolatingWorkerScript(input: {
  readonly script: string
  readonly args: unknown
  readonly signal?: AbortSignal
  readonly onPhase: (title: string) => void
  readonly onLog: (message: string) => void
  readonly onAgentStart: (agent: WorkflowAgentInfo) => void
  readonly onAgentEnd: (agent: WorkflowAgentEndInfo) => void
  readonly runId: string
  readonly maxTotalAgents?: number
  readonly toolNames?: readonly string[]
  readonly createAgent?: (call: {
    label: string
    prompt: string
    phase?: string
  }) => Promise<unknown>
  readonly toolBridge?: WorkflowToolBridge
}): Promise<WorkflowResult> {
  const { Worker } = await import('node:worker_threads')
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    let agentsStarted = 0;
    let callSeq = 0;
    const pending = new Map();
    parentPort.on('message', (msg) => {
      if (!msg || (msg.type !== 'agent-result' && msg.type !== 'tool-result')) return;
      const wait = pending.get(msg.callId);
      if (!wait) return;
      pending.delete(msg.callId);
      if (msg.ok) wait.resolve(msg.value === undefined ? null : msg.value);
      else wait.reject(new Error(String(msg.error || 'bridge failed')));
    });
    const phase = (title) => {
      parentPort.postMessage({ type: 'phase', title: String(title ?? '') });
    };
    const log = (message) => {
      parentPort.postMessage({ type: 'log', message: String(message ?? '') });
    };
    const agent = async (opts = {}) => {
      const cap = workerData.maxTotalAgents;
      if (typeof cap === 'number' && agentsStarted >= cap) {
        throw new Error('workflow maxTotalAgents ' + cap + ' reached');
      }
      agentsStarted += 1;
      const seq = agentsStarted;
      const label = String(opts.label ?? opts.prompt ?? ('agent-' + seq)).slice(0, 120);
      const phaseTitle = opts.phase;
      const childId = 'wf-child-' + workerData.runId + '-' + seq;
      const callId = 'c' + (++callSeq);
      parentPort.postMessage({
        type: 'agent-start',
        seq, label, phase: phaseTitle || undefined, childId,
      });
      parentPort.postMessage({
        type: 'agent-call',
        callId, seq, label,
        prompt: String(opts.prompt ?? ''),
        phase: phaseTitle || undefined,
        childId,
      });
      let value = null;
      let outcome = 'completed';
      try {
        value = await new Promise((resolve, reject) => {
          pending.set(callId, { resolve, reject });
        });
      } catch (err) {
        outcome = 'failed';
        parentPort.postMessage({
          type: 'agent-end',
          seq, label, phase: phaseTitle || undefined, childId, outcome,
        });
        throw err;
      }
      parentPort.postMessage({
        type: 'agent-end',
        seq, label, phase: phaseTitle || undefined, childId, outcome,
      });
      return value;
    };
    const toolNames = Array.isArray(workerData.toolNames) ? workerData.toolNames : [];
    const callTool = (name) => async (args) => {
      const callId = 't' + (++callSeq);
      parentPort.postMessage({
        type: 'tool-call',
        callId,
        name: String(name),
        args: args === undefined ? {} : args,
      });
      const out = await new Promise((resolve, reject) => {
        pending.set(callId, { resolve, reject });
      });
      if (out && out.isError) {
        throw new Error('tools.' + name + ' failed: ' + String(out.content || ''));
      }
      return out && typeof out.content === 'string' ? out.content : String(out && out.content != null ? out.content : '');
    };
    const tools = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return callTool(prop);
      },
      ownKeys() { return toolNames.slice(); },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === 'string' && toolNames.includes(prop)) {
          return { enumerable: true, configurable: true, writable: false, value: callTool(prop) };
        }
        return undefined;
      },
    });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    try {
      const fn = new AsyncFunction('args', 'phase', 'log', 'agent', 'tools',
        '"use strict";\\n' + workerData.script);
      Promise.resolve(fn(workerData.args, phase, log, agent, tools)).then((value) => {
        parentPort.postMessage({
          type: 'done',
          ok: true,
          value: value === undefined ? null : value,
          agentsStarted,
        });
      }).catch((err) => {
        parentPort.postMessage({
          type: 'done',
          ok: false,
          error: String(err && err.message ? err.message : err),
          agentsStarted,
        });
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'done',
        ok: false,
        error: String(err && err.message ? err.message : err),
        agentsStarted: 0,
      });
    }
  `

  return new Promise<WorkflowResult>((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        script: input.script,
        args: input.args ?? null,
        runId: input.runId,
        toolNames: [...(input.toolNames ?? [])],
        ...(typeof input.maxTotalAgents === 'number'
          ? { maxTotalAgents: input.maxTotalAgents }
          : {}),
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    let settled = false
    let agentsStartedSeen = 0
    const finish = (result: WorkflowResult) => {
      if (settled) return
      settled = true
      input.signal?.removeEventListener('abort', onAbort)
      void worker.terminate().catch(() => undefined)
      resolve(result)
    }
    const onAbort = () => {
      void worker.terminate().catch(() => undefined)
      finish({
        value: null,
        stopReason: 'cancelled',
        error: 'parent signal aborted',
        agentsStarted: agentsStartedSeen,
      })
    }
    if (input.signal) {
      if (input.signal.aborted) {
        onAbort()
        return
      }
      input.signal.addEventListener('abort', onAbort, { once: true })
    }
    worker.on('message', (msg: {
      type?: string
      title?: string
      message?: string
      seq?: number
      label?: string
      phase?: string
      childId?: string
      callId?: string
      prompt?: string
      name?: string
      args?: unknown
      outcome?: 'completed' | 'failed' | 'cancelled'
      ok?: boolean
      value?: unknown
      error?: string
      agentsStarted?: number
    }) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'phase' && typeof msg.title === 'string') {
        input.onPhase(msg.title)
        return
      }
      if (msg.type === 'log' && typeof msg.message === 'string') {
        input.onLog(msg.message)
        return
      }
      if (msg.type === 'agent-start' && typeof msg.seq === 'number') {
        agentsStartedSeen = Math.max(agentsStartedSeen, msg.seq)
        input.onAgentStart({
          seq: msg.seq,
          label: String(msg.label ?? ''),
          ...(msg.phase ? { phase: msg.phase } : {}),
          childId: SessionId(String(msg.childId ?? `wf-child-${msg.seq}`)),
        })
        return
      }
      if (msg.type === 'agent-call' && typeof msg.callId === 'string') {
        const callId = msg.callId
        const label = String(msg.label ?? '')
        const prompt = String(msg.prompt ?? '')
        const phaseTitle = msg.phase
        void (async () => {
          try {
            let value: unknown = null
            if (input.createAgent) {
              value = await input.createAgent({
                label,
                prompt,
                ...(phaseTitle ? { phase: String(phaseTitle) } : {}),
              })
            }
            worker.postMessage({
              type: 'agent-result',
              callId,
              ok: true,
              value: cloneForWorker(value),
            })
          } catch (err) {
            worker.postMessage({
              type: 'agent-result',
              callId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })()
        return
      }
      if (msg.type === 'tool-call' && typeof msg.callId === 'string' && typeof msg.name === 'string') {
        const callId = msg.callId
        const name = msg.name
        void (async () => {
          try {
            if (!input.toolBridge) {
              worker.postMessage({
                type: 'tool-result',
                callId,
                ok: false,
                error: 'tools bridge not mounted',
              })
              return
            }
            const names = input.toolBridge.listNames()
            if (!names.includes(name)) {
              worker.postMessage({
                type: 'tool-result',
                callId,
                ok: false,
                error: `unknown tool: ${name}`,
              })
              return
            }
            const out = await input.toolBridge.call(name, msg.args ?? {}, input.signal)
            worker.postMessage({
              type: 'tool-result',
              callId,
              ok: true,
              value: cloneForWorker({
                content: out.content,
                ...(out.isError ? { isError: true } : {}),
              }),
            })
          } catch (err) {
            worker.postMessage({
              type: 'tool-result',
              callId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })()
        return
      }
      if (msg.type === 'agent-end' && typeof msg.seq === 'number') {
        input.onAgentEnd({
          seq: msg.seq,
          label: String(msg.label ?? ''),
          ...(msg.phase ? { phase: msg.phase } : {}),
          childId: SessionId(String(msg.childId ?? `wf-child-${msg.seq}`)),
          outcome: msg.outcome ?? 'completed',
        })
        return
      }
      if (msg.type === 'done') {
        const agentsStarted =
          typeof msg.agentsStarted === 'number' ? msg.agentsStarted : agentsStartedSeen
        if (msg.ok) {
          finish({
            value: msg.value ?? null,
            stopReason: 'completed',
            agentsStarted,
          })
        } else {
          finish({
            value: null,
            stopReason: 'error',
            error: msg.error || 'worker failed',
            agentsStarted,
          })
        }
      }
    })
    worker.on('error', (err) => {
      finish({
        value: null,
        stopReason: 'error',
        error: err instanceof Error ? err.message : String(err),
        agentsStarted: agentsStartedSeen,
      })
    })
    worker.on('exit', (code) => {
      if (settled) return
      if (code === 0) {
        finish({
          value: null,
          stopReason: 'completed',
          agentsStarted: agentsStartedSeen,
        })
      } else {
        reject(new WorkflowError(`isolating worker exited ${code}`, 'WORKER_EXIT'))
      }
    })
  })
}

export default WorkflowEngine
