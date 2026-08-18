import type { ToolDefinition } from "./definition.js";

export interface StdToolsOptions {
  /** Interactive ask; if unset, ask_user returns isError. */
  askUser?: (question: string) => Promise<string>;
}

/** Standard session tools: todo_write + ask_user. */
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
      async execute(args) {
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
  ];
}
