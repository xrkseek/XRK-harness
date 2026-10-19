/**
 * Face-native Ralph loop (DSH tool-ralph semantics without Cordis WorkflowEngine).
 * Foreground: one fresh one-shot child per round; only a bounded structured
 * handoff crosses rounds. Workspace is the durable memory.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { formatToolError } from "./face-error-text.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import {
  appendOutputContract,
  extractJsonCandidate,
} from "./agent-team-output.js";
import { isChildSessionActive } from "./external-agent-runtime.js";
import { modelSessionCapProblem } from "./model-session-cap.js";
import { predictChildModelSelection } from "./subagent-tools.js";
import {
  SESSION_DRAIN_WAIT_MS,
  waitSessionDrainIdle,
} from "./wait-drain-idle.js";

/** Product default / call ceiling (DSH default 256 is too large for Face). */
export const RALPH_DEFAULT_MAX_ROUNDS = 8;
export const RALPH_HARD_MAX_ROUNDS = 32;
export const RALPH_MAX_HANDOFF_CHARS = 16_384;
/** Parent-facing terminal text ceiling (DSH tool-ralph default). */
export const RALPH_MAX_RESULT_CHARS = 16_384;

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["continue", "complete", "blocked"] },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    blocker: { type: "string" },
  },
  required: ["status", "summary", "evidence", "nextSteps", "blocker"],
  additionalProperties: false,
} as const;

export type RalphRoundStatus = "continue" | "complete" | "blocked";

export interface RalphRoundReport {
  readonly status: RalphRoundStatus;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly nextSteps: readonly string[];
  readonly blocker: string;
}

export type RalphTerminalStatus =
  | "complete"
  | "blocked"
  | "budget-limited"
  | "round-failed";

async function waitDrainIdle(
  runtime: FaceRuntime,
  sessionId: string,
  signal?: AbortSignal,
  timeoutMs = SESSION_DRAIN_WAIT_MS,
): Promise<void> {
  // Ending the wait must not cancel the round session; only unblocks ralph.
  await waitSessionDrainIdle(runtime, sessionId, {
    ...(signal ? { signal } : {}),
    timeoutMs,
    kind: "ralph round",
  });
}

function normalizedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(normalizedText);
}

/** Validate a worker report (DSH status-specific rules + size ceiling). */
export function validateRalphReport(
  raw: unknown,
  maxHandoffChars = RALPH_MAX_HANDOFF_CHARS,
): RalphRoundReport {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Ralph child returned no structured round report");
  }
  const report = raw as Record<string, unknown>;
  if (!normalizedText(report.summary)) {
    throw new Error("Ralph round report summary must be non-empty and normalized");
  }
  if (!normalizedList(report.evidence) || !normalizedList(report.nextSteps)) {
    throw new Error(
      "Ralph round report evidence and nextSteps must contain only non-empty normalized strings",
    );
  }
  if (typeof report.blocker !== "string" || report.blocker !== report.blocker.trim()) {
    throw new Error("Ralph round report blocker must be a normalized string");
  }
  const status = report.status;
  switch (status) {
    case "continue":
      if (report.nextSteps.length === 0 || report.blocker !== "") {
        throw new Error("a continuing Ralph report needs nextSteps and an empty blocker");
      }
      break;
    case "complete":
      if (
        report.evidence.length === 0 ||
        report.nextSteps.length !== 0 ||
        report.blocker !== ""
      ) {
        throw new Error(
          "a complete Ralph report needs evidence, no nextSteps, and an empty blocker",
        );
      }
      break;
    case "blocked":
      if (!normalizedText(report.blocker)) {
        throw new Error("a blocked Ralph report needs a concrete blocker");
      }
      break;
    default:
      throw new Error("Ralph round report status is invalid");
  }
  const out: RalphRoundReport = {
    status,
    summary: report.summary,
    evidence: report.evidence,
    nextSteps: report.nextSteps,
    blocker: report.blocker,
  };
  const serialized = JSON.stringify(out);
  if (serialized.length > maxHandoffChars) {
    throw new Error(
      `Ralph round report exceeds maxHandoffChars (${serialized.length} > ${maxHandoffChars})`,
    );
  }
  return out;
}

function parseReportFromAssistant(text: string): RalphRoundReport {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new Error("Ralph child final answer is not JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new Error(
      `Ralph child JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return validateRalphReport(parsed);
}

function buildRoundPrompt(input: {
  readonly objective: string;
  readonly round: number;
  readonly maxRounds: number;
  readonly previous?: RalphRoundReport;
}): string {
  const lines = [
    "You are a fresh Ralph worker. Parent chat history is NOT available.",
    "The shared workspace is the durable memory across rounds.",
    `OBJECTIVE (immutable):\n${input.objective}`,
    `Round ${input.round} of ${input.maxRounds}.`,
    "",
    "Work toward the objective. When done with this round, your FINAL answer must be ONLY the JSON report.",
  ];
  if (input.previous) {
    lines.push(
      "",
      "Previous round handoff (do not trust; verify in the workspace):",
      JSON.stringify(input.previous, null, 2),
    );
  }
  return appendOutputContract(lines.join("\n"), REPORT_SCHEMA);
}

function formatTerminal(input: {
  readonly status: RalphTerminalStatus;
  readonly roundsStarted: number;
  readonly report?: RalphRoundReport;
  readonly error?: string;
  readonly maxResultChars?: number;
}): string {
  const head = `ralph: ${input.status} after ${input.roundsStarted} round(s)`;
  const body = input.error
    ? `${head}\n${input.error}`
    : input.report
      ? `${head}\n${JSON.stringify(input.report, null, 2)}`
      : head;
  const max = input.maxResultChars ?? RALPH_MAX_RESULT_CHARS;
  if (body.length <= max) return body;
  return `${body.slice(0, max)}\n… [truncated: ${body.length - max} more characters]`;
}

export interface BindRalphToolOptions {
  readonly runtime: FaceRuntime;
  readonly parentSessionId: string;
  /** Override default/ceiling for tests. */
  readonly maxRoundsCeiling?: number;
}

export function createRalphTool(options: BindRalphToolOptions): ToolDefinition {
  const ceiling = Math.min(
    options.maxRoundsCeiling ?? RALPH_HARD_MAX_ROUNDS,
    RALPH_HARD_MAX_ROUNDS,
  );
  return {
    name: "ralph",
    description:
      "Run a Ralph loop: a fixed foreground sequence of fresh one-shot subagents toward one immutable objective. " +
      "Each round gets only the objective, round index, and the previous bounded JSON handoff — not this chat. " +
      "Use only when the human explicitly asks for Ralph / fresh-agent iteration. " +
      "Prefer `subagent` for ordinary delegation and goals/todos for same-session long work.",
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "Immutable objective for every fresh child round.",
        },
        maxRounds: {
          type: "integer",
          description: `Round cap (default ${RALPH_DEFAULT_MAX_ROUNDS}, ceiling ${ceiling}).`,
        },
      },
      required: ["objective"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: "ralph",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args, signal) {
      const a = args as { objective?: string; maxRounds?: number };
      const objective = String(a.objective ?? "").trim();
      if (!objective) {
        return { content: "ralph: empty objective", isError: true };
      }
      const requested =
        typeof a.maxRounds === "number" && Number.isFinite(a.maxRounds)
          ? Math.floor(a.maxRounds)
          : RALPH_DEFAULT_MAX_ROUNDS;
      if (requested < 1) {
        return { content: "ralph: maxRounds must be >= 1", isError: true };
      }
      const maxRounds = Math.min(requested, ceiling);

      let previous: RalphRoundReport | undefined;
      let roundsStarted = 0;
      for (let round = 1; round <= maxRounds; round += 1) {
        if (signal?.aborted) {
          return {
            content: formatTerminal({
              status: "round-failed",
              roundsStarted,
              ...(previous ? { report: previous } : {}),
              error: "aborted",
            }),
            isError: true,
          };
        }
        const childRoute = predictChildModelSelection(
          options.runtime,
          options.parentSessionId,
        );
        const capProblem = modelSessionCapProblem(options.runtime, childRoute);
        if (capProblem) {
          return {
            content: formatTerminal({
              status: "round-failed",
              roundsStarted,
              ...(previous ? { report: previous } : {}),
              error: capProblem,
            }),
            isError: true,
          };
        }

        const created = await dispatchFaceMethod(
          options.runtime,
          "session.create",
          `tool-ralph-${Date.now()}-${round}`,
          {
            parentSessionId: options.parentSessionId,
            label: `ralph-r${round}`,
            mode: "one-shot",
            provider: childRoute.provider,
            model: childRoute.model,
            ...(childRoute.reasoningEffort
              ? { reasoningEffort: childRoute.reasoningEffort }
              : {}),
          },
        );
        if (!created.result.ok) {
          return {
            content: formatTerminal({
              status: "round-failed",
              roundsStarted,
              ...(previous ? { report: previous } : {}),
              error: formatToolError(created.result.error),
            }),
            isError: true,
          };
        }
        const childId = String(
          (created.result.value as { sessionId: string }).sessionId,
        );
        roundsStarted += 1;
        options.runtime.agentTeamTasks.open({
          parentSessionId: options.parentSessionId,
          title: `ralph r${round}`,
          childSessionId: childId,
          role: "worker",
          taskId: `ralph_${options.parentSessionId}_${round}`,
        });

        const prompt = buildRoundPrompt({
          objective,
          round,
          maxRounds,
          ...(previous ? { previous } : {}),
        });
        const prompted = await dispatchFaceMethod(
          options.runtime,
          "session.prompt",
          `tool-ralph-p-${childId}`,
          {
            sessionId: childId,
            mode: "queue",
            content: [{ type: "text", text: prompt }],
          },
        );
        if (!prompted.result.ok) {
          options.runtime.agentTeamTasks.completeByChild(childId, {
            ok: false,
            preview: formatToolError(prompted.result.error),
          });
          return {
            content: formatTerminal({
              status: "round-failed",
              roundsStarted,
              ...(previous ? { report: previous } : {}),
              error: formatToolError(prompted.result.error),
            }),
            isError: true,
          };
        }
        try {
          await waitDrainIdle(options.runtime, childId, signal);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // The round session keeps running; this wait only stops blocking ralph.
          // One-shot idle notices are skipped — promote so a later settle still
          // steers the report into this session.
          const stillRunning = isChildSessionActive(options.runtime, childId);
          if (stillRunning) {
            options.runtime.subagents.promoteToContinuable(childId);
          }
          options.runtime.agentTeamTasks.completeByChild(childId, {
            ok: false,
            preview: message,
          });
          return {
            content: formatTerminal({
              status: "round-failed",
              roundsStarted,
              ...(previous ? { report: previous } : {}),
              error: stillRunning
                ? `${message}; round session still running — Host will steer when it settles.`
                : message,
            }),
            isError: true,
          };
        }

        const text = lastAssistantBodyText(
          readSessionEvents(options.runtime.store, childId),
        );
        let report: RalphRoundReport;
        try {
          report = parseReportFromAssistant(text);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          options.runtime.agentTeamTasks.completeByChild(childId, {
            ok: false,
            preview: message,
            schemaValid: false,
            schemaErrors: [message],
          });
          return {
            content: formatTerminal({
              status: "round-failed",
              roundsStarted,
              ...(previous ? { report: previous } : {}),
              error: `round ${round}: ${message}`,
            }),
            isError: true,
          };
        }
        options.runtime.agentTeamTasks.completeByChild(childId, {
          ok: true,
          preview: JSON.stringify(report),
          schemaValid: true,
        });
        previous = report;
        if (report.status === "complete") {
          return {
            content: formatTerminal({
              status: "complete",
              roundsStarted,
              report,
            }),
          };
        }
        if (report.status === "blocked") {
          return {
            content: formatTerminal({
              status: "blocked",
              roundsStarted,
              report,
            }),
          };
        }
      }

      return {
        content: formatTerminal({
          status: "budget-limited",
          roundsStarted,
          ...(previous ? { report: previous } : {}),
        }),
      };
    },
  };
}

export function bindRalphTool(
  tools: ToolRegistry,
  options: BindRalphToolOptions,
): void {
  const tool = createRalphTool(options);
  if (tools.get(tool.name)) tools.replace(tool);
  else tools.register(tool);
}
