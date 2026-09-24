/**
 * Model-facing `get_goal` / `update_goal` over FaceGoalStore (dsh tool-goal subset).
 * Lets an armed goal round mark complete/blocked so the round-driver stops.
 */

import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import type { GoalRef, GoalView } from "./goal-store.js";

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  if (tools.get(tool.name)) tools.replace(tool);
  else tools.register(tool);
}

function compactGoal(goal: GoalView | undefined): unknown {
  if (!goal) return { goal: null };
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...(goal.blockedReason ? { blockedReason: goal.blockedReason } : {}),
    },
    activation: goal.activation,
  };
}

function refOf(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision };
}

export interface BindGoalToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
}

/** Register `get_goal` + `update_goal` on the session tool registry. */
export function bindGoalTools(
  tools: ToolRegistry,
  options: BindGoalToolsOptions,
): void {
  const { runtime, sessionId } = options;

  registerTool(tools, {
    name: "get_goal",
    description:
      "Read the current same-session goal (id/revision, objective, phase, rounds, activation). " +
      "Call before update_goal.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      const goal = runtime.goals.get(sessionId);
      return {
        content: JSON.stringify(compactGoal(goal)),
      };
    },
  });

  registerTool(tools, {
    name: "update_goal",
    description:
      "Update the current same-session goal. Use action=complete when the objective is done, " +
      "action=blocked when progress is impossible, action=pause to stop automatic rounds, " +
      "action=resume to re-arm and start another round. Optional reason for blocked.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["complete", "blocked", "pause", "resume"],
        },
        reason: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const action =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as { action?: unknown; reason?: unknown }).action
          : undefined;
      const reasonRaw =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as { reason?: unknown }).reason
          : undefined;
      const reason =
        typeof reasonRaw === "string" && reasonRaw.trim()
          ? reasonRaw.trim()
          : undefined;

      const current = runtime.goals.get(sessionId);
      if (!current) {
        return { content: "update_goal: no current goal", isError: true };
      }
      const ref = refOf(current);

      if (action === "complete") {
        const out = runtime.goals.complete(sessionId, ref);
        if (!out.ok) {
          return {
            content: `update_goal: ${out.error.message}`,
            isError: true,
          };
        }
        return { content: JSON.stringify(compactGoal(out.value)) };
      }
      if (action === "pause") {
        const out = runtime.goals.pause(sessionId, ref);
        if (!out.ok) {
          return {
            content: `update_goal: ${out.error.message}`,
            isError: true,
          };
        }
        return { content: JSON.stringify(compactGoal(out.value)) };
      }
      if (action === "resume") {
        const out = runtime.goals.resume(sessionId, ref);
        if (!out.ok) {
          return {
            content: `update_goal: ${out.error.message}`,
            isError: true,
          };
        }
        return { content: JSON.stringify(compactGoal(out.value)) };
      }
      if (action === "blocked") {
        const out = runtime.goals.block(sessionId, ref, {
          code: "model-blocked",
          message: reason ?? "model reported the goal as blocked",
        });
        if (!out.ok) {
          return {
            content: `update_goal: ${out.error.message}`,
            isError: true,
          };
        }
        return { content: JSON.stringify(compactGoal(out.value)) };
      }
      return {
        content: "update_goal: action must be complete|blocked|pause|resume",
        isError: true,
      };
    },
  });
}
