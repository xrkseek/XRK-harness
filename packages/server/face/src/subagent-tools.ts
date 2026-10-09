import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { SUBAGENT_ROUTING_PROMPT_TEXT } from "@xrkseek/core-tools";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  effectiveApprovalPolicy,
  effectiveSandboxMode,
  pathAccessModeFromSandbox,
} from "@xrkseek/protocol";
import {
  listPendingAdmits,
  readSessionEvents,
} from "@xrkseek/core-session";
import { permissionSelectFromEvents } from "./permissions.js";
import { forgetRequestHeaderCache } from "@xrkseek/core-agent-loop";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import {
  formatChildOutcome,
  lastAssistantBodyText,
  lastModelRetryNotice,
} from "./adapt/subagent-notice.js";
import {
  boundChildAnswer,
  SUBAGENT_ANSWER_INLINE_BYTES,
} from "./adapt/subagent-answer-bound.js";
export { boundChildAnswer, SUBAGENT_ANSWER_INLINE_BYTES };
import { subagentOwnedEvents } from "./subagent-registry.js";
import {
  DEFAULT_MAX_ACTIVE_CHILDREN,
  DEFAULT_MAX_DEPTH,
  resolveAgentPresetProfile,
} from "./presets-catalog.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveSessionCwd } from "./session-cwd.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { formatRosterCatalog } from "./agent-roster-store.js";
import {
  ExternalAgentError,
  parseExternalAgentKind,
  parseExternalAgentProduct,
  runExternalAgentTurn,
  supportsExternalContinuable,
  startExternalContinuable,
  isChildSessionActive,
  type ExternalSpawn,
} from "./external-agent-runtime.js";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  formatWorktreeResult,
  worktreeContextNote,
  worktreeSkippedForRemote,
  type SubagentWorktree,
} from "./subagent-worktree.js";
import type { ManagedWorktreeLease } from "./managed-worktree.js";
import {
  resolveSessionModelSelection,
  resolveSubagentModelSetting,
} from "./model-catalog.js";
import { selectSessionModel } from "./select-session-model.js";
import {
  appendOutputContract,
  buildOutputSchemaRetryMessage,
  coerceOutputSchema,
  validateOutputAgainstSchema,
  type OutputSchemaObject,
} from "./agent-team-output.js";
import {
  applySubagentSpawnPreamble,
  parseAgentTeamSpawnRole,
  rootUserAuthorizationBlock,
  type AgentTeamSpawnRole,
} from "./agent-team-roles.js";
import {
  isAgentTeamRole,
  type AgentTeamEdgeKind,
} from "./agent-team-graph.js";
import { bindRalphTool } from "./ralph-tool.js";

const FOREGROUND_WAIT_MS = 10 * 60 * 1000;
const WAIT_AGENT_DEFAULT_MS = 5 * 60 * 1000;
const WAIT_AGENT_MIN_MS = 1_000;
const POLL_MS = 50;

export { SUBAGENT_ROUTING_PROMPT_TEXT, DEFAULT_MAX_ACTIVE_CHILDREN, DEFAULT_MAX_DEPTH };

/** Effective Face + badge ceilings for subagent depth / concurrency. */
export interface SubagentQuotaCaps {
  readonly depth: number;
  readonly maxDepth: number;
  readonly active: number;
  readonly maxActive: number;
  readonly delegated: number;
  readonly slotsFree: number;
}

/**
 * Resolve live quota for Status / `analytics` (Face agent-loop ∩ badge ceiling).
 */
export function resolveSubagentQuota(
  runtime: FaceRuntime,
  sessionId: string,
): SubagentQuotaCaps {
  const loopValue = runtime.settingsNamespaces.view("agent-loop").value as Record<
    string,
    unknown
  >;
  const faceDepth =
    typeof loopValue.maxSubagentDepth === "number" &&
    Number.isFinite(loopValue.maxSubagentDepth) &&
    loopValue.maxSubagentDepth >= 1
      ? Math.min(3, Math.floor(loopValue.maxSubagentDepth))
      : DEFAULT_MAX_DEPTH;
  const faceActive =
    typeof loopValue.maxActiveSubagents === "number" &&
    Number.isFinite(loopValue.maxActiveSubagents) &&
    loopValue.maxActiveSubagents >= 1
      ? Math.min(16, Math.floor(loopValue.maxActiveSubagents))
      : DEFAULT_MAX_ACTIVE_CHILDREN;
  const presetId = effectiveSessionAgentPreset(runtime, sessionId);
  const profile = resolveAgentPresetProfile(presetId);
  if (profile.subagents.mode === "off") {
    const depth = subagentDepth(runtime, sessionId);
    const active =
      countActiveChildren(runtime, sessionId) + pendingSpawnCount(sessionId);
    const delegated = runtime.subagents.listDelegated(sessionId).length;
    return {
      depth,
      maxDepth: 0,
      active,
      maxActive: 0,
      delegated,
      slotsFree: 0,
    };
  }
  const maxDepth =
    profile.subagents.maxDepth !== undefined
      ? Math.min(faceDepth, profile.subagents.maxDepth)
      : faceDepth;
  const maxActive =
    profile.subagents.maxActiveChildren !== undefined
      ? Math.min(faceActive, profile.subagents.maxActiveChildren)
      : faceActive;
  const depth = subagentDepth(runtime, sessionId);
  const active =
    countActiveChildren(runtime, sessionId) + pendingSpawnCount(sessionId);
  const delegated = runtime.subagents.listDelegated(sessionId).length;
  return {
    depth,
    maxDepth,
    active,
    maxActive,
    delegated,
    slotsFree: Math.max(0, maxActive - active),
  };
}

function childInboxCounts(
  runtime: FaceRuntime,
  childSessionId: string,
): { queued: number; steering: number } {
  if (!runtime.store.has(childSessionId)) {
    return { queued: 0, steering: 0 };
  }
  const pending = listPendingAdmits(
    readSessionEvents(runtime.store, childSessionId),
    childSessionId,
  );
  let queued = 0;
  let steering = 0;
  for (const admit of pending) {
    if (admit.delivery === "steer") steering += 1;
    else queued += 1;
  }
  return { queued, steering };
}
export {
  parseExternalAgentKind,
  parseExternalAgentProduct,
  runExternalAgentTurn,
  resolveExternalAgentLaunch,
  openExternalAgentLiveSession,
  supportsExternalContinuable,
  ExternalAgentError,
  ExternalAgentSessionRegistry,
  externalAgentHandlesPath,
  isChildSessionActive,
  startExternalContinuable,
  promptExternalContinuable,
  interruptExternalContinuable,
  type ExternalAgentKind,
  type ContinuableExternalKind,
  type ExternalAgentLiveSession,
  type ExternalAgentHandleRecord,
  type ExternalAgentProductConfig,
  type ExternalSpawn,
  type RunExternalAgentOptions,
} from "./external-agent-runtime.js";

export function subagentDepth(
  runtime: FaceRuntime,
  sessionId: string,
): number {
  let depth = 0;
  let cur = sessionId;
  for (;;) {
    const link = runtime.subagents.getByChild(cur);
    if (!link) break;
    // UI/rewind forks are lineage only — they do not consume tool depth budget.
    if (link.mode !== "fork") depth += 1;
    cur = link.parentSessionId;
  }
  return depth;
}

async function waitDrainIdle(
  runtime: FaceRuntime,
  sessionId: string,
  signal?: AbortSignal,
  timeoutMs = FOREGROUND_WAIT_MS,
): Promise<void> {
  const run = runtime.drain.run?.bind(runtime.drain);
  if (run) {
    // hub.run is a join on a Promise that no longer observes cancellation,
    // so it must race the caller signal: a parent turn aborted while waiting
    // for its child would otherwise hang the tool batch forever. The join
    // stays attached in the background — the caller cancels the child right
    // after this rejects, which is what actually drains it.
    //
    // The race must also carry the timeout: latch.run() joins until the
    // child's chain *actually* settles, so a child stuck on a tool that
    // ignores abort pins the parent's turn for as long as it hangs. The
    // timeout used to apply only to the polling fallback below — i.e. never
    // on the Host path, which always has run().
    await raceDeadline(
      abortable(run(sessionId), signal),
      timeoutMs,
      sessionId,
    );
    return;
  }
  // Same deadline semantics as the hub.run branch above — one throw site, one
  // message, so a caller (or a log grep) cannot tell the two paths apart.
  await raceDeadline(
    (async () => {
      while (runtime.drain.isActive(sessionId)) {
        if (signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    })(),
    timeoutMs,
    sessionId,
  );
}

/**
 * Reject once `timeoutMs` elapses, naming the session so the failure reads
 * like the polling branch's. The wrapped promise keeps running — the caller
 * cancels the child right after, which is what actually drains it.
 */
function raceDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  sessionId: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`subagent timed out waiting for session ${sessionId}`),
        ),
      timeoutMs,
    );
  });
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    timedOut,
  ]);
}

/** Reject as soon as `signal` aborts; the wrapped promise keeps running. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(abortError(signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function abortError(reason?: unknown): Error {
  const err = new Error(formatSubagentAbortReason(reason));
  err.name = "AbortError";
  return err;
}

/**
 * How a parent gets work back out of a child that outlived the foreground
 * wait. One place on purpose: background spawn, timeout salvage and failure
 * replies must not drift apart, or a parent learns the recovery verbs only
 * on the happy path.
 */
export function childResumeHint(childId: string): string {
  return (
    `Child session \`${childId}\` is not gone: \`wait_agent\` keeps waiting for it, ` +
    `\`session_read\` replays its history, \`session_trace\` shows its lineage, ` +
    `\`list_agents\` its state, and \`followup_task\` wakes a new turn on it. Read it ` +
    `before spawning a replacement so the new task does not repeat work it already did.`
  );
}

/**
 * The slice of a child's log the parent owns: seeded parent text never counts.
 * One read, two projections (`lastAssistantBodyText` for the salvaged answer,
 * `lastModelRetryNotice` for what its model request was doing).
 */
export function childOwnedEvents(
  runtime: Pick<FaceRuntime, "store" | "subagents">,
  childId: string,
): readonly SessionEvent[] {
  const link = runtime.subagents.getByChild(childId);
  return subagentOwnedEvents(link, readSessionEvents(runtime.store, childId));
}

function formatSubagentAbortReason(reason: unknown): string {
  if (reason === undefined || reason === null) return "aborted";
  if (reason instanceof Error) {
    const message = reason.message.trim();
    return message.length > 0 ? message : reason.name || "aborted";
  }
  if (reason !== null && typeof reason === "object" && "kind" in reason) {
    const kind = (reason as { kind?: unknown }).kind;
    if (kind === "user") return "aborted by user";
    if (kind === "parent") return "aborted by parent";
    if (kind === "disposed") return "aborted: session disposed";
    if (kind === "legacy") return "aborted";
    if (kind === "hook") {
      const hookReason = (reason as { reason?: unknown }).reason;
      if (typeof hookReason === "string") {
        return `aborted by hook: ${hookReason}`;
      }
    }
  }
  if (typeof reason === "string") {
    const trimmed = reason.trim();
    return trimmed.length > 0 ? trimmed : "aborted";
  }
  try {
    const json = JSON.stringify(reason);
    if (typeof json === "string" && json.length > 0 && json !== "{}") {
      return json;
    }
  } catch {
    /* ignore */
  }
  return "aborted";
}

export interface BindSubagentToolsOptions {
  readonly runtime: FaceRuntime;
  readonly parentSessionId: string;
  readonly maxDepth?: number;
  /**
   * Max concurrent *active* (draining) direct children under this parent.
   * Omit → {@link DEFAULT_MAX_ACTIVE_CHILDREN} (4).
   */
  readonly maxActiveChildren?: number;
  /** Override spawn for external runtimes (tests). */
  readonly externalSpawn?: ExternalSpawn;
  /** Override env for external launch resolution (tests). */
  readonly externalEnv?: NodeJS.ProcessEnv;
  /**
   * Foreground wait budget in ms (default {@link FOREGROUND_WAIT_MS}, 10 min).
   * A child that outruns it is not discarded — its answer is salvaged and the
   * parent gets the resume verbs — but the budget itself has to be raisable
   * for legitimately long research children.
   */
  readonly foregroundWaitMs?: number;
}

function countActiveChildren(
  runtime: FaceRuntime,
  parentSessionId: string,
): number {
  let n = 0;
  for (const link of runtime.subagents.listDelegated(parentSessionId)) {
    if (isChildSessionActive(runtime, link.childSessionId)) n += 1;
  }
  return n;
}

/**
 * In-flight spawn reservations (sync). Two parallel `subagent` settles both
 * read `countActiveChildren` before either child's drain latches — without
 * this, both can pass `active < maxActive` and overshoot the cap.
 */
const pendingSpawnSlots = new Map<string, number>();

function pendingSpawnCount(parentSessionId: string): number {
  return pendingSpawnSlots.get(parentSessionId) ?? 0;
}

function reserveSpawnSlot(parentSessionId: string): void {
  pendingSpawnSlots.set(
    parentSessionId,
    pendingSpawnCount(parentSessionId) + 1,
  );
}

function releaseSpawnSlot(parentSessionId: string): void {
  const n = pendingSpawnCount(parentSessionId);
  if (n <= 1) pendingSpawnSlots.delete(parentSessionId);
  else pendingSpawnSlots.set(parentSessionId, n - 1);
}

/**
 * Undo a half-made spawn. `session.create` / `session.fork` already made the
 * child durable and registered its link, so any failure between there and a
 * successful `session.prompt` would otherwise leave an empty session in the
 * sidebar and a permanent entry in the catalog / quota counts.
 */
async function discardUnstartedChild(
  runtime: FaceRuntime,
  childSessionId: string,
): Promise<void> {
  runtime.subagents.detach(childSessionId);
  runtime.agentTeams.removeNode(childSessionId);
  runtime.agentTeamTasks.forgetByChild(childSessionId);
  runtime.sessionCwds.delete(childSessionId);
  try {
    await dispatchFaceMethod(
      runtime,
      "session.cancel",
      `tool-sa-discard-${childSessionId}`,
      { sessionId: childSessionId, cascade: true },
    );
  } catch {
    /* best effort: the log is dropped either way */
  }
  try {
    runtime.store.delete?.(childSessionId);
  } catch {
    /* store without delete / already gone */
  }
  forgetRequestHeaderCache(childSessionId);
  await Promise.resolve(runtime.invalidateAgent?.(childSessionId)).catch(
    () => undefined,
 );
}

/**
 * Reject a caller-supplied `task_id` another child already owns. Checked
 * *before* the child exists: rebinding the card would misdirect that child's
 * later idle notice (`completeByChild` keys on childSessionId).
 */
function taskIdConflict(
  runtime: FaceRuntime,
  taskIdHint: string | undefined,
): string | undefined {
  if (!taskIdHint) return undefined;
  const boundChild = runtime.agentTeamTasks.get(taskIdHint)?.childSessionId;
  return boundChild
    ? `subagent: task_id ${taskIdHint} is already bound to child ${boundChild}; use a different task_id`
    : undefined;
}

/**
 * Optional LLM target for a freshly created child.
 *
 * Precedence: the call's own args → the fleet-wide `agent-loop.subagentModel`
 * setting → the parent's own route. `model` alone inherits the parent's current
 * provider; `provider` alone is rejected.
 */
async function applySubagentModelOverride(
  runtime: FaceRuntime,
  args: {
    readonly parentSessionId: string;
    readonly childSessionId: string;
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    /**
     * True when the child is an external subprocess (ACP / app-server /
     * claude-code). Its LLM route belongs to that CLI, so a Face-side pin is
     * not merely ineffective — it is a false record. Skips the pin instead.
     */
    readonly skipExternal?: boolean;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const providerRaw = args.provider?.trim() ?? "";
  const modelRaw = args.model?.trim() ?? "";
  const effortRaw = args.reasoningEffort?.trim() ?? "";
  // Refuse loudly rather than silently: an explicit model on an external
  // child would otherwise read as honored when the subprocess ignores it.
  if (args.skipExternal && (providerRaw || modelRaw || effortRaw)) {
    return {
      ok: false,
      message:
        "subagent: model / provider / reasoning_effort do not apply to an external runtime " +
        "(acp / app-server / claude-code) — the child CLI picks its own model. " +
        "Drop the argument, or use runtime=in-process.",
    };
  }
  // No per-call pin: the setting owns the route, and an empty setting leaves
  // the child on the parent's selection that `session.create` copied.
  const fleet =
    providerRaw || modelRaw || effortRaw
      ? undefined
      : resolveSubagentModelSetting(runtime);
  if (!providerRaw && !modelRaw && !effortRaw && !fleet) return { ok: true };
  const model = modelRaw || fleet?.model || "";
  const effort = effortRaw || fleet?.reasoningEffort || "";
  if (!model) {
    return {
      ok: false,
      message:
        "subagent: model is required when overriding provider or reasoning_effort",
    };
  }
  const provider =
    providerRaw
    || fleet?.provider
    || resolveSessionModelSelection(runtime, args.parentSessionId).provider;
  const selected = await selectSessionModel(runtime, {
    sessionId: args.childSessionId,
    provider,
    model,
    ...(effort ? { reasoningEffort: effort } : {}),
  });
  if (!selected.ok) {
    return {
      ok: false,
      message: `subagent model: ${selected.error.message}`,
    };
  }
  return { ok: true };
}

function createSubagentTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  /**
   * Ceilings for one call. Resolved live (not frozen at bind time) so the
   * numbers `analytics` / `list_agents` report are the numbers spawn
   * enforces — a Settings change takes effect on the next call instead of
   * at the next agent rebuild. The bind options are a test-only override.
   */
  const caps = (): {
    maxDepth: number;
    maxActive: number;
    active: number;
  } => {
    const quota = resolveSubagentQuota(
      options.runtime,
      options.parentSessionId,
    );
    return {
      maxDepth: options.maxDepth ?? quota.maxDepth,
      maxActive: options.maxActiveChildren ?? quota.maxActive,
      active: quota.active,
    };
  };
  const foregroundWaitMs = options.foregroundWaitMs ?? FOREGROUND_WAIT_MS;
  const description =
    "Delegate a self-contained task to a teammate subagent (separate session, same workspace as this session unless worktree:true). " +
    "Use for focused independent work — research, a scoped implementation, analysis, or read-only review — " +
    "so it does not consume this conversation's context. " +
    "By default the child cannot see this chat — give a complete standalone prompt (paths, goals, constraints, persona). " +
    "Do not tell the child to read AGENTS.md to discover who it is; Face prepends parent/child session ids, mode, role, and cwd. " +
    "Set inherit_context true to seed the child with this session's completed turns only " +
    "(the current in-flight turn is excluded). " +
    "By default waits for the result (one-shot, no later human messages on that child). " +
    "That foreground wait is bounded (10 min by default): on expiry the child is NOT discarded — " +
    "whatever answer it already wrote is salvaged into this result and the child id stays readable " +
    "(session_read / followup_task), so prefer run_in_background for genuinely long work instead of retrying blind. " +
    "Set run_in_background true for a continuable child (chat companion / long task) and continue via followup_task / send_message. " +
    "Prefer Agent Team member_id from the turn-start collab board (and this tool / team_list) over restating playbook, skills, or AGENTS.md; " +
    "match the live catalog by name and brief — if a member fits the user ask, spawn that member_id this turn instead of Skill-loading the same job yourself; " +
    "optional role (worker|researcher|reviewer|lead) is only the fallback when no member fits; " +
    "optional output_schema appends an OUTPUT CONTRACT and validates the final JSON; " +
    "optional task_id / task_name register the work on the Agent Teams task board. " +
    "Optional provider / model / reasoning_effort pin the child's LLM (model alone keeps the parent provider). " +
    "Optional runtime: omit or in-process (default Face child); acp / app-server / claude-code spawn an external subprocess. " +
    "acp / app-server support run_in_background + followup_task / send_message / wait_agent / interrupt_agent on the same list surface; claude-code remains one-shot print. " +
    "The child's answer is returned inline in this tool result when short. " +
    "Only when the UTF-8 body exceeds ~12KB does Face spill it under ~/.xrk/spill/tool-outputs/ " +
    "and replace the body with a path + head/tail preview — then read_file that path. " +
    "An empty or missing tool-outputs directory means nothing spilled; the full answer is already in this result (or the session event log), not on disk.";
  return {
    name: "subagent",
    description,
    dynamicSchema: () => {
      const ws = canvasWorkspaceIdForSession(
        options.runtime,
        options.parentSessionId,
      );
      const catalog = formatRosterCatalog(
        options.runtime.agentRoster.listVisible(ws),
      );
      return {
        description:
          `${description}\n\nPrefer member_id from this Agent Team catalog:\n${catalog}`,
      };
    },
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short (3-5 word) label for the delegated task (sidebar).",
        },
        prompt: {
          type: "string",
          description:
            "Task for the subagent. Put the actual job here (paths, goals, constraints, any persona). " +
            "When inherit_context is false (default), the child does not see this conversation. " +
            "When inherit_context is true, build on the seeded completed turns. " +
            "Face already injects parent/child session ids — do not send the child to AGENTS.md to learn its role.",
        },
        inherit_context: {
          type: "boolean",
          description:
            "If true, seed the child with this session's completed-turn prefix (open turn excluded). Default false. Ignored for external runtimes.",
        },
        member_id: {
          type: "string",
          description:
            "Agent Team member id. Face applies that member's tools, inject, and playbook — the same three surfaces the parent already edits. Prefer this over restating those in prompt.",
        },
        run_in_background: {
          type: "boolean",
          description:
            "If true, return the child session id immediately (continuable). Default false (wait for the child's final answer). Supported for in-process and external acp / app-server (not claude-code).",
        },
        role: {
          type: "string",
          description:
            "Spawn role template: default | worker | researcher | reviewer | lead (alias: agent_type).",
        },
        agent_type: {
          type: "string",
          description: "Alias of role (Codex agent_type).",
        },
        task_id: {
          type: "string",
          description:
            "Optional stable task id on the Agent Teams board (auto-minted when omitted).",
        },
        task_name: {
          type: "string",
          description:
            "Task board title (defaults to description / task_id).",
        },
        output_schema: {
          type: "object",
          description:
            "Optional JSON Schema for the child's FINAL answer (Hermes OUTPUT CONTRACT). Validated after the turn; one correction turn on failure for foreground waits.",
        },
        provider: {
          type: "string",
          description:
            "Optional LLM provider route for the child (e.g. deepseek). Pair with model; when omitted, inherits the parent session's provider.",
        },
        model: {
          type: "string",
          description:
            "Optional model id for the child. When set, pins this child's session.selectModel route (does not change other sessions).",
        },
        reasoning_effort: {
          type: "string",
          description:
            "Optional reasoning effort for the child when the selected model advertises efforts.",
        },
        runtime: {
          type: "string",
          description:
            "Delegation runtime: in-process (default), acp (Settings external-agent.acpAgent / XRK_ACP_AGENT), app-server (Settings / XRK_CODEX_APP_SERVER), claude-code (Settings / XRK_CLAUDE_CODE).",
        },
        worktree: {
          type: "boolean",
          description:
            "If true and this session is a local git checkout, run the child in its own git worktree. " +
            "Skipped when the repo is not git or the terminal is remote. " +
            "The worktree is removed only when the child made zero commits and left the tree clean; otherwise it stays.",
        },
      },
      required: ["prompt"],
    },
    // Without this, settle-batch treats every `subagent` call as an exclusive
    // barrier — two tool calls in one turn run one-after-another, so Status
    // shows "1 subagent" even when the model asked for parallel siblings.
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: String(
        (args as { description?: string }).description?.trim() || "Subagent",
      ),
      kind: "execute",
      rawInput: args,
    }),
    async execute(args, signal) {
      const a = args as {
        description?: string;
        prompt?: string;
        inherit_context?: boolean;
        run_in_background?: boolean;
        runtime?: string;
        worktree?: boolean;
        role?: string;
        agent_type?: string;
        member_id?: string;
        task_id?: string;
        task_name?: string;
        output_schema?: unknown;
        provider?: string;
        model?: string;
        reasoning_effort?: string;
      };
      // Defense in depth: Host should not bind this tool when the badge is
      // Frugal/minimal/shell. If a stale AgentHandle still carries it, refuse.
      const badge = effectiveSessionAgentPreset(
        options.runtime,
        options.parentSessionId,
      );
      if (resolveAgentPresetProfile(badge).subagents.mode === "off") {
        return {
          content:
            `subagent: session badge "${badge}" has subagents off ` +
            "(Frugal / Minimal / Shell). Switch to Shallow or XRK Harness for a new session.",
          isError: true,
        };
      }
      const promptBare = String(a.prompt ?? "").trim();
      if (!promptBare) {
        return { content: "subagent: empty prompt", isError: true };
      }
      let prompt = promptBare;
      const roleRaw = a.role ?? a.agent_type;
      let spawnRole: AgentTeamSpawnRole | undefined;
      if (roleRaw !== undefined && String(roleRaw).trim()) {
        spawnRole = parseAgentTeamSpawnRole(roleRaw);
        if (!spawnRole) {
          return {
            content:
              "subagent: role/agent_type must be default | worker | researcher | reviewer | lead",
            isError: true,
          };
        }
      }
      const memberId = String(a.member_id ?? "").trim();
      let rosterMember:
        | ReturnType<typeof options.runtime.agentRoster.get>
        | undefined;
      if (memberId) {
        const workspaceId = canvasWorkspaceIdForSession(
          options.runtime,
          options.parentSessionId,
        );
        rosterMember = options.runtime.agentRoster.get(workspaceId, memberId);
        if (!rosterMember) {
          return {
            content: `subagent: unknown member_id "${memberId}" (team_list first)`,
            isError: true,
          };
        }
        prompt = `${rosterMember.playbook.trim()}\n\nTASK:\n${promptBare}`;
        if (spawnRole === undefined && rosterMember.role !== "default") {
          spawnRole = rosterMember.role;
        }
      }
      const memberSpawn = memberId ? { memberId } : {};
      const schemaCoerce = coerceOutputSchema(a.output_schema);
      if (schemaCoerce.error) {
        return {
          content: `subagent: ${schemaCoerce.error}`,
          isError: true,
        };
      }
      const outputSchema: OutputSchemaObject | undefined = schemaCoerce.schema;
      const runtimeKind = parseExternalAgentKind(a.runtime);
      if (runtimeKind === undefined) {
        return {
          content:
            "subagent: runtime must be in-process | acp | app-server | claude-code",
          isError: true,
        };
      }
      if (runtimeKind !== "in-process") {
        const background = a.run_in_background === true;
        // One cwd for every external branch. `resolveSessionCwd` already
        // falls back to the workspace root, so the child runs where the
        // parent runs instead of always at the root (which silently broke
        // any session that had moved into another workspace).
        const externalCwd = resolveSessionCwd(
          options.runtime,
          options.parentSessionId,
        );
        if (background && !supportsExternalContinuable(runtimeKind)) {
          return {
            content:
              "subagent: run_in_background is not supported for claude-code (print); use acp or app-server",
            isError: true,
          };
        }
        if (a.worktree === true) {
          // Worktree handling lives in the in-process branch below; silently
          // dropping the flag would have the child edit the parent's own
          // checkout while the caller believed it was isolated.
          return {
            content:
              "subagent: worktree is only supported for runtime=in-process " +
              "(an external runtime owns its own working directory).",
            isError: true,
          };
        }
        const depth = subagentDepth(
          options.runtime,
          options.parentSessionId,
        );
        const { maxDepth, maxActive: maxActiveChildren, active } = caps();
        if (depth >= maxDepth) {
          return {
            content: `subagent: max depth ${maxDepth} reached (current depth ${depth})`,
            isError: true,
          };
        }
        if (active >= maxActiveChildren) {
          return {
            content: `subagent: max active children ${maxActiveChildren} reached (active ${active})`,
            isError: true,
          };
        }
        reserveSpawnSlot(options.parentSessionId);
        let externalSlotHeld = true;
        const dropExternalSlot = (): void => {
          if (!externalSlotHeld) return;
          externalSlotHeld = false;
          releaseSpawnSlot(options.parentSessionId);
        };
        try {
          const product = parseExternalAgentProduct(
            options.runtime.settingsNamespaces.view("external-agent").value,
          );
          if (background && supportsExternalContinuable(runtimeKind)) {
            const label =
              String(a.description ?? "").trim() ||
              String(a.task_name ?? "").trim() ||
              `external-${runtimeKind}`;
            const created = await dispatchFaceMethod(
              options.runtime,
              "session.create",
              `tool-sa-ext-${Date.now()}`,
              {
                parentSessionId: options.parentSessionId,
                label,
                mode: "continuable",
                ...memberSpawn,
                ...(spawnRole && spawnRole !== "default"
                  ? { role: spawnRole }
                  : {}),
              },
            );
            if (!created.result.ok) {
              return {
                content: `subagent create failed: ${created.result.error.message}`,
                isError: true,
              };
            }
            const childId = String(
              (created.result.value as { sessionId: string }).sessionId,
            );
            const modelPin = await applySubagentModelOverride(options.runtime, {
              parentSessionId: options.parentSessionId,
              childSessionId: childId,
              ...(typeof a.provider === "string" ? { provider: a.provider } : {}),
              ...(typeof a.model === "string" ? { model: a.model } : {}),
              ...(typeof a.reasoning_effort === "string"
                ? { reasoningEffort: a.reasoning_effort }
                : {}),
              // An ACP / app-server / claude-code child runs on ITS OWN CLI
              // config; a Face-side pin cannot reach it. Recording one anyway
              // made `/status` and `list_agents` report a route the subprocess
              // never used, so the record is skipped rather than faked.
              skipExternal: true,
            });
            if (!modelPin.ok) {
              await discardUnstartedChild(options.runtime, childId);
              return { content: modelPin.message, isError: true };
            }
            const taskTitle =
              String(a.task_name ?? "").trim() || label;
            const taskIdConflictMsg = taskIdConflict(
              options.runtime,
              String(a.task_id ?? "").trim() || undefined,
            );
            if (taskIdConflictMsg) {
              await discardUnstartedChild(options.runtime, childId);
              return { content: taskIdConflictMsg, isError: true };
            }
            const task = options.runtime.agentTeamTasks.open({
              parentSessionId: options.parentSessionId,
              title: taskTitle,
              childSessionId: childId,
              ...(spawnRole && spawnRole !== "default"
                ? { role: spawnRole }
                : {}),
              ...(String(a.task_id ?? "").trim()
                ? { taskId: String(a.task_id).trim() }
                : {}),
            });
            if (outputSchema) {
              options.runtime.agentTeamTasks.setOutputSchema(
                task.id,
                outputSchema,
              );
            }
            await startExternalContinuable({
              runtime: options.runtime,
              faceSessionId: childId,
              kind: runtimeKind,
              cwd: externalCwd,
              prompt,
              background: true,
              ...(signal ? { signal } : {}),
              ...(options.externalEnv ? { env: options.externalEnv } : {}),
              ...(product ? { product } : {}),
              ...(options.externalSpawn
                ? { spawnImpl: options.externalSpawn }
                : {}),
            });
            // Child is busy in externalAgents; pending slot no longer needed.
            dropExternalSlot();
            return {
              content: [
                `Started background external subagent \`${childId}\` (${label} · ${runtimeKind}).`,
                `task ${task.id}` +
                  (spawnRole && spawnRole !== "default"
                    ? ` · role ${spawnRole}`
                    : ""),
                "Use followup_task / send_message / wait_agent / interrupt_agent / list_agents / analytics.",
                "Keep working; do not busy-poll.",
              ].join("\n"),
            };
          }
          // One-shot external has no Face child latch — do not hold the slot
          // for the whole print turn (would starve parallel in-process spawns).
          dropExternalSlot();
          const result = await runExternalAgentTurn({
            kind: runtimeKind,
            cwd: externalCwd,
            prompt,
            ...(signal ? { signal } : {}),
            ...(options.externalEnv ? { env: options.externalEnv } : {}),
            ...(product ? { product } : {}),
            ...(options.externalSpawn
              ? { spawnImpl: options.externalSpawn }
              : {}),
          });
          return {
            content: `[external:${result.kind}]\n${result.text}`,
          };
        } catch (err) {
          const msg =
            err instanceof ExternalAgentError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          return { content: `subagent external: ${msg}`, isError: true };
        } finally {
          dropExternalSlot();
        }
      }
      const depth = subagentDepth(
        options.runtime,
        options.parentSessionId,
      );
      const { maxDepth, maxActive: maxActiveChildren, active } = caps();
      if (depth >= maxDepth) {
        return {
          content: `subagent: max depth ${maxDepth} reached (current depth ${depth})`,
          isError: true,
        };
      }
      if (active >= maxActiveChildren) {
        return {
          content: `subagent: max active children ${maxActiveChildren} reached (active ${active})`,
          isError: true,
        };
      }
      reserveSpawnSlot(options.parentSessionId);
      let spawnSlotHeld = true;
      const dropSpawnSlot = (): void => {
        if (!spawnSlotHeld) return;
        spawnSlotHeld = false;
        releaseSpawnSlot(options.parentSessionId);
      };
      try {
      const background = a.run_in_background === true;
      const inherit = a.inherit_context === true;
      const label =
        String(a.description ?? "").trim() ||
        String(a.task_name ?? "").trim() ||
        (background ? "subagent" : "subagent-task");
      const linkMode = background ? "continuable" : "one-shot";
      const parentCwd = resolveSessionCwd(
        options.runtime,
        options.parentSessionId,
      );
      const taskTitle = String(a.task_name ?? "").trim() || label;
      const taskIdHint = String(a.task_id ?? "").trim() || undefined;
      // Before anything is allocated: reusing a task_id another child owns
      // must not leave a worktree or a session behind.
      const taskIdError = taskIdConflict(options.runtime, taskIdHint);
      if (taskIdError) {
        return { content: taskIdError, isError: true };
      }
      let isolated: SubagentWorktree | null = null;
      let managedLease: ManagedWorktreeLease | null = null;
      let worktreeSkip = "";
      if (a.worktree === true) {
        if (worktreeSkippedForRemote(options.runtime.remoteExecution)) {
          worktreeSkip = "worktree skipped: not a local terminal";
        } else {
          managedLease =
            options.runtime.managedWorktrees.allocate({
              parentCwd,
              parentSessionId: options.parentSessionId,
            }) ?? null;
          if (managedLease) {
            isolated = {
              path: managedLease.path,
              branch: managedLease.branch,
              repoRoot: managedLease.repoRoot,
              baseCommit: managedLease.baseCommit,
            };
          } else {
            // Fall back to one-shot create when the registry path fails.
            isolated = createSubagentWorktree(parentCwd);
            if (!isolated) {
              worktreeSkip =
                "worktree skipped: not a git repository or worktree add failed";
            }
          }
        }
      }
      let taskBody = prompt;
      if (outputSchema) {
        taskBody = appendOutputContract(taskBody, outputSchema);
      }
      taskBody = isolated
        ? `${taskBody}\n\n${worktreeContextNote(isolated)}`
        : taskBody;

      const openTask = (childSessionId: string) => {
        const task = options.runtime.agentTeamTasks.open({
          parentSessionId: options.parentSessionId,
          title: taskTitle,
          childSessionId,
          ...(spawnRole && spawnRole !== "default" ? { role: spawnRole } : {}),
          ...(taskIdHint ? { taskId: taskIdHint } : {}),
        });
        if (outputSchema) {
          options.runtime.agentTeamTasks.setOutputSchema(task.id, outputSchema);
        }
        if (managedLease) {
          options.runtime.managedWorktrees.bind(managedLease.id, {
            childSessionId,
            teamTaskId: task.id,
          });
          options.runtime.agentTeamTasks.bindWorktree(task.id, {
            path: managedLease.path,
            branch: managedLease.branch,
            id: managedLease.id,
          });
        } else if (isolated) {
          options.runtime.agentTeamTasks.bindWorktree(task.id, {
            path: isolated.path,
            branch: isolated.branch,
          });
        }
        return task;
      };

      const reclaimIsolated = (keep: boolean): string => {
        if (worktreeSkip) return worktreeSkip;
        if (!isolated) return "";
        if (keep) {
          return `[worktree] ${isolated.path}\nbranch ${isolated.branch}\nleft in place (child still running)`;
        }
        if (managedLease) {
          return formatWorktreeResult(
            options.runtime.managedWorktrees.reclaim(managedLease.id) ??
              finalizeSubagentWorktree(isolated),
          );
        }
        return formatWorktreeResult(finalizeSubagentWorktree(isolated));
      };

      const dropIsolated = (): void => {
        if (!isolated) return;
        if (managedLease) {
          options.runtime.managedWorktrees.reclaim(managedLease.id);
        } else {
          finalizeSubagentWorktree(isolated);
        }
      };

      /**
       * Codex `spawn_guard.rs` (RAII): a half-made spawn is torn down on
       * EVERY exit path, including an unexpected throw. Explicit
       * `discardUnstartedChild` calls cover the known failure branches; this
       * flag + finally is the backstop for anything they miss.
       */
      let started = false;
      const discardIfUnstarted = async (): Promise<void> => {
        if (started || !childId) return;
        started = true;
        dropIsolated();
        await discardUnstartedChild(options.runtime, childId);
      };

      let childId: string;
      /** Fork seed size — bounds the root-evidence slice below. */
      let seedCut = 0;
      if (inherit) {
        // A transport reject (not an RpcResult error) here would strand the
        // worktree lease allocated above; catch keeps the cleanup total.
        let forked;
        try {
          forked = await dispatchFaceMethod(
            options.runtime,
            "session.fork",
            `tool-sa-fork-${Date.now()}`,
            {
              sessionId: options.parentSessionId,
              linkMode,
              label,
              ...(spawnRole && spawnRole !== "default"
                ? { role: spawnRole }
                : {}),
            },
          );
        } catch {
          dropIsolated();
          return {
            content: "subagent seed failed: fork request errored",
            isError: true,
          };
        }
        if (!forked.result.ok) {
          // No completed turn yet — fall back to a fresh child (DSH fork omits seed).
          if (forked.result.error.code === "fork-unavailable") {
            const created = await dispatchFaceMethod(
              options.runtime,
              "session.create",
              `tool-sa-${Date.now()}`,
              {
                parentSessionId: options.parentSessionId,
                label,
                mode: linkMode,
                ...memberSpawn,
                ...(spawnRole && spawnRole !== "default"
                  ? { role: spawnRole }
                  : {}),
              },
            );
            if (!created.result.ok) {
              dropIsolated();
              return {
                content: `subagent create failed: ${created.result.error.message}`,
                isError: true,
              };
            }
            childId = String(
              (created.result.value as { sessionId: string }).sessionId,
            );
          } else {
            dropIsolated();
            return {
              content: `subagent seed failed: ${forked.result.error.message}`,
              isError: true,
            };
          }
        } else {
          childId = String(
            (forked.result.value as { sessionId: string }).sessionId,
          );
          // Durable seed boundary: every answer read of this child must
          // slice from here, or the parent's last reply reads as its answer.
          seedCut = Number(
            (forked.result.value as { eventCount?: number }).eventCount ?? 0,
          );
          options.runtime.subagents.setSeedEventCount(childId, seedCut);
        }
      } else {
        const created = await dispatchFaceMethod(
          options.runtime,
          "session.create",
          `tool-sa-${Date.now()}`,
          {
            parentSessionId: options.parentSessionId,
            label,
            mode: linkMode,
            ...memberSpawn,
            ...(spawnRole && spawnRole !== "default"
              ? { role: spawnRole }
              : {}),
          },
        );
        if (!created.result.ok) {
          dropIsolated();
          return {
            content: `subagent create failed: ${created.result.error.message}`,
            isError: true,
          };
        }
        childId = String(
          (created.result.value as { sessionId: string }).sessionId,
        );
      }
      const modelPin = await applySubagentModelOverride(options.runtime, {
        parentSessionId: options.parentSessionId,
        childSessionId: childId,
        ...(typeof a.provider === "string" ? { provider: a.provider } : {}),
        ...(typeof a.model === "string" ? { model: a.model } : {}),
        ...(typeof a.reasoning_effort === "string"
          ? { reasoningEffort: a.reasoning_effort }
          : {}),
      });
      if (!modelPin.ok) {
        await discardIfUnstarted();
        return { content: modelPin.message, isError: true };
      }
      if (isolated) {
        options.runtime.sessionCwds.set(childId, isolated.path);
        // Worktree bind failure must not leak the child: swallow and let the
        // prompt below decide the spawn's fate (or the catch backstop).
        await Promise.resolve(options.runtime.invalidateAgent?.(childId)).catch(
          () => undefined,
        );
      }
      const childPrompt = applySubagentSpawnPreamble({
        prompt: taskBody,
        parentSessionId: options.parentSessionId,
        childSessionId: childId,
        mode: linkMode,
        label,
        ...(spawnRole ? { role: spawnRole } : {}),
        inheritContext: inherit,
        cwd: isolated?.path ?? parentCwd,
        isolatedWorktree: isolated !== null,
        ...(rosterMember
          ? { memberId: rosterMember.id, inject: rosterMember.inject }
          : {}),
        ...((): {
          permissionInherit?: string;
          parentToolSurface?: string;
        } => {
          const parentEvents = readSessionEvents(
            options.runtime.store,
            options.parentSessionId,
          );
          const sandbox = effectiveSandboxMode(parentEvents);
          const pathMode = pathAccessModeFromSandbox(sandbox);
          const permission =
            permissionSelectFromEvents(parentEvents).currentValue;
          const approval = effectiveApprovalPolicy(parentEvents);
          return {
            permissionInherit: `${permission} (path=${pathMode}) · approval=${approval}`,
            parentToolSurface: effectiveSessionAgentPreset(
              options.runtime,
              options.parentSessionId,
            ),
          };
        })(),
        // The human's own asks: a child that only sees the parent's paraphrase
        // drifts from what was actually authorized (Codex
        // `control/user_authorization.rs`). A forked child already carries
        // these in its seeded transcript, so only add them beyond the cut.
        ...((): { userAuthorization?: string } => {
          const block = rootUserAuthorizationBlock({
            parentEvents: readSessionEvents(
              options.runtime.store,
              options.parentSessionId,
            ),
            ...(seedCut > 0 ? { sinceEventCount: seedCut } : {}),
          });
          return block ? { userAuthorization: block } : {};
        })(),
      });
      const task = openTask(childId);
      const worktreeLine = reclaimIsolated;
      // A transport-level reject (not an RpcResult error) must not leak the
      // child: the catch backstop tears the half-made spawn down.
      let prompted: Awaited<ReturnType<typeof dispatchFaceMethod>>;
      try {
        prompted = await dispatchFaceMethod(
          options.runtime,
          "session.prompt",
          `tool-sa-p-${childId}`,
          {
            sessionId: childId,
            mode: "queue",
            content: [{ type: "text", text: childPrompt }],
          },
        );
      } catch (err) {
        await discardIfUnstarted();
        const extra = worktreeLine(false);
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [`subagent prompt failed: ${message}`, extra]
            .filter(Boolean)
            .join("\n"),
          isError: true,
        };
      }
      if (!prompted.result.ok) {
        await discardIfUnstarted();
        const extra = worktreeLine(false);
        return {
          content: [`subagent prompt failed: ${prompted.result.error.message}`, extra]
            .filter(Boolean)
            .join("\n"),
          isError: true,
        };
      }
      // Spawn accepted — the child is no longer a half-made shell.
      started = true;
      // Drain (or busy latch) now counts in active; drop the pending slot so
      // a sibling parallel `subagent` is not double-charged during wait.
      dropSpawnSlot();
      if (background) {
        return {
          content: [
            `Started background subagent \`${childId}\` (${label}).`,
            `task ${task.id}` +
              (spawnRole && spawnRole !== "default" ? ` · role ${spawnRole}` : ""),
            inherit
              ? "Seeded with this session's completed turns (open turn excluded)."
              : undefined,
            outputSchema
              ? "OUTPUT CONTRACT attached; result will be schema-checked on idle."
              : undefined,
            childResumeHint(childId),
            "Use followup_task to wake a new task, send_message (delivery queue|steer) to continue, wait_agent for results, interrupt_agent (takeover true to pause for human) to stop, analytics for quota.",
            "Keep working; do not busy-poll.",
            worktreeLine(true) || undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      try {
        await waitDrainIdle(options.runtime, childId, signal, foregroundWaitMs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = /timed out waiting/i.test(message);
        // Salvage before cancelling: `session.cancel` drops the chain, so a
        // child that had already written its answer would bill the parent for
        // nothing. A child that produced nothing is stuck, so it still gets
        // cancelled instead of left dangling.
        const owned = childOwnedEvents(options.runtime, childId);
        const salvaged = lastAssistantBodyText(owned);
        const retrying = timedOut
          ? lastModelRetryNotice(owned)
          : undefined;
        if (!salvaged) {
          await dispatchFaceMethod(
            options.runtime,
            "session.cancel",
            `tool-sa-c-${childId}`,
            // `parent`, not the default `user`: a parent that gave up waiting
            // is not a human hitting Stop. The old default stamped
            // turn/end `reason: user`, so every timed-out child read as "stopped
            // by the user" in the child log and in the completion notice.
            { sessionId: childId, cause: { kind: "parent" } },
          ).catch(() => undefined);
        }
        options.runtime.agentTeamTasks.complete(task.id, {
          ok: false,
          preview: message,
        });
        const extra = worktreeLine(false);
        return {
          content: [
            salvaged
              ? `${message}, but the child finished work before the wait expired — its last answer is salvaged below.`
              : `subagent failed: ${message}`,
            salvaged || undefined,
            timedOut ? childResumeHint(childId) : undefined,
            retrying,
            extra,
          ]
            .filter(Boolean)
            .join("\n"),
          isError: true,
        };
      }
      const all = readSessionEvents(options.runtime.store, childId);
      // Never return seeded parent assistant text as the child's result.
      const link = options.runtime.subagents.getByChild(childId);
      const readOwned = () =>
        subagentOwnedEvents(
          link,
          readSessionEvents(options.runtime.store, childId),
        );
      let owned = subagentOwnedEvents(link, all);
      let text = lastAssistantBodyText(owned);
      let schemaValid: boolean | undefined;
      let schemaErrors: readonly string[] | undefined;
      if (outputSchema) {
        // An empty body cannot satisfy the contract either: a silent skip
        // would hand the parent `ok: true` with an unvalidated (missing)
        // answer, so treat "no text" as one more schema failure.
        let checked = text
          ? validateOutputAgainstSchema(text, outputSchema)
          : { valid: false as const, errors: ["child produced no assistant text"] };
        if (!checked.valid) {
          const retry = await dispatchFaceMethod(
            options.runtime,
            "session.prompt",
            `tool-sa-schema-${childId}`,
            {
              sessionId: childId,
              mode: "queue",
              content: [
                {
                  type: "text",
                  text: buildOutputSchemaRetryMessage(checked.errors),
                },
              ],
            },
          );
          if (retry.result.ok) {
            try {
              await waitDrainIdle(options.runtime, childId, signal);
            } catch {
              /* keep first answer */
            }
            owned = readOwned();
            text = lastAssistantBodyText(owned) || text;
            checked = text
              ? validateOutputAgainstSchema(text, outputSchema)
              : { valid: false as const, errors: ["child produced no assistant text"] };
          }
        }
        schemaValid = checked.valid;
        schemaErrors = checked.errors;
      }
      options.runtime.agentTeamTasks.complete(task.id, {
        // An unvalidated answer is not a successful delegation: the task
        // board must not read `completed` when the contract was skipped.
        ok: schemaValid !== false,
        ...(text ? { preview: text } : {}),
        ...(schemaValid !== undefined ? { schemaValid } : {}),
        ...(schemaErrors && schemaErrors.length > 0
          ? { schemaErrors }
          : {}),
      });
      const extra = worktreeLine(false);
      if (!text) {
        return {
          content: [`(subagent ${childId} finished with no assistant text)`, extra]
            .filter(Boolean)
            .join("\n"),
        };
      }
      const schemaLine =
        schemaValid === undefined
          ? undefined
          : schemaValid
            ? "schema_valid=true"
            : `schema_valid=false\n${(schemaErrors ?? []).map((e) => `- ${e}`).join("\n")}`;
      return {
        content: [
          boundChildAnswer(options.parentSessionId, childId, text),
          schemaLine,
          extra,
        ]
          .filter(Boolean)
          .join("\n"),
        ...(schemaValid === false ? { isError: true } : {}),
      };
      } finally {
        dropSpawnSlot();
      }
    },
  };
}

function createListAgentsTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "list_agents",
    description:
      "List direct child subagents of this session (id, label, mode, running, model, inbox queue/steer, " +
      "and how each child's last turn actually ended — finished vs aborted by parent/user vs error, with idle age). " +
      "Prefaces with depth/active quota. Prefer `analytics` for a fuller quota snapshot.",
    parameters: { type: "object", properties: {} },
    isConcurrencySafe: () => true,
    async execute() {
      const listed = await dispatchFaceMethod(
        options.runtime,
        "subagent.list",
        `tool-sa-list-${Date.now()}`,
        { parentSessionId: options.parentSessionId },
      );
      if (!listed.result.ok) {
        return {
          content: listed.result.error.message,
          isError: true,
        };
      }
      const value = listed.result.value as {
        entries?: Array<{
          kind?: string;
          id?: string;
          label?: string;
          mode?: string;
          activity?: string;
          reason?: string;
          model?: string;
        }>;
      };
      const entries = value.entries ?? [];
      const quota = resolveSubagentQuota(
        options.runtime,
        options.parentSessionId,
      );
      const header =
        `quota depth ${quota.depth}/${quota.maxDepth}` +
        ` · active ${quota.active}/${quota.maxActive}` +
        ` · slots_free ${quota.slotsFree}` +
        ` · delegated ${quota.delegated}`;
      if (!entries.length) {
        return { content: `${header}\n(no subagents)` };
      }
      const lines = entries.map((e) => {
        if (e.kind === "diagnostic") {
          return `${e.id ?? "?"}\tdiagnostic\t${e.reason ?? "unavailable"}`;
        }
        const id = e.id ?? "?";
        const label = e.label ?? "subagent";
        const mode = e.mode ?? "?";
        const activity = e.activity ?? "idle";
        const inbox =
          id !== "?"
            ? childInboxCounts(options.runtime, id)
            : { queued: 0, steering: 0 };
        const route = e.model ? `\t${e.model}` : "";
        // `idle` alone reads the same for a child that finished and one the
        // parent's wait budget cut off; the outcome line is what separates
        // "delivered" from "killed".
        const outcome =
          id === "?" || e.kind === "diagnostic"
            ? ""
            : `\t${formatChildOutcome(
                readSessionEvents(options.runtime.store, id),
              )}`;
        return `${id}\t${label}\t${mode}\t${activity}${route}${outcome}\tq=${inbox.queued}\tsteer=${inbox.steering}`;
      });
      return { content: [header, ...lines].join("\n") };
    },
  };
}

function createSendMessageTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "send_message",
    description:
      "Pass a message to a continuable background subagent without forcing a new task turn by default. " +
      "delivery=queue (default): land in the child's inbox if it is still working. " +
      "delivery=steer: nudge at the next tool-step / turn boundary. " +
      "For a new task that should trigger a turn, prefer `followup_task`. " +
      "Clears human takeover pause on the Agent Teams task board. " +
      "Returns delivery confirmation only — not the child's answer (use `wait_agent`).",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Child session id from subagent / list_agents.",
        },
        message: { type: "string", description: "Follow-up text for the child." },
        delivery: {
          type: "string",
          description: "queue (default) or steer.",
        },
      },
      required: ["agent_id", "message"],
    },
    async execute(args) {
      const a = args as {
        agent_id?: string
        message?: string
        delivery?: string
      }
      const childId = String(a.agent_id ?? "").trim();
      const message = String(a.message ?? "").trim();
      if (!childId || !message) {
        return {
          content: "send_message requires agent_id and message",
          isError: true,
        };
      }
      const delivery =
        a.delivery === "steer" || a.delivery === "queue" ? a.delivery : "queue";
      const prompted = await dispatchFaceMethod(
        options.runtime,
        "subagent.prompt",
        `tool-sa-sm-${childId}`,
        {
          parentSessionId: options.parentSessionId,
          childSessionId: childId,
          mode: "continuable",
          delivery,
          content: [{ type: "text", text: message }],
        },
      );
      if (!prompted.result.ok) {
        return {
          content: prompted.result.error.message,
          isError: true,
        };
      }
      // Task-board resume is owned by `subagent.prompt` (the SoT for every
      // delivery route); calling it again here double-bumped the revision.
      return { content: `sent to ${childId} (${delivery})` };
    },
  };
}

function createTeamGraphTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "team_graph",
    description:
      "Inspect or edit the Agent Teams collaboration graph for this session " +
      "(delegates from subagent spawn + peer links). " +
      "action=view (default) returns the connected component with roles and depth; " +
      "neighbors lists adjacency; link/unlink peer edges; role sets delegator|worker|observer; " +
      "remove drops peer edges + role override for a node; " +
      "announce fans a message to peer neighbors via send_message (delivery queue|steer).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "view | neighbors | link | unlink | role | remove | announce (default view).",
        },
        from: { type: "string", description: "Edge source session id (link/unlink)." },
        to: { type: "string", description: "Edge target session id (link/unlink)." },
        node_id: {
          type: "string",
          description: "Node session id (neighbors / role / remove).",
        },
        label: { type: "string", description: "Optional peer edge label (link)." },
        role: {
          type: "string",
          description: "delegator | worker | observer; omit to clear override.",
        },
        kind: {
          type: "string",
          description: "neighbors filter: delegates | peer (default any).",
        },
        message: {
          type: "string",
          description: "Announce body (announce).",
        },
        delivery: {
          type: "string",
          description: "announce delivery: queue (default) or steer.",
        },
      },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const a = args as {
        action?: string;
        from?: string;
        to?: string;
        node_id?: string;
        label?: string;
        role?: string;
        kind?: string;
        message?: string;
        delivery?: string;
      };
      const action = String(a.action ?? "view").trim().toLowerCase() || "view";
      const graph = options.runtime.agentTeams;
      const root = options.parentSessionId;

      if (action === "link") {
        const from = String(a.from ?? "").trim();
        const to = String(a.to ?? "").trim();
        if (!from || !to) {
          return { content: "team_graph link requires from and to", isError: true };
        }
        const edge = graph.linkPeers(from, to, a.label);
        if (!edge) {
          return { content: "team_graph link failed (empty or self)", isError: true };
        }
        return {
          content: `linked peer ${edge.from} ↔ ${edge.to}${
            edge.label ? ` (${edge.label})` : ""
          }`,
        };
      }

      if (action === "unlink") {
        const from = String(a.from ?? "").trim();
        const to = String(a.to ?? "").trim();
        if (!from || !to) {
          return {
            content: "team_graph unlink requires from and to",
            isError: true,
          };
        }
        const ok = graph.unlinkPeers(from, to);
        return {
          content: ok
            ? `unlinked peer ${from} ↔ ${to}`
            : `no peer edge between ${from} and ${to}`,
          ...(ok ? {} : { isError: true }),
        };
      }

      if (action === "role") {
        const nodeId = String(a.node_id ?? "").trim();
        if (!nodeId) {
          return { content: "team_graph role requires node_id", isError: true };
        }
        const raw = a.role === undefined || a.role === null ? undefined : String(a.role).trim();
        const role =
          raw === undefined || raw === ""
            ? undefined
            : isAgentTeamRole(raw)
              ? raw
              : undefined;
        if (raw && !role) {
          return {
            content: "role must be delegator | worker | observer (or omit to clear)",
            isError: true,
          };
        }
        const effective = graph.setRole(nodeId, role);
        return {
          content: `role ${nodeId} → ${effective ?? "?"}${
            role === undefined ? " (derived)" : " (override)"
          }`,
        };
      }

      if (action === "remove") {
        const nodeId = String(a.node_id ?? "").trim();
        if (!nodeId) {
          return { content: "team_graph remove requires node_id", isError: true };
        }
        const ok = graph.removeNode(nodeId);
        return {
          content: ok
            ? `removed peer links / role for ${nodeId}`
            : `nothing to remove for ${nodeId}`,
          ...(ok ? {} : { isError: true }),
        };
      }

      if (action === "neighbors") {
        const nodeId = String(a.node_id ?? root).trim();
        const kindRaw = String(a.kind ?? "").trim().toLowerCase();
        const kind: AgentTeamEdgeKind | undefined =
          kindRaw === "delegates" || kindRaw === "peer" ? kindRaw : undefined;
        const hops = graph.neighbors(nodeId, kind);
        if (!hops.length) {
          return {
            content: `${nodeId}\t(no neighbors${kind ? ` kind=${kind}` : ""})`,
          };
        }
        const lines = hops.map(
          (h) =>
            `${h.id}\t${h.kind}\t${h.direction}${h.label ? `\t${h.label}` : ""}`,
        );
        return { content: [`${nodeId} neighbors:`, ...lines].join("\n") };
      }

      if (action === "announce") {
        const message = String(a.message ?? "").trim();
        if (!message) {
          return {
            content: "team_graph announce requires message",
            isError: true,
          };
        }
        const delivery =
          a.delivery === "steer" || a.delivery === "queue"
            ? a.delivery
            : "queue";
        const peers = graph.neighbors(root, "peer");
        if (!peers.length) {
          return { content: "no peer neighbors to announce to", isError: true };
        }
        const results: string[] = [];
        for (const peer of peers) {
          const prompted = await dispatchFaceMethod(
            options.runtime,
            "subagent.prompt",
            `tool-sa-ann-${peer.id}`,
            {
              parentSessionId: root,
              childSessionId: peer.id,
              mode: "continuable",
              delivery,
              content: [{ type: "text", text: message }],
            },
          );
          if (!prompted.result.ok) {
            results.push(`${peer.id}\tfail\t${prompted.result.error.message}`);
            continue;
          }
          results.push(`${peer.id}\tok\t${delivery}`);
        }
        return {
          content: [`announce → ${peers.length} peer(s):`, ...results].join(
            "\n",
          ),
        };
      }

      if (action !== "view") {
        return {
          content:
            "action must be view | neighbors | link | unlink | role | remove | announce",
          isError: true,
        };
      }

      const view = graph.view(root);
      if (!view.nodes.length) {
        return { content: "(empty team graph)" };
      }
      const nodeLines = view.nodes.map((n) => {
        const bits = [
          n.role ?? "?",
          n.depth !== undefined ? `d=${n.depth}` : undefined,
        ].filter(Boolean);
        return `N\t${n.id}\t${n.label}\t${bits.join(" · ")}`;
      });
      const edgeLines = view.edges.map(
        (e) =>
          `E\t${e.kind}\t${e.from}\t${e.to}${e.label ? `\t${e.label}` : ""}`,
      );
      return {
        content: [
          `team graph ${view.nodes.length}n/${view.edges.length}e`,
          ...nodeLines,
          ...edgeLines,
        ].join("\n"),
      };
    },
  };
}

function createFollowupTaskTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "followup_task",
    description:
      "Give an existing continuable subagent a new task and trigger a turn (Codex followup_task / TriggerTurn). " +
      "Unlike `send_message` (default queue-only), this always wakes the child. " +
      "Returns delivery confirmation only — use `wait_agent` for the answer.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Child session id from subagent / list_agents.",
        },
        message: {
          type: "string",
          description: "New task text for the child (triggers a turn).",
        },
      },
      required: ["agent_id", "message"],
    },
    async execute(args) {
      const a = args as { agent_id?: string; message?: string };
      const childId = String(a.agent_id ?? "").trim();
      const message = String(a.message ?? "").trim();
      if (!childId || !message) {
        return {
          content: "followup_task requires agent_id and message",
          isError: true,
        };
      }
      const prompted = await dispatchFaceMethod(
        options.runtime,
        "subagent.prompt",
        `tool-sa-fu-${childId}`,
        {
          parentSessionId: options.parentSessionId,
          childSessionId: childId,
          mode: "continuable",
          delivery: "steer",
          content: [{ type: "text", text: message }],
        },
      );
      if (!prompted.result.ok) {
        return {
          content: prompted.result.error.message,
          isError: true,
        };
      }
      return { content: `followup_task sent to ${childId} (steer)` };
    },
  };
}

function parseWaitTargets(args: {
  targets?: unknown;
  agent_id?: unknown;
}): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    const id = String(raw ?? "").trim();
    if (id && !out.includes(id)) out.push(id);
  };
  if (Array.isArray(args.targets)) {
    for (const t of args.targets) push(t);
  } else if (typeof args.targets === "string" && args.targets.trim()) {
    for (const part of args.targets.split(/[\s,]+/)) push(part);
  }
  push(args.agent_id);
  return out;
}

function createWaitAgentTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "wait_agent",
    description:
      "Wait until listed child subagents become idle (Codex wait_agent targets). " +
      "Returns each child's final status and last assistant text when idle. " +
      "Prefer longer timeouts (minutes) over busy-polling with list_agents. " +
      "Answer sizing matches subagent (inline when short; spill only over ~12KB).",
    parameters: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          description: "Child session ids to wait on (from subagent / list_agents).",
          items: { type: "string" },
        },
        agent_id: {
          type: "string",
          description: "Convenience single-target alias of targets=[agent_id].",
        },
        timeout_ms: {
          type: "number",
          description: `Max wait in ms (default ${WAIT_AGENT_DEFAULT_MS}; max ${FOREGROUND_WAIT_MS}).`,
        },
      },
    },
    async execute(args, signal) {
      const a = args as {
        targets?: unknown;
        agent_id?: unknown;
        timeout_ms?: unknown;
      };
      const targets = parseWaitTargets(a);
      if (!targets.length) {
        return {
          content: "wait_agent requires targets or agent_id",
          isError: true,
        };
      }
      let timeoutMs = WAIT_AGENT_DEFAULT_MS;
      if (typeof a.timeout_ms === "number" && Number.isFinite(a.timeout_ms)) {
        timeoutMs = Math.min(
          FOREGROUND_WAIT_MS,
          Math.max(WAIT_AGENT_MIN_MS, Math.floor(a.timeout_ms)),
        );
      }
      for (const childId of targets) {
        const link = options.runtime.subagents.getByChild(childId);
        if (
          !link ||
          link.parentSessionId !== options.parentSessionId ||
          link.mode === "fork"
        ) {
          return {
            content: `wait_agent: ${childId} is not a delegated child of this session`,
            isError: true,
          };
        }
      }
      const deadline = Date.now() + timeoutMs;
      const stillRunning = () =>
        targets.some((id) => isChildSessionActive(options.runtime, id));
      while (stillRunning()) {
        if (signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        if (Date.now() > deadline) break;
        const remaining = Math.max(0, deadline - Date.now());
        const slice = Math.min(POLL_MS * 20, remaining);
        const activeOnes = targets.filter((id) =>
          isChildSessionActive(options.runtime, id),
        );
        if (
          activeOnes.length === 1 &&
          options.runtime.drain.run &&
          !options.runtime.externalAgents.has(activeOnes[0]!)
        ) {
          try {
            await Promise.race([
              options.runtime.drain.run(activeOnes[0]!),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("wait slice")),
                  Math.max(POLL_MS, slice),
                ),
              ),
            ]);
          } catch {
            /* keep polling until deadline */
          }
        } else {
          await new Promise((r) => setTimeout(r, Math.max(POLL_MS, slice)));
        }
      }
      const timedOut = stillRunning();
      const lines: string[] = [
        timedOut
          ? `wait_agent timed out after ${timeoutMs}ms`
          : `wait_agent completed (${timeoutMs}ms budget)`,
      ];
      for (const childId of targets) {
        const link = options.runtime.subagents.getByChild(childId);
        const running = isChildSessionActive(options.runtime, childId);
        const text = running
          ? undefined
          : lastAssistantBodyText(
              subagentOwnedEvents(
                link,
                readSessionEvents(options.runtime.store, childId),
              ),
            );
        const inbox = childInboxCounts(options.runtime, childId);
        lines.push(
          [
            childId,
            running ? "running" : "idle",
            `q=${inbox.queued}`,
            `steer=${inbox.steering}`,
            text
              ? `answer:\n${boundChildAnswer(
                  options.parentSessionId,
                  childId,
                  text,
                )}`
              : running
                ? "(still running)"
                : "(no assistant text)",
          ].join("\t"),
        );
      }
      return {
        content: lines.join("\n"),
        ...(timedOut ? { isError: true } : {}),
      };
    },
  };
}

function createAnalyticsTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "analytics",
    description:
      "Local subagent quota and queue snapshot for this session (not cloud telemetry). " +
      "Shows depth/active caps, free slots, and each child's running state, model route, " +
      "plus inbox queue/steer counts.",
    parameters: { type: "object", properties: {} },
    isConcurrencySafe: () => true,
    async execute() {
      const quota = resolveSubagentQuota(
        options.runtime,
        options.parentSessionId,
      );
      const parentPending = listPendingAdmits(
        readSessionEvents(options.runtime.store, options.parentSessionId),
        options.parentSessionId,
      );
      let parentQueued = 0;
      let parentSteer = 0;
      for (const admit of parentPending) {
        if (admit.delivery === "steer") parentSteer += 1;
        else parentQueued += 1;
      }
      const lines = [
        `purpose: local-debug`,
        `depth: ${quota.depth}/${quota.maxDepth}`,
        `active: ${quota.active}/${quota.maxActive}`,
        `slots_free: ${quota.slotsFree}`,
        `delegated: ${quota.delegated}`,
        `parent_inbox: queue=${parentQueued} steer=${parentSteer}`,
        "children:",
      ];
      const children = options.runtime.subagents.listDelegated(
        options.parentSessionId,
      );
      if (!children.length) {
        lines.push("  (none)");
      } else {
        for (const link of children) {
          const activity = isChildSessionActive(
            options.runtime,
            link.childSessionId,
          )
            ? "running"
            : "idle";
          const inbox = childInboxCounts(
            options.runtime,
            link.childSessionId,
          );
          const externalKind = options.runtime.externalAgents.kind(
            link.childSessionId,
          );
          const route = externalKind
            ? `external:${externalKind}`
            : (() => {
                const m = resolveSessionModelSelection(
                  options.runtime,
                  link.childSessionId,
                );
                return `${m.provider}/${m.model}`;
              })();
          lines.push(
            `  ${link.childSessionId}\t${link.label ?? "subagent"}\t${link.mode}\t${activity}\t${route}\tq=${inbox.queued}\tsteer=${inbox.steering}`,
          );
        }
      }
      return { content: lines.join("\n") };
    },
  };
}

function createInterruptAgentTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "interrupt_agent",
    description:
      "Interrupt a running child subagent by session id. " +
      "Suppresses the automatic parent completion steer for this idle stretch. " +
      "Set takeover true to mark the Agent Teams task as paused for human ownership " +
      "(open the child session in the UI; resume later with send_message).",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Child session id from subagent / list_agents.",
        },
        takeover: {
          type: "boolean",
          description:
            "If true, pause the task board entry and hand the child to a human (no auto completion notice).",
        },
      },
      required: ["agent_id"],
    },
    async execute(args) {
      const a = args as { agent_id?: string; takeover?: boolean };
      const childId = String(a.agent_id ?? "").trim();
      if (!childId) {
        return { content: "interrupt_agent requires agent_id", isError: true };
      }
      const takeover = a.takeover === true;
      const stopped = await dispatchFaceMethod(
        options.runtime,
        "subagent.interrupt",
        `tool-sa-int-${childId}`,
        {
          parentSessionId: options.parentSessionId,
          childSessionId: childId,
          mode: "continuable",
          ...(takeover ? { takeover: true } : {}),
        },
      );
      if (!stopped.result.ok) {
        // one-shot children: fall back to session.cancel
        const cancelled = await dispatchFaceMethod(
          options.runtime,
          "session.cancel",
          `tool-sa-can-${childId}`,
          { sessionId: childId },
        );
        if (!cancelled.result.ok) {
          return {
            content: stopped.result.error.message,
            isError: true,
          };
        }
        options.runtime.suppressOwnedSubagentCompletion(childId);
      }
      if (takeover) {
        options.runtime.agentTeamTasks.markTakeover(childId);
      }
      return {
        content: takeover
          ? `interrupted ${childId} (human takeover — task paused)`
          : `interrupted ${childId}`,
      };
    },
  };
}

/** Register model-facing subagent tools on a live Agent tool registry. */
export function bindSubagentTools(
  tools: ToolRegistry,
  options: BindSubagentToolsOptions,
): void {
  for (const tool of [
    createSubagentTool(options),
    createListAgentsTool(options),
    createSendMessageTool(options),
    createTeamGraphTool(options),
    createFollowupTaskTool(options),
    createWaitAgentTool(options),
    createAnalyticsTool(options),
    createInterruptAgentTool(options),
  ]) {
    if (tools.get(tool.name)) {
      tools.replace(tool);
    } else {
      tools.register(tool);
    }
  }
  bindRalphTool(tools, options);
}
