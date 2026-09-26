import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { SUBAGENT_ROUTING_PROMPT_TEXT } from "@xrkseek/core-tools";
import {
  listPendingAdmits,
  readSessionEvents,
} from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import {
  DEFAULT_MAX_ACTIVE_CHILDREN,
  DEFAULT_MAX_DEPTH,
  resolveAgentPresetProfile,
} from "./presets-catalog.js";
import { resolveSessionCwd } from "./session-cwd.js";
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
  appendOutputContract,
  buildOutputSchemaRetryMessage,
  coerceOutputSchema,
  validateOutputAgainstSchema,
  type OutputSchemaObject,
} from "./agent-team-output.js";
import {
  applySpawnRoleReminder,
  parseAgentTeamSpawnRole,
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
  const presetId = runtime.sessionAgentPresets.get(sessionId);
  const profile = resolveAgentPresetProfile(presetId);
  const maxDepth =
    profile.subagents.maxDepth !== undefined
      ? Math.min(faceDepth, profile.subagents.maxDepth)
      : faceDepth;
  const maxActive =
    profile.subagents.maxActiveChildren !== undefined
      ? Math.min(faceActive, profile.subagents.maxActiveChildren)
      : faceActive;
  const depth = subagentDepth(runtime, sessionId);
  const active = countActiveChildren(runtime, sessionId);
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
    await abortable(run(sessionId), signal);
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (runtime.drain.isActive(sessionId)) {
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    if (Date.now() > deadline) {
      throw new Error(`subagent timed out waiting for session ${sessionId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
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
  const err = new Error(
    reason === undefined ? "aborted" : String(reason),
  );
  err.name = "AbortError";
  return err;
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

function createSubagentTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxActiveChildren =
    options.maxActiveChildren ?? DEFAULT_MAX_ACTIVE_CHILDREN;
  return {
    name: "subagent",
    description:
      "Delegate a self-contained task to a teammate subagent (separate session/context). " +
      "Use for focused independent work — research, a scoped implementation, analysis, or read-only review — " +
      "so it does not consume this conversation's context. " +
      "By default the child cannot see this chat — give a complete standalone prompt. " +
      "Set inherit_context true to seed the child with this session's completed turns only " +
      "(the current in-flight turn is excluded). " +
      "By default waits for the result; set run_in_background true to get a durable child id and continue later via send_message. " +
      "Optional role (worker|researcher|reviewer|lead) prefixes a role reminder; " +
      "optional output_schema appends an OUTPUT CONTRACT and validates the final JSON; " +
      "optional task_id / task_name register the work on the Agent Teams task board. " +
      "Optional runtime: omit or in-process (default Face child); acp / app-server / claude-code spawn an external subprocess. " +
      "acp / app-server support run_in_background + followup_task / send_message / wait_agent / interrupt_agent on the same list surface; claude-code remains one-shot print.",
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
            "Task for the subagent. When inherit_context is false (default), include paths, goals, and constraints — it does not see this conversation. When inherit_context is true, build on the seeded completed turns.",
        },
        inherit_context: {
          type: "boolean",
          description:
            "If true, seed the child with this session's completed-turn prefix (open turn excluded). Default false. Ignored for external runtimes.",
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
        task_id?: string;
        task_name?: string;
        output_schema?: unknown;
      };
      const prompt = String(a.prompt ?? "").trim();
      if (!prompt) {
        return { content: "subagent: empty prompt", isError: true };
      }
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
        if (background && !supportsExternalContinuable(runtimeKind)) {
          return {
            content:
              "subagent: run_in_background is not supported for claude-code (print); use acp or app-server",
            isError: true,
          };
        }
        const depth = subagentDepth(
          options.runtime,
          options.parentSessionId,
        );
        if (depth >= maxDepth) {
          return {
            content: `subagent: max depth ${maxDepth} reached (current depth ${depth})`,
            isError: true,
          };
        }
        const active = countActiveChildren(
          options.runtime,
          options.parentSessionId,
        );
        if (active >= maxActiveChildren) {
          return {
            content: `subagent: max active children ${maxActiveChildren} reached (active ${active})`,
            isError: true,
          };
        }
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
            const taskTitle =
              String(a.task_name ?? "").trim() || label;
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
              cwd:
                resolveSessionCwd(
                  options.runtime,
                  options.parentSessionId,
                ) ?? options.runtime.workspaceRoot,
              prompt,
              background: true,
              ...(signal ? { signal } : {}),
              ...(options.externalEnv ? { env: options.externalEnv } : {}),
              ...(product ? { product } : {}),
              ...(options.externalSpawn
                ? { spawnImpl: options.externalSpawn }
                : {}),
            });
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
          const result = await runExternalAgentTurn({
            kind: runtimeKind,
            cwd: options.runtime.workspaceRoot,
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
        }
      }
      const depth = subagentDepth(
        options.runtime,
        options.parentSessionId,
      );
      if (depth >= maxDepth) {
        return {
          content: `subagent: max depth ${maxDepth} reached (current depth ${depth})`,
          isError: true,
        };
      }
      const active = countActiveChildren(
        options.runtime,
        options.parentSessionId,
      );
      if (active >= maxActiveChildren) {
        return {
          content: `subagent: max active children ${maxActiveChildren} reached (active ${active})`,
          isError: true,
        };
      }
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
      let childPrompt = applySpawnRoleReminder(prompt, spawnRole);
      if (outputSchema) {
        childPrompt = appendOutputContract(childPrompt, outputSchema);
      }
      childPrompt = isolated
        ? `${childPrompt}\n\n${worktreeContextNote(isolated)}`
        : childPrompt;

      const taskTitle =
        String(a.task_name ?? "").trim() || label;
      const taskIdHint = String(a.task_id ?? "").trim() || undefined;
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

      let childId: string;
      let seedEventCount = 0;
      if (inherit) {
        const forked = await dispatchFaceMethod(
          options.runtime,
          "session.fork",
          `tool-sa-fork-${Date.now()}`,
          {
            sessionId: options.parentSessionId,
            linkMode,
            label,
          },
        );
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
          seedEventCount = Number(
            (forked.result.value as { eventCount?: number }).eventCount ?? 0,
          );
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
      if (isolated) {
        options.runtime.sessionCwds.set(childId, isolated.path);
        await options.runtime.invalidateAgent?.(childId);
      }
      const task = openTask(childId);
      const worktreeLine = reclaimIsolated;
      const prompted = await dispatchFaceMethod(
        options.runtime,
        "session.prompt",
        `tool-sa-p-${childId}`,
        {
          sessionId: childId,
          mode: "queue",
          content: [{ type: "text", text: childPrompt }],
        },
      );
      if (!prompted.result.ok) {
        const extra = worktreeLine(false);
        return {
          content: [`subagent prompt failed: ${prompted.result.error.message}`, extra]
            .filter(Boolean)
            .join("\n"),
          isError: true,
        };
      }
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
            "Use followup_task to wake a new task, send_message (delivery queue|steer) to continue, wait_agent for results, interrupt_agent (takeover true to pause for human) to stop, list_agents / analytics for quota.",
            "Keep working; do not busy-poll.",
            worktreeLine(true) || undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      try {
        await waitDrainIdle(options.runtime, childId, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await dispatchFaceMethod(
          options.runtime,
          "session.cancel",
          `tool-sa-c-${childId}`,
          { sessionId: childId },
        ).catch(() => undefined);
        options.runtime.agentTeamTasks.complete(task.id, {
          ok: false,
          preview: message,
        });
        const extra = worktreeLine(false);
        return {
          content: [`subagent failed: ${message}`, extra].filter(Boolean).join("\n"),
          isError: true,
        };
      }
      const all = readSessionEvents(options.runtime.store, childId);
      // Never return seeded parent assistant text as the child's result.
      let owned = seedEventCount > 0 ? all.slice(seedEventCount) : all;
      let text = lastAssistantBodyText(owned);
      let schemaValid: boolean | undefined;
      let schemaErrors: readonly string[] | undefined;
      if (outputSchema && text) {
        let checked = validateOutputAgainstSchema(text, outputSchema);
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
            owned = seedEventCount > 0
              ? readSessionEvents(options.runtime.store, childId).slice(
                  seedEventCount,
                )
              : readSessionEvents(options.runtime.store, childId);
            text = lastAssistantBodyText(owned) || text;
            checked = validateOutputAgainstSchema(text, outputSchema);
          }
        }
        schemaValid = checked.valid;
        schemaErrors = checked.errors;
      }
      options.runtime.agentTeamTasks.complete(task.id, {
        ok: true,
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
        content: [text, schemaLine, extra].filter(Boolean).join("\n"),
        ...(schemaValid === false ? { isError: true } : {}),
      };
    },
  };
}

function createListAgentsTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "list_agents",
    description:
      "List direct child subagents of this session (id, label, mode, running, inbox queue/steer). " +
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
        return `${id}\t${label}\t${mode}\t${activity}\tq=${inbox.queued}\tsteer=${inbox.steering}`;
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
      options.runtime.agentTeamTasks.markResumed(childId);
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
          options.runtime.agentTeamTasks.markResumed(peer.id);
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
      options.runtime.agentTeamTasks.markResumed(childId);
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
      "Prefer longer timeouts (minutes) over busy-polling with list_agents.",
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
        const running = isChildSessionActive(options.runtime, childId);
        const text = running
          ? undefined
          : lastAssistantBodyText(
              readSessionEvents(options.runtime.store, childId),
            );
        const inbox = childInboxCounts(options.runtime, childId);
        lines.push(
          [
            childId,
            running ? "running" : "idle",
            `q=${inbox.queued}`,
            `steer=${inbox.steering}`,
            text
              ? `answer:\n${text}`
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
      "Shows depth/active caps, free slots, and each child's running state plus inbox queue/steer counts.",
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
          lines.push(
            `  ${link.childSessionId}\t${link.label ?? "subagent"}\t${link.mode}\t${activity}\tq=${inbox.queued}\tsteer=${inbox.steering}`,
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
