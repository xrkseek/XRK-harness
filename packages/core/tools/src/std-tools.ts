import type { TodoItem, TodoItemStatus } from "@xrkseek/protocol";
import type { ToolDefinition, ToolExecuteExtras } from "./definition.js";

export const EXIT_PLAN_MODE = "exit_plan_mode";
export const PLAN_REVIEW_ID = "plan-review";
export const PLAN_APPROVE_LABEL = "Approve";
export const PLAN_KEEP_LABEL = "Keep planning";

export interface PlanReviewAnswer {
  readonly approved: boolean;
  readonly feedback?: string;
  readonly dismissed?: boolean;
}

export interface StdToolsOptions {
  /** Interactive ask; if unset, ask_user returns isError. */
  askUser?: (question: string) => Promise<string>;
  /** Plan-mode gate for `exit_plan_mode`. Default: inactive. */
  isPlanModeActive?: () => boolean;
  /** Review channel for `exit_plan_mode`. */
  askPlanReview?: (
    plan: string,
    signal?: AbortSignal,
  ) => Promise<PlanReviewAnswer>;
}

const TODO_STATUSES = new Set<TodoItemStatus>([
  "pending",
  "in_progress",
  "completed",
]);

function toWireTodos(
  rows: { id: string; content: string; status: string }[],
): TodoItem[] | undefined {
  const out: TodoItem[] = [];
  for (const t of rows) {
    const content = t.content.trim();
    if (!content) return undefined;
    if (!TODO_STATUSES.has(t.status as TodoItemStatus)) return undefined;
    out.push({ content, status: t.status as TodoItemStatus });
  }
  return out;
}

/** Standard session tools: todo_write + ask_user + exit_plan_mode. */
export function createStdTools(
  options: StdToolsOptions = {},
): ToolDefinition[] {
  const todos: { id: string; content: string; status: string }[] = [];
  return [
    {
      name: "todo_write",
      description: "Update the in-session todo list.",
      parameters: {
        type: "object",
        properties: {
          merge: { type: "boolean" },
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: { type: "string" },
              },
            },
          },
        },
        required: ["todos"],
      },
      async execute(args, _signal, extras?: ToolExecuteExtras) {
        const a = args as {
          merge?: boolean;
          todos?: { id: string; content: string; status: string }[];
        };
        const next = a.todos ?? [];
        if (!a.merge) {
          todos.length = 0;
        }
        for (const t of next) {
          const i = todos.findIndex((x) => x.id === t.id);
          if (i >= 0) todos[i] = t;
          else todos.push(t);
        }
        const wire = toWireTodos(todos);
        if (wire && extras) {
          extras.emitToolEvent("todo/write", { todos: wire });
        }
        return { content: JSON.stringify(todos, null, 2) };
      },
      presentCall: (args) => ({
        card: "generic",
        title: "Update todo list",
        kind: "other",
        rawInput: (args as { todos?: unknown }).todos,
      }),
    },
    {
      name: "ask_user",
      description:
        "Ask the user a concise question when you need confirmation, a choice, or missing information. " +
        "Prefer `questions` (stable ids, optional options / multi_select); `question` is a single free-text shortcut.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "Single free-text question (shortcut; use questions[] when offering choices).",
          },
          questions: {
            type: "array",
            description: "One or more questions; each id is echoed in the answer.",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Stable id; echoed in the answer.",
                },
                question: {
                  type: "string",
                  description: "The question to ask.",
                },
                header: {
                  type: "string",
                  description: "Optional short heading.",
                },
                options: {
                  type: "array",
                  description:
                    'Optional choices. If recommending one, put it first and append "(Recommended)" to the label.',
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["label"],
                  },
                },
                multi_select: {
                  type: "boolean",
                  description: "Allow more than one option. Defaults to false.",
                },
              },
              required: ["id", "question"],
            },
          },
        },
      },
      presentCall: (args) => {
        const a = args as {
          question?: string;
          questions?: { question?: string }[];
        };
        const title =
          a.question?.trim() ||
          a.questions?.find((q) => q.question?.trim())?.question ||
          "Ask user";
        return {
          card: "generic",
          title: String(title),
          kind: "other",
          rawInput: args,
        };
      },
      async execute(args) {
        const a = args as {
          question?: string;
          questions?: { question?: string }[];
        };
        const q =
          String(a.question ?? "").trim() ||
          String(a.questions?.[0]?.question ?? "").trim();
        if (!options.askUser) {
          return {
            content: `ask_user unavailable (no UI): ${q || "(empty)"}`,
            isError: true,
          };
        }
        if (!q) {
          return { content: "ask_user: empty question", isError: true };
        }
        const answer = await options.askUser(q);
        return { content: answer };
      },
    },
    createExitPlanModeTool({
      isActive: () => options.isPlanModeActive?.() === true,
      ...(options.askPlanReview
        ? { askReview: options.askPlanReview }
        : {}),
    }),
  ];
}

const EXIT_DESCRIPTION =
  "Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. " +
  "Send the COMPLETE plan as markdown, starting with a # heading that names it. " +
  "The user may approve (carry out the plan from your next step) or keep " +
  "planning — their feedback comes back in the tool result; revise and present again.";

/** The plan's first markdown heading (any level), or undefined when it has none. */
export function firstPlanHeading(plan: string): string | undefined {
  for (const line of plan.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export function createExitPlanModeTool(options: {
  isActive: () => boolean;
  askReview?: (
    plan: string,
    signal?: AbortSignal,
  ) => Promise<PlanReviewAnswer>;
}): ToolDefinition {
  return {
    name: EXIT_PLAN_MODE,
    description: EXIT_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description:
            "The complete plan, as markdown, starting with a # heading that names it.",
        },
      },
      required: ["plan"],
    },
    presentCall: (args) => {
      const plan = String((args as { plan?: unknown }).plan ?? "");
      return {
        card: "generic",
        title: firstPlanHeading(plan) ?? "Plan",
        kind: "other",
        content: [{ type: "text", text: plan }],
      };
    },
    presentResult: (_args, result) => ({
      card: "generic",
      title: "Plan review",
      content: [{ type: "text" as const, text: result.content }],
    }),
    async execute(args, signal, extras?: ToolExecuteExtras) {
      const plan = String((args as { plan?: unknown }).plan ?? "");
      if (!options.isActive()) {
        return {
          content: `${EXIT_PLAN_MODE} is only available in plan mode`,
          isError: true,
        };
      }
      if (!/^#\s+\S/u.test(plan.trim())) {
        return {
          content: `${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`,
          isError: true,
        };
      }
      if (!options.askReview) {
        return {
          content:
            "no user-questions channel is available to review the plan; ask the user to switch the session mode instead",
          isError: true,
        };
      }
      let review: PlanReviewAnswer;
      try {
        review = await options.askReview(plan, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: msg, isError: true };
      }
      if (review.dismissed) {
        return {
          content:
            "The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.",
          isError: true,
        };
      }
      if (!review.approved) {
        const feedback = review.feedback?.trim() ?? "";
        return {
          content:
            feedback === ""
              ? "The user chose to keep planning; revise the plan and present it again."
              : `The user chose to keep planning; their feedback: ${feedback}`,
          isError: true,
        };
      }
      extras?.emitToolEvent("plan/mode", { active: false });
      return {
        content:
          "Plan approved — plan mode exited; carry out the plan starting with your next step.",
      };
    },
  };
}
